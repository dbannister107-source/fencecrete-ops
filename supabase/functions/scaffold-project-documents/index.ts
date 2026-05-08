// supabase/functions/scaffold-project-documents/index.ts
//
// Fencecrete OPS — Phase 2 (2026-05-09): scaffold the standard SharePoint
// boilerplate set into the in-app Documents tab on new project creation.
//
// PURPOSE
//   When create-sharepoint-folder succeeds for a new project, this function
//   walks the canonical _TEMPLATE - DO NOT MODIFY folder, downloads each
//   unique boilerplate file (deduped across the template root + !PM Folder
//   subfolder which intentionally duplicates most files), uploads each to
//   the project-attachments Supabase Storage bucket, and inserts a
//   project_attachments row with the right category mapping. Result: every
//   new project starts with the same starter file set Amiee used to set up
//   manually in SharePoint, but visible/searchable inside the app.
//
//   Walks the TEMPLATE (not the new project's copy) so the canonical source
//   is one place — if a future template tweak adds/changes files, every
//   subsequent new project picks up the change automatically.
//
// IDEMPOTENCE
//   Skips files whose exact filename is already attached to the job (and
//   not soft-deleted). Re-running on the same job is safe and surfaces a
//   "skipped: N" count.
//
// REQUIRED SUPABASE SECRETS (reused from create-sharepoint-folder)
//   MS_GRAPH_CLIENT_ID
//   MS_GRAPH_TENANT_ID
//   MS_GRAPH_CLIENT_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHAREPOINT_HOSTNAME = "fencecrete0.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/ProjectManager";
const TEMPLATE_FOLDER_PATH = "_TEMPLATE - DO NOT MODIFY";
const STORAGE_BUCKET = "project-attachments";
const MAX_RECURSION_DEPTH = 3; // template is 2 levels deep; cap at 3 for safety
const PER_FILE_TIMEOUT_MS = 15_000;

// Filename pattern → DOC_CATEGORIES key. First match wins; fallback 'other'.
// Patterns are case-insensitive substring matches. Locked with David
// 2026-05-09 based on the !TEMPLATE folder listing at that point.
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/Project Information Sheet/i, "pis"],
  [/Change Order/i, "change_order"],
  [/AIA Affidavit/i, "contract"],
  [/Schedule of Values/i, "contract"],
  [/Job Set ?up/i, "other"],
];

function categoryFor(filename: string): string {
  for (const [pattern, cat] of CATEGORY_PATTERNS) {
    if (pattern.test(filename)) return cat;
  }
  return "other";
}

function sanitizeForStoragePath(s: string): string {
  // Match the convention used by the existing upload flow:
  // [^a-zA-Z0-9._-] → _
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ─── Microsoft Graph helpers (token + site/drive cache) ──────────────

interface GraphToken {
  access_token: string;
  expires_at: number;
}

let cachedToken: GraphToken | null = null;

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
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`Graph auth failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.access_token;
}

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken();
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

let cachedSiteId: string | null = null;
let cachedDriveId: string | null = null;

async function getDriveId(): Promise<string> {
  if (cachedSiteId && cachedDriveId) return cachedDriveId;
  const siteResp = await graphFetch(
    `/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}`
  );
  if (!siteResp.ok) {
    throw new Error(`Failed to resolve SharePoint site: ${await siteResp.text()}`);
  }
  const siteData = await siteResp.json();
  cachedSiteId = siteData.id;
  const driveResp = await graphFetch(`/sites/${cachedSiteId}/drive`);
  if (!driveResp.ok) {
    throw new Error(`Failed to resolve drive: ${await driveResp.text()}`);
  }
  const driveData = await driveResp.json();
  cachedDriveId = driveData.id;
  return cachedDriveId!;
}

interface FolderRef {
  id: string;
  webUrl: string;
}

async function getFolderByPath(driveId: string, folderPath: string): Promise<FolderRef> {
  const encoded = encodeURIComponent(folderPath).replace(/%2F/g, "/");
  const resp = await graphFetch(`/drives/${driveId}/root:/${encoded}`);
  if (!resp.ok) {
    throw new Error(`Folder not found at "${folderPath}": ${await resp.text()}`);
  }
  const data = await resp.json();
  return { id: data.id, webUrl: data.webUrl };
}

interface GraphChild {
  id: string;
  name: string;
  file?: { mimeType?: string };
  folder?: { childCount: number };
  size?: number;
  // Microsoft Graph adds this field on file children when ?expand=children
  // is omitted; download URL is short-lived (~1 hour) but plenty for our
  // purpose — we use it within seconds of fetching.
  "@microsoft.graph.downloadUrl"?: string;
}

async function listChildrenRecursive(
  driveId: string,
  folderId: string,
  acc: Map<string, GraphChild>,
  depth: number
): Promise<void> {
  if (depth > MAX_RECURSION_DEPTH) return;
  const resp = await graphFetch(`/drives/${driveId}/items/${folderId}/children`);
  if (!resp.ok) {
    throw new Error(`List children failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  for (const item of (data.value || []) as GraphChild[]) {
    if (item.folder) {
      await listChildrenRecursive(driveId, item.id, acc, depth + 1);
    } else if (item.file) {
      // Dedupe by filename (case-sensitive). Template root + !PM Folder share
      // most files; we keep whichever we see first (template root wins by
      // listing order — root is enumerated before the !PM Folder dive).
      if (!acc.has(item.name)) {
        acc.set(item.name, item);
      }
    }
  }
}

async function downloadBytes(downloadUrl: string): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_FILE_TIMEOUT_MS);
  try {
    const resp = await fetch(downloadUrl, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(t);
  }
}

// ─── Main handler ────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...CORS, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonError("POST only", 405);
  }
  try {
    const { job_id } = await req.json();
    if (!job_id) {
      return jsonError("Missing job_id", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up the job — we need job_number for the project_attachments row,
    // and we don't strictly need sharepoint_folder_url since we walk the
    // TEMPLATE folder (canonical), not the project's copy. We still keep
    // the lookup as a sanity check that the job exists and is not deleted.
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, job_number, customer_name")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) {
      return jsonError(`Job not found: ${jobErr?.message || "unknown"}`, 404);
    }

    // Resolve the canonical template folder
    const driveId = await getDriveId();
    const templateFolder = await getFolderByPath(driveId, TEMPLATE_FOLDER_PATH);

    // Walk template recursively, dedupe by filename
    const files = new Map<string, GraphChild>();
    await listChildrenRecursive(driveId, templateFolder.id, files, 0);

    if (files.size === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          attached: [],
          skipped: [],
          errors: [],
          summary: "Template folder is empty — nothing to scaffold.",
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Idempotence: pull existing filenames for this job (not soft-deleted)
    const { data: existingRows } = await supabase
      .from("project_attachments")
      .select("filename")
      .eq("job_id", job_id)
      .is("deleted_at", null);
    const existingNames = new Set((existingRows || []).map((r) => r.filename));

    const attached: Array<{ filename: string; category: string }> = [];
    const skipped: string[] = [];
    const errors: Array<{ filename: string; error: string }> = [];

    for (const [name, item] of files) {
      if (existingNames.has(name)) {
        skipped.push(name);
        continue;
      }
      try {
        const downloadUrl = item["@microsoft.graph.downloadUrl"];
        if (!downloadUrl) {
          // Fallback: fetch the item with /content endpoint
          errors.push({ filename: name, error: "no Graph download URL on child item" });
          continue;
        }
        const bytes = await downloadBytes(downloadUrl);
        const cat = categoryFor(name);
        const ts = Date.now();
        const safe = sanitizeForStoragePath(name);
        const storagePath = `${job_id}/${cat}/${ts}-${safe}`;
        const mime = item.file?.mimeType || "application/octet-stream";

        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, bytes, { contentType: mime, upsert: false });
        if (uploadErr) {
          errors.push({ filename: name, error: `storage: ${uploadErr.message}` });
          continue;
        }

        const { error: insertErr } = await supabase
          .from("project_attachments")
          .insert({
            job_id: job.id,
            job_number: job.job_number,
            filename: name,
            storage_path: storagePath,
            mime_type: mime,
            file_size_bytes: bytes.byteLength,
            category: cat,
            description: "Boilerplate (auto-scaffolded from SharePoint template)",
            uploaded_by_email: "system@fencecrete.com",
            uploaded_by_name: "Auto-scaffold",
            source_table: "sharepoint_template",
          });
        if (insertErr) {
          // Best-effort cleanup: remove the orphan file we just uploaded
          await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
          errors.push({ filename: name, error: `db: ${insertErr.message}` });
          continue;
        }

        attached.push({ filename: name, category: cat });
      } catch (err) {
        errors.push({ filename: name, error: (err as Error).message || String(err) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        attached,
        skipped,
        errors,
        summary: `${attached.length} attached, ${skipped.length} skipped, ${errors.length} errors`,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("scaffold-project-documents error:", err);
    return jsonError((err as Error).message || "Unknown error", 500);
  }
});
