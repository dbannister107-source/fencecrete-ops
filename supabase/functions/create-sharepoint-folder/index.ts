// supabase/functions/create-sharepoint-folder/index.ts
//
// Fencecrete OPS — SharePoint Folder Automation
// Created: 2026-04-24
//
// PURPOSE
// Creates a new SharePoint project folder by copying either:
//   (a) the master template folder (for new clients), OR
//   (b) an existing project folder (for repeat clients)
//
// Architecture: Synchronous (Stage 1) — polls Graph monitor URL until
// copy completes, returns final folder URL to caller. Targets <22 sec
// total runtime to stay under Supabase's 25 sec edge function timeout.
//
// REQUIRED SUPABASE SECRETS
//   MS_GRAPH_CLIENT_ID
//   MS_GRAPH_TENANT_ID
//   MS_GRAPH_CLIENT_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHAREPOINT_HOSTNAME = "fencecrete0.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/ProjectManager";

const MARKET_FOLDER_MAP: Record<string, string> = {
  "AUS": "Austin",
  "CS": "College Station",
  "DFW": "Dallas",
  "HOU": "Houston",
  "SA": "San Antonio",
};

const TEMPLATE_FOLDER_PATH = "_TEMPLATE - DO NOT MODIFY";
const ACTIVE_JOBS_ROOT = "Active Jobs";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 22000;

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
    const errText = await resp.text();
    throw new Error(`Graph auth failed: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  };
  return cachedToken.access_token;
}

async function graphFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getGraphToken();
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

let cachedSiteId: string | null = null;
let cachedDriveId: string | null = null;

async function getSiteAndDriveIds(): Promise<{ siteId: string; driveId: string }> {
  if (cachedSiteId && cachedDriveId) {
    return { siteId: cachedSiteId, driveId: cachedDriveId };
  }
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
  return { siteId: cachedSiteId!, driveId: cachedDriveId! };
}

async function getFolderItemByPath(driveId: string, folderPath: string): Promise<{ id: string; webUrl: string }> {
  const encodedPath = encodeURIComponent(folderPath).replace(/%2F/g, "/");
  const resp = await graphFetch(`/drives/${driveId}/root:/${encodedPath}`);
  if (!resp.ok) {
    throw new Error(`Folder not found at path "${folderPath}": ${await resp.text()}`);
  }
  const data = await resp.json();
  return { id: data.id, webUrl: data.webUrl };
}

async function getFolderItemByUrl(driveId: string, sharepointUrl: string): Promise<{ id: string }> {
  const url = new URL(sharepointUrl);
  let path = url.searchParams.get("id");
  if (!path) {
    path = url.pathname;
  }
  const driveRelativePath = path
    .replace(/^\/sites\/ProjectManager\/Shared%20Documents\//, "")
    .replace(/^\/sites\/ProjectManager\/Shared Documents\//, "")
    .replace(/^%2Fsites%2FProjectManager%2FShared%20Documents%2F/, "");
  const decodedPath = decodeURIComponent(driveRelativePath);
  return getFolderItemByPath(driveId, decodedPath);
}

interface CopyResult {
  itemId: string;
  webUrl: string;
}

async function copyFolderAndWait(
  driveId: string,
  sourceItemId: string,
  parentItemId: string,
  newName: string
): Promise<CopyResult> {
  const copyResp = await graphFetch(
    `/drives/${driveId}/items/${sourceItemId}/copy`,
    {
      method: "POST",
      body: JSON.stringify({
        parentReference: { driveId, id: parentItemId },
        name: newName,
      }),
    }
  );
  if (copyResp.status !== 202) {
    throw new Error(`Copy initiation failed: ${copyResp.status} ${await copyResp.text()}`);
  }
  const monitorUrl = copyResp.headers.get("Location");
  if (!monitorUrl) {
    throw new Error("Graph copy returned no monitor URL");
  }
  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const monitorResp = await fetch(monitorUrl);
    if (!monitorResp.ok && monitorResp.status !== 202) {
      throw new Error(`Monitor poll failed: ${monitorResp.status}`);
    }
    const monitorData = await monitorResp.json();
    if (monitorData.status === "completed") {
      const newItemId = monitorData.resourceId;
      const itemResp = await graphFetch(`/drives/${driveId}/items/${newItemId}`);
      if (!itemResp.ok) {
        throw new Error(`Failed to fetch new folder details: ${await itemResp.text()}`);
      }
      const itemData = await itemResp.json();
      return { itemId: newItemId, webUrl: itemData.webUrl };
    }
    if (monitorData.status === "failed") {
      throw new Error(`Graph copy failed: ${JSON.stringify(monitorData)}`);
    }
  }
  throw new Error(`Copy timed out after ${POLL_TIMEOUT_MS}ms — folder may still be copying. Try refreshing in a minute.`);
}

function buildFolderName(jobName: string, jobNumber: string, customerName: string): string {
  const sanitize = (s: string) =>
    (s || "").replace(/["*:<>?/\\|]/g, "").trim();
  return `!${sanitize(jobName)}_${sanitize(jobNumber)}_${sanitize(customerName)}1`;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "POST only" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  try {
    const body = await req.json();
    const { job_id, source, source_folder_url } = body;
    if (!job_id) {
      return jsonError(corsHeaders, "Missing job_id", 400);
    }
    if (source !== "template" && source !== "existing") {
      return jsonError(corsHeaders, "source must be 'template' or 'existing'", 400);
    }
    if (source === "existing" && !source_folder_url) {
      return jsonError(corsHeaders, "source_folder_url required when source='existing'", 400);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, job_number, job_name, customer_name, market, sharepoint_folder_url")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) {
      return jsonError(corsHeaders, `Job not found: ${jobErr?.message || "unknown"}`, 404);
    }
    if (job.sharepoint_folder_url) {
      return jsonError(corsHeaders,
        `Folder already exists for this job: ${job.sharepoint_folder_url}`, 409);
    }
    const marketFolder = MARKET_FOLDER_MAP[job.market];
    if (!marketFolder) {
      return jsonError(corsHeaders,
        `Market '${job.market}' is not supported for folder automation. ` +
        `Supported: ${Object.keys(MARKET_FOLDER_MAP).join(", ")}.`, 400);
    }
    const { driveId } = await getSiteAndDriveIds();
    let sourceItem: { id: string };
    if (source === "template") {
      sourceItem = await getFolderItemByPath(driveId, TEMPLATE_FOLDER_PATH);
    } else {
      sourceItem = await getFolderItemByUrl(driveId, source_folder_url);
    }
    const targetParent = await getFolderItemByPath(driveId, `${ACTIVE_JOBS_ROOT}/${marketFolder}`);
    const newFolderName = buildFolderName(job.job_name, job.job_number, job.customer_name);
    const copyResult = await copyFolderAndWait(
      driveId,
      sourceItem.id,
      targetParent.id,
      newFolderName
    );
    const { error: updateErr } = await supabase
      .from("jobs")
      .update({ sharepoint_folder_url: copyResult.webUrl })
      .eq("id", job_id);
    if (updateErr) {
      console.warn("DB update failed after successful folder creation:", updateErr);
    }
    return new Response(
      JSON.stringify({
        success: true,
        url: copyResult.webUrl,
        name: newFolderName,
        item_id: copyResult.itemId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return jsonError(corsHeaders, err.message || "Unknown error", 500);
  }
});

function jsonError(corsHeaders: Record<string, string>, message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
