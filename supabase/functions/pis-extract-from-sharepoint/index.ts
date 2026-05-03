// supabase/functions/pis-extract-from-sharepoint/index.ts
//
// Fencecrete OPS — PIS Extraction from SharePoint
// Created: 2026-05-03
//
// PURPOSE
// For a given job, locate the Project Information Sheet file in the linked
// SharePoint folder and extract the structured fields (Owner, GC, Engineer,
// Billing, PM, Surety, Agent, Tax status). Returns JSON the Parties tab UI
// renders into a preview/confirm modal.
//
// FLOW
//   1. Look up jobs.sharepoint_folder_url + job_number
//   2. Authenticate to MS Graph (reuses pattern from create-sharepoint-folder)
//   3. List children of the folder, find the PIS file (filename heuristic)
//   4. Download the .xlsx via Graph
//   5. Parse with exceljs:
//      - Detect template version (2024 vs 2025) by reading A39
//      - Apply the appropriate cell map
//      - Resolve formula cells via .result
//      - Parse city/state/zip strings
//      - Detect taxable from "X" markers
//   6. Return { found, file, fields, missing_fields, template_version }
//
// REQUIRED SUPABASE SECRETS
//   MS_GRAPH_CLIENT_ID / MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";

const SHAREPOINT_HOSTNAME = "fencecrete0.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/ProjectManager";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = () => new Headers({ ...CORS, "Content-Type": "application/json" });

// ─── MS Graph auth (cached token, same pattern as create-sharepoint-folder) ────
let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }
  const tenantId = Deno.env.get("MS_GRAPH_TENANT_ID");
  const clientId = Deno.env.get("MS_GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_GRAPH_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing Microsoft Graph credentials in Supabase secrets");
  }
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }).toString(),
  });
  if (!resp.ok) throw new Error(`Graph auth failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return cachedToken.access_token;
}

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken();
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

let cachedSiteId: string | null = null;
let cachedDriveId: string | null = null;

async function getSiteAndDriveIds(): Promise<{ siteId: string; driveId: string }> {
  if (cachedSiteId && cachedDriveId) return { siteId: cachedSiteId, driveId: cachedDriveId };
  const siteResp = await graphFetch(`/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}`);
  if (!siteResp.ok) throw new Error(`Failed to resolve site: ${await siteResp.text()}`);
  cachedSiteId = (await siteResp.json()).id;
  const driveResp = await graphFetch(`/sites/${cachedSiteId}/drive`);
  if (!driveResp.ok) throw new Error(`Failed to resolve drive: ${await driveResp.text()}`);
  cachedDriveId = (await driveResp.json()).id;
  return { siteId: cachedSiteId!, driveId: cachedDriveId! };
}

async function getFolderItemByUrl(driveId: string, sharepointUrl: string): Promise<{ id: string; webUrl: string }> {
  // SharePoint URLs may have the path in `?id=` (modern) or in the pathname (legacy).
  const url = new URL(sharepointUrl);
  let p = url.searchParams.get("id");
  if (!p) p = url.pathname;
  // Strip the site prefix to get a drive-relative path.
  const driveRel = p
    .replace(/^\/sites\/ProjectManager\/Shared%20Documents\//, "")
    .replace(/^\/sites\/ProjectManager\/Shared Documents\//, "")
    .replace(/^%2Fsites%2FProjectManager%2FShared%20Documents%2F/, "");
  const decoded = decodeURIComponent(driveRel);
  const encoded = encodeURIComponent(decoded).replace(/%2F/g, "/");
  const resp = await graphFetch(`/drives/${driveId}/root:/${encoded}`);
  if (!resp.ok) throw new Error(`Folder not found: ${await resp.text()}`);
  const data = await resp.json();
  return { id: data.id, webUrl: data.webUrl };
}

interface DriveChild {
  id: string;
  name: string;
  webUrl: string;
  size: number;
  lastModifiedDateTime: string;
  file?: { mimeType: string };
  folder?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
}

async function listFolderChildren(driveId: string, folderId: string): Promise<DriveChild[]> {
  const resp = await graphFetch(
    `/drives/${driveId}/items/${folderId}/children?$select=id,name,webUrl,size,lastModifiedDateTime,file,folder,@microsoft.graph.downloadUrl&$top=200`
  );
  if (!resp.ok) throw new Error(`Folder list failed: ${await resp.text()}`);
  const data = await resp.json();
  return data.value || [];
}

// Find the best PIS-file candidate by filename heuristics.
// Priority: name contains "PIS" or "Project Information Sheet". Excel preferred.
// If multiple match, prefer the most recently modified.
function pickPisFile(children: DriveChild[]): DriveChild | null {
  const candidates = children.filter((c) => {
    if (c.folder) return false;
    if (!c.name) return false;
    const lower = c.name.toLowerCase();
    const isExcel = /\.(xlsx|xls|xlsm)$/i.test(c.name);
    const looksLikePis = /\bpis\b|project[\s_-]*information[\s_-]*sheet/i.test(lower);
    return isExcel && looksLikePis;
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime()
  );
  return candidates[0];
}

async function downloadFileBytes(downloadUrl: string): Promise<Uint8Array> {
  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${await resp.text()}`);
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

// ─── Cell extraction helpers ──────────────────────────────────────────────────
// Read a cell's resolved string value, handling all the shapes ExcelJS returns
// (rich text, formula result, hyperlink, plain string, number, date).
function cellText(ws: ExcelJS.Worksheet, address: string): string {
  const cell = ws.getCell(address);
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as any;
    if (o.richText && Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join("").trim();
    if (o.formula !== undefined) return o.result != null ? String(o.result).trim() : "";
    if (o.text !== undefined) return String(o.text).trim();
    if (o.hyperlink !== undefined) return String(o.text || o.hyperlink).trim();
  }
  return "";
}

// Pick first non-empty value across a list of cells (handles the merged-cell case
// where a value may show up duplicated across B/C/D for one row).
function firstNonEmpty(ws: ExcelJS.Worksheet, addresses: string[]): string {
  for (const a of addresses) {
    const t = cellText(ws, a);
    if (t) return t;
  }
  return "";
}

// Strip a known prefix like "Job #: " or "Lot #: " — case-insensitive, optional.
function stripPrefix(s: string, prefix: string): string {
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return s.replace(re, "").trim();
}

// Parse "City, ST 12345" → { city, state, zip }. Best-effort; falls back to raw in city.
function splitCityStateZip(s: string): { city: string; state: string; zip: string } {
  if (!s) return { city: "", state: "", zip: "" };
  const m = s.match(/^(.+?),\s*([A-Za-z]{2}|[A-Za-z]+)\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (m) return { city: m[1].trim(), state: m[2].trim(), zip: m[3].trim() };
  // Try "City, State ZIP" (state spelled out)
  const m2 = s.match(/^(.+?),\s+(.+?)\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (m2) return { city: m2[1].trim(), state: m2[2].trim(), zip: m2[3].trim() };
  return { city: s.trim(), state: "", zip: "" };
}

// "X" marker detection in cells like "TAXABLE _____X_____" or "TAXABLE __________"
function hasXMarker(s: string): boolean {
  return /[xX]/.test(s.replace(/[a-z\s_:.,()-]+/gi, ""));
}

// ─── Template detection + cell map ────────────────────────────────────────────
type TemplateVersion = "2024" | "2025" | "unknown";

function detectTemplate(ws: ExcelJS.Worksheet): TemplateVersion {
  const a39 = cellText(ws, "A39").toLowerCase();
  if (a39.includes("project engineer")) return "2025";
  if (a39.includes("billing contact")) return "2024";
  return "unknown";
}

interface ExtractedFields {
  // Project meta
  project_name: string;
  job_address: string;
  job_city: string;
  job_state: string;
  job_zip: string;
  county: string;
  lot_number: string;
  subdivision: string;
  block_section: string;
  legal_other: string;
  accounting_job_number: string;
  est_completion_date_text: string;
  job_type: string;
  // Owner
  owner_company: string;
  owner_address: string;
  owner_city: string;
  owner_state: string;
  owner_zip: string;
  owner_phone: string;
  owner_contact: string;
  owner_contact_phone: string;
  owner_email: string;
  owner_alt_contact: string;
  // GC
  gc_company: string;
  gc_address: string;
  gc_city: string;
  gc_state: string;
  gc_zip: string;
  gc_phone: string;
  gc_contact: string;
  gc_contact_phone: string;
  gc_email: string;
  gc_alt_contact: string;
  // Engineer (2025 template only — empty for 2024)
  engineer_name: string;
  engineer_mobile: string;
  engineer_office: string;
  engineer_email: string;
  engineer_alt: string;
  // Billing
  billing_contact: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  billing_phone: string;
  billing_email: string;
  // PM/Superintendent
  pm_name: string;
  pm_mobile: string;
  pm_office: string;
  pm_email: string;
  // Surety
  surety_name: string;
  surety_address: string;
  surety_city: string;
  surety_state: string;
  surety_zip: string;
  surety_contact: string;
  surety_phone: string;
  surety_email: string;
  bond_number: string;
  bond_amount: string;
  bonding_required: boolean | null;
  // Bonding agent
  agent_name: string;
  agent_address: string;
  agent_city: string;
  agent_state: string;
  agent_zip: string;
  agent_phone: string;
  agent_email: string;
  // Tax
  taxable: boolean | null;
  // Submission audit
  submitted_by_name: string;
  submitted_at_text: string;
}

function emptyExtract(): ExtractedFields {
  return {
    project_name: "", job_address: "", job_city: "", job_state: "", job_zip: "", county: "",
    lot_number: "", subdivision: "", block_section: "", legal_other: "",
    accounting_job_number: "", est_completion_date_text: "", job_type: "",
    owner_company: "", owner_address: "", owner_city: "", owner_state: "", owner_zip: "",
    owner_phone: "", owner_contact: "", owner_contact_phone: "", owner_email: "", owner_alt_contact: "",
    gc_company: "", gc_address: "", gc_city: "", gc_state: "", gc_zip: "",
    gc_phone: "", gc_contact: "", gc_contact_phone: "", gc_email: "", gc_alt_contact: "",
    engineer_name: "", engineer_mobile: "", engineer_office: "", engineer_email: "", engineer_alt: "",
    billing_contact: "", billing_address: "", billing_city: "", billing_state: "", billing_zip: "",
    billing_phone: "", billing_email: "",
    pm_name: "", pm_mobile: "", pm_office: "", pm_email: "",
    surety_name: "", surety_address: "", surety_city: "", surety_state: "", surety_zip: "",
    surety_contact: "", surety_phone: "", surety_email: "",
    bond_number: "", bond_amount: "", bonding_required: null,
    agent_name: "", agent_address: "", agent_city: "", agent_state: "", agent_zip: "",
    agent_phone: "", agent_email: "",
    taxable: null,
    submitted_by_name: "", submitted_at_text: "",
  };
}

function extractFromTemplate(ws: ExcelJS.Worksheet, version: TemplateVersion): ExtractedFields {
  const out = emptyExtract();
  // Helper: pick first non-empty across BCD for a row.
  const row = (n: number) => firstNonEmpty(ws, [`B${n}`, `C${n}`, `D${n}`]);

  // Submission audit
  out.submitted_by_name = firstNonEmpty(ws, ["C3", "D3"]);
  out.submitted_at_text = cellText(ws, "D4");

  // Project meta (rows 14-21 — same in both templates)
  out.project_name = row(14);
  out.job_address = row(15);
  const projCsz = splitCityStateZip(row(16));
  out.job_city = projCsz.city; out.job_state = projCsz.state; out.job_zip = projCsz.zip;
  out.county = row(17);
  out.lot_number = stripPrefix(cellText(ws, "B18"), "Lot #:");
  out.subdivision = stripPrefix(cellText(ws, "C18"), "Subdivison:") || stripPrefix(cellText(ws, "C18"), "Subdivision:");
  out.block_section = stripPrefix(cellText(ws, "B19"), "Block/Sec:");
  out.legal_other = stripPrefix(cellText(ws, "C19"), "Other:");
  out.accounting_job_number = stripPrefix(cellText(ws, "B20"), "Job #:");
  out.est_completion_date_text = stripPrefix(cellText(ws, "C20") || cellText(ws, "D20"), "Estimated Completion Date:");
  // Job type — look for "X" or "x" in B21/C21/D21
  const t21 = { priv: cellText(ws, "B21"), pub: cellText(ws, "C21"), gov: cellText(ws, "D21") };
  if (/[xX]/.test(t21.priv.replace(/[a-z\s:]+/gi, ""))) out.job_type = "Private";
  else if (/[xX]/.test(t21.pub.replace(/[a-z\s:]+/gi, ""))) out.job_type = "Public";
  else if (/[xX]/.test(t21.gov.replace(/[a-z\s:]+/gi, ""))) out.job_type = "Government";

  // Owner (rows 23-29 — same in both templates)
  out.owner_company = row(23);
  out.owner_address = row(24);
  const ownCsz = splitCityStateZip(row(25));
  out.owner_city = ownCsz.city; out.owner_state = ownCsz.state; out.owner_zip = ownCsz.zip;
  out.owner_phone = row(26);
  out.owner_contact = cellText(ws, "B27");
  out.owner_contact_phone = cellText(ws, "D27");
  out.owner_email = row(28);
  out.owner_alt_contact = row(29);

  // GC (rows 31-37 — same in both templates)
  out.gc_company = row(31);
  out.gc_address = row(32);
  const gcCsz = splitCityStateZip(row(33));
  out.gc_city = gcCsz.city; out.gc_state = gcCsz.state; out.gc_zip = gcCsz.zip;
  out.gc_phone = row(34);
  out.gc_contact = cellText(ws, "B35");
  out.gc_contact_phone = cellText(ws, "D35");
  out.gc_email = row(36);
  out.gc_alt_contact = row(37);

  // Per-version layout from row 39 onward
  if (version === "2025") {
    // Engineer at 39-43
    out.engineer_name = row(39);
    out.engineer_mobile = row(40);
    out.engineer_office = cellText(ws, "B41") || cellText(ws, "B41");  // mobile / office split
    out.engineer_email = row(42);
    out.engineer_alt = row(43);
    // Billing at 45-49
    out.billing_contact = row(45);
    out.billing_address = row(46);
    const blCsz = splitCityStateZip(row(47));
    out.billing_city = blCsz.city; out.billing_state = blCsz.state; out.billing_zip = blCsz.zip;
    out.billing_phone = row(48);
    out.billing_email = row(49);
    // PM at 51-54
    out.pm_name = row(51);
    out.pm_mobile = row(52);
    out.pm_office = cellText(ws, "B53");
    out.pm_email = row(54);
    // Surety at 56-61
    out.surety_name = row(56);
    out.surety_address = row(57);
    const surCsz = splitCityStateZip(row(58));
    out.surety_city = surCsz.city; out.surety_state = surCsz.state; out.surety_zip = surCsz.zip;
    out.surety_contact = row(59);
    out.surety_phone = row(60);
    out.surety_email = row(61);
    // Bond at 62
    out.bond_number = cellText(ws, "B62");
    out.bond_amount = stripPrefix(cellText(ws, "D62"), "$").replace(/[$,]/g, "");
    // Bonding required at 63 (D63 = Yes/No or could be elsewhere)
    const b63 = (row(63) || "").toLowerCase();
    if (b63.includes(" yes") || /\byes\b/.test(b63)) out.bonding_required = true;
    else if (b63.includes(" no") || /\bno\b/.test(b63)) out.bonding_required = false;
    // Agent at 66-70
    out.agent_name = row(66);
    out.agent_address = row(67);
    const agCsz = splitCityStateZip(row(68));
    out.agent_city = agCsz.city; out.agent_state = agCsz.state; out.agent_zip = agCsz.zip;
    out.agent_phone = row(69);
    out.agent_email = row(70);
    // Tax at 72
    out.taxable = detectTaxable(ws, 72);
  } else if (version === "2024") {
    // Billing at 39-43 (no Engineer section)
    out.billing_contact = row(39);
    out.billing_address = row(40);
    const blCsz = splitCityStateZip(row(41));
    out.billing_city = blCsz.city; out.billing_state = blCsz.state; out.billing_zip = blCsz.zip;
    out.billing_phone = row(42);
    out.billing_email = row(43);
    // PM at 45-48
    out.pm_name = row(45);
    out.pm_mobile = row(46);
    out.pm_office = cellText(ws, "B47");
    out.pm_email = row(48);
    // Surety at 50-55
    out.surety_name = row(50);
    out.surety_address = row(51);
    const surCsz = splitCityStateZip(row(52));
    out.surety_city = surCsz.city; out.surety_state = surCsz.state; out.surety_zip = surCsz.zip;
    out.surety_contact = row(53);
    out.surety_phone = row(54);
    out.surety_email = row(55);
    out.bond_number = cellText(ws, "B56");
    out.bond_amount = stripPrefix(cellText(ws, "D56"), "$").replace(/[$,]/g, "");
    const b57 = (row(57) || "").toLowerCase();
    if (b57.includes(" yes") || /\byes\b/.test(b57)) out.bonding_required = true;
    else if (b57.includes(" no") || /\bno\b/.test(b57)) out.bonding_required = false;
    // Agent at 60-64
    out.agent_name = row(60);
    out.agent_address = row(61);
    const agCsz = splitCityStateZip(row(62));
    out.agent_city = agCsz.city; out.agent_state = agCsz.state; out.agent_zip = agCsz.zip;
    out.agent_phone = row(63);
    out.agent_email = row(64);
    // Tax at 66
    out.taxable = detectTaxable(ws, 66);
  }

  return out;
}

// Detect taxable from "TAXABLE _____X_____" vs "NON TAXABLE _____X_____" cells
// at the given row. Returns true if TAXABLE has X, false if NON TAXABLE has X, null otherwise.
function detectTaxable(ws: ExcelJS.Worksheet, rowNum: number): boolean | null {
  const tax = (cellText(ws, `A${rowNum}`) || cellText(ws, `B${rowNum}`)).toLowerCase();
  const nonTax = (cellText(ws, `C${rowNum}`) || cellText(ws, `D${rowNum}`)).toLowerCase();
  // Look for X marker after the label words. Strip out the label letters first.
  const taxX = /[xX]/.test(tax.replace(/[a-z\s_:]+/gi, ""));
  const nonTaxX = /[xX]/.test(nonTax.replace(/[a-z\s_:]+/gi, ""));
  if (taxX && !nonTaxX) return true;
  if (nonTaxX && !taxX) return false;
  return null;  // ambiguous — neither or both
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const job_id = body?.job_id;
    if (!job_id) {
      return new Response(JSON.stringify({ error: "Missing job_id" }), { status: 400, headers: jsonHeaders() });
    }

    // 1. Look up job
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id,job_number,job_name,sharepoint_folder_url")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found", details: String(jobErr) }), { status: 404, headers: jsonHeaders() });
    }
    if (!job.sharepoint_folder_url) {
      return new Response(JSON.stringify({ found: false, reason: "Job has no sharepoint_folder_url linked." }), { status: 200, headers: jsonHeaders() });
    }

    // 2. Resolve folder via Graph
    const { driveId } = await getSiteAndDriveIds();
    let folderItem;
    try {
      folderItem = await getFolderItemByUrl(driveId, job.sharepoint_folder_url);
    } catch (e) {
      return new Response(JSON.stringify({ found: false, reason: `Could not resolve folder via Graph: ${(e as Error).message}` }), { status: 200, headers: jsonHeaders() });
    }

    // 3. List + find PIS
    const children = await listFolderChildren(driveId, folderItem.id);
    const pis = pickPisFile(children);
    if (!pis) {
      return new Response(JSON.stringify({
        found: false,
        reason: "No file matching PIS naming pattern (filename containing 'PIS' or 'Project Information Sheet', .xlsx/.xls/.xlsm) was found in the folder.",
        files_seen: children.filter(c => !c.folder).map(c => c.name).slice(0, 20),
      }), { status: 200, headers: jsonHeaders() });
    }

    // 4. Download
    const downloadUrl = pis["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) {
      return new Response(JSON.stringify({ error: "PIS file has no downloadUrl" }), { status: 502, headers: jsonHeaders() });
    }
    const bytes = await downloadFileBytes(downloadUrl);

    // 5. Parse
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    if (!ws) {
      return new Response(JSON.stringify({ error: "Excel file has no sheets" }), { status: 502, headers: jsonHeaders() });
    }
    const version = detectTemplate(ws);
    const fields = extractFromTemplate(ws, version);

    // 6. Determine missing-fields list (for UI display)
    const importantFields: (keyof ExtractedFields)[] = [
      "project_name", "owner_company", "gc_company", "billing_contact", "billing_email",
    ];
    const missing_fields = importantFields.filter((k) => !fields[k]);

    return new Response(JSON.stringify({
      found: true,
      file: { name: pis.name, web_url: pis.webUrl, size: pis.size, modified_at: pis.lastModifiedDateTime },
      template_version: version,
      fields,
      missing_fields,
      job: { id: job.id, job_number: job.job_number, job_name: job.job_name },
    }), { status: 200, headers: jsonHeaders() });

  } catch (e) {
    console.error("[pis-extract-from-sharepoint] error:", e);
    return new Response(JSON.stringify({ error: "Internal error", details: String(e) }), { status: 500, headers: jsonHeaders() });
  }
});
