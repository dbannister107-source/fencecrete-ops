import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHAREPOINT_HOSTNAME = "fencecrete0.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/ProjectManager";
const MARKET_FOLDERS: Record<string, string> = {
  "AUS": "Active Jobs/Austin",
  "CS": "Active Jobs/College Station",
  "DFW": "Active Jobs/Dallas",
  "HOU": "Active Jobs/Houston",
  "SA": "Active Jobs/San Antonio",
};
const JOB_NUMBER_REGEX = /(\d{2}[ACDHS]\d{3}|\d{2}CS\d{2,3}|26O\d{3}|\d{4,6})/g;

interface GraphToken { access_token: string; expires_at: number; }
let cachedToken: GraphToken | null = null;

async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) return cachedToken.access_token;
  const tenantId = Deno.env.get("MS_GRAPH_TENANT_ID");
  const clientId = Deno.env.get("MS_GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_GRAPH_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) throw new Error("Missing Microsoft Graph credentials");
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
  });
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`Graph auth failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = { access_token: data.access_token, expires_at: Date.now() + (data.expires_in * 1000) };
  return cachedToken.access_token;
}

async function graphFetch(path: string): Promise<Response> {
  const token = await getGraphToken();
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
}

let cachedSiteId: string | null = null;
let cachedDriveId: string | null = null;

async function getSiteAndDriveIds(): Promise<{ siteId: string; driveId: string }> {
  if (cachedSiteId && cachedDriveId) return { siteId: cachedSiteId, driveId: cachedDriveId };
  const siteResp = await graphFetch(`/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}`);
  if (!siteResp.ok) throw new Error(`Site lookup failed: ${await siteResp.text()}`);
  const siteData = await siteResp.json();
  cachedSiteId = siteData.id;
  const driveResp = await graphFetch(`/sites/${cachedSiteId}/drive`);
  if (!driveResp.ok) throw new Error(`Drive lookup failed: ${await driveResp.text()}`);
  const driveData = await driveResp.json();
  cachedDriveId = driveData.id;
  return { siteId: cachedSiteId!, driveId: cachedDriveId! };
}

interface SharePointFolder { name: string; webUrl: string; market: string; }

async function listMarketFolders(driveId: string, market: string, marketPath: string): Promise<SharePointFolder[]> {
  const folders: SharePointFolder[] = [];
  const encoded = encodeURIComponent(marketPath).replace(/%2F/g, "/");
  let url: string | null = `/drives/${driveId}/root:/${encoded}:/children?$top=200&$select=name,webUrl,folder`;
  while (url) {
    const resp = await graphFetch(url);
    if (!resp.ok) throw new Error(`Folder listing failed for ${marketPath}: ${await resp.text()}`);
    const data = await resp.json();
    for (const item of data.value || []) {
      if (item.folder) folders.push({ name: item.name, webUrl: item.webUrl, market });
    }
    url = data["@odata.nextLink"] || null;
  }
  return folders;
}

function extractJobNumber(folderName: string): string[] {
  const matches = folderName.match(JOB_NUMBER_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(corsHeaders, "POST only", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "apply" ? "apply" : "preview";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: jobs, error: jobsErr } = await supabase
      .from("jobs")
      .select("id, job_number, job_name, customer_name, market, sharepoint_folder_url");
    if (jobsErr) throw new Error(`DB read failed: ${jobsErr.message}`);
    const jobByNumber = new Map<string, any>();
    for (const job of jobs || []) jobByNumber.set(job.job_number.toUpperCase(), job);

    const { driveId } = await getSiteAndDriveIds();
    const allFolders: SharePointFolder[] = [];
    for (const [market, path] of Object.entries(MARKET_FOLDERS)) {
      try {
        const folders = await listMarketFolders(driveId, market, path);
        allFolders.push(...folders);
      } catch (err) {
        console.error(`Failed to list ${market}: ${err.message}`);
      }
    }

    const matched: any[] = [];
    const ambiguous: any[] = [];
    const unmatched: any[] = [];

    for (const folder of allFolders) {
      const candidateJobNumbers = extractJobNumber(folder.name);
      const dbMatches = candidateJobNumbers
        .map(n => jobByNumber.get(n.toUpperCase()))
        .filter(j => j !== undefined);
      if (dbMatches.length === 0) {
        unmatched.push({
          folder_name: folder.name, folder_url: folder.webUrl, market: folder.market,
          extracted_numbers: candidateJobNumbers,
        });
      } else if (dbMatches.length === 1) {
        const job = dbMatches[0];
        matched.push({
          folder_name: folder.name, folder_url: folder.webUrl, folder_market: folder.market,
          job_id: job.id, job_number: job.job_number, job_name: job.job_name,
          customer_name: job.customer_name, job_market: job.market,
          market_mismatch: job.market !== folder.market,
          already_had_url: !!job.sharepoint_folder_url, existing_url: job.sharepoint_folder_url,
        });
      } else {
        ambiguous.push({
          folder_name: folder.name, folder_url: folder.webUrl, market: folder.market,
          matched_jobs: dbMatches.map(j => ({ job_id: j.id, job_number: j.job_number, job_name: j.job_name })),
        });
      }
    }

    let updatedCount = 0;
    let skippedAlreadyHadUrl = 0;
    let skippedMarketMismatch = 0;
    if (mode === "apply") {
      for (const m of matched) {
        if (m.already_had_url) { skippedAlreadyHadUrl++; continue; }
        if (m.market_mismatch) { skippedMarketMismatch++; continue; }
        const { error: updateErr } = await supabase
          .from("jobs")
          .update({ sharepoint_folder_url: m.folder_url })
          .eq("id", m.job_id);
        if (updateErr) console.error(`Failed to update ${m.job_number}: ${updateErr.message}`);
        else updatedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true, mode,
        summary: {
          folders_scanned: allFolders.length,
          jobs_in_database: jobs?.length || 0,
          matched_to_job: matched.length,
          matched_clean: matched.filter(m => !m.market_mismatch && !m.already_had_url).length,
          matched_market_mismatch: matched.filter(m => m.market_mismatch).length,
          matched_already_had_url: matched.filter(m => m.already_had_url).length,
          ambiguous_multiple_matches: ambiguous.length,
          unmatched_no_job_found: unmatched.length,
          ...(mode === "apply" ? {
            updated: updatedCount,
            skipped_already_had_url: skippedAlreadyHadUrl,
            skipped_market_mismatch: skippedMarketMismatch,
          } : {}),
        },
        matched: matched.slice(0, 100),
        ambiguous, unmatched,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Backfill error:", err);
    return jsonError(corsHeaders, err.message || "Unknown error", 500);
  }
});

function jsonError(corsHeaders: Record<string, string>, message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
