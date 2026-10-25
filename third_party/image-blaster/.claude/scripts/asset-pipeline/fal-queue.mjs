#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

let envLoaded = false;

export async function loadDotEnv(envPath = ".env") {
  if (envLoaded) return;
  envLoaded = true;

  let contents;
  try {
    contents = await readFile(envPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export async function requireEnv(name) {
  await loadDotEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env before running this script.`);
  }
  return value;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) index += 1;

    if (flags[key] === undefined) {
      flags[key] = value;
    } else if (Array.isArray(flags[key])) {
      flags[key].push(value);
    } else {
      flags[key] = [flags[key], value];
    }
  }

  return { flags, positionals };
}

export function one(flags, key, fallback = undefined) {
  const value = flags[key];
  if (Array.isArray(value)) return value.at(-1);
  return value ?? fallback;
}

export function many(flags, key) {
  const value = flags[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  return isRequestMetadataPath(filePath) ? stripBase64(value) : value;
}

function isRequestMetadataPath(filePath) {
  return /-request\.json$/i.test(path.basename(filePath || ""));
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const output = isRequestMetadataPath(filePath) ? stripBase64(value) : value;
  await writeFile(filePath, `${JSON.stringify(output, null, 2)}\n`);
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

export function isDataUri(value) {
  return /^data:/i.test(value);
}

export function inferMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".glb": "model/gltf-binary",
    ".obj": "model/obj",
    ".mtl": "model/mtl",
    ".fbx": "application/octet-stream",
    ".usdz": "model/vnd.usdz+zip"
  };
  return mimes[extension] ?? "application/octet-stream";
}

export async function fileToDataUri(filePath) {
  const data = await readFile(filePath);
  return `data:${inferMime(filePath)};base64,${data.toString("base64")}`;
}

export async function toModelInputUrl(value) {
  if (isUrl(value) || isDataUri(value)) return value;
  if (!(await pathExists(value))) {
    throw new Error(`Input file does not exist: ${value}`);
  }
  return fileToDataUri(value);
}

export async function downloadFile(url, outputPath) {
  await ensureDir(path.dirname(outputPath));

  if (isDataUri(url)) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) throw new Error("Invalid data URI");
    const body = decodeURIComponent(match[3]);
    const buffer = match[2] ? Buffer.from(body, "base64") : Buffer.from(body);
    await writeFile(outputPath, buffer);
    return outputPath;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  return outputPath;
}

export function extensionForFile(file, fallback = ".bin") {
  if (file.file_name) {
    const extension = path.extname(file.file_name);
    if (extension) return extension;
  }

  const mime = file.content_type;
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "model/gltf-binary": ".glb",
    "model/obj": ".obj",
    "model/mtl": ".mtl"
  };
  return extensions[mime] ?? fallback;
}

export function safeFileName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function collectRemoteFiles(value, label = "file", collected = [], seen = new Set()) {
  if (!value) return collected;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRemoteFiles(item, `${label}-${index + 1}`, collected, seen));
    return collected;
  }

  if (typeof value === "object") {
    if (typeof value.url === "string" && !seen.has(value.url)) {
      seen.add(value.url);
      collected.push({ label, file: value });
      return collected;
    }

    for (const [key, child] of Object.entries(value)) {
      collectRemoteFiles(child, key, collected, seen);
    }
  }

  return collected;
}

export async function downloadRemoteFiles(result, outputDir, prefix = "file") {
  const downloaded = [];
  const remoteFiles = collectRemoteFiles(result);

  for (const { label, file } of remoteFiles) {
    const fallbackName = `${prefix}-${safeFileName(label)}${extensionForFile(file)}`;
    const fileName = safeFileName(file.file_name || fallbackName);
    const outputPath = path.join(outputDir, fileName);
    await downloadFile(file.url, outputPath);
    downloaded.push({
      label,
      path: outputPath,
      source: file
    });
  }

  return downloaded;
}

function isBase64Field(key) {
  return /base64|b64/i.test(String(key || ""));
}

export function stripBase64(value, key = "") {
  if (typeof value === "string") {
    if (isDataUri(value) || isBase64Field(key)) return "[stripped]";
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripBase64(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        stripBase64(child, childKey)
      ])
    );
  }

  return value;
}

export const sanitizeForMetadata = stripBase64;

async function updateMetadata(metadataPath, patch) {
  if (!metadataPath) return;
  const previous = (await pathExists(metadataPath)) ? await readJson(metadataPath) : {};
  await writeJson(metadataPath, {
    schema_version: 1,
    ...previous,
    ...patch,
    updated_at: new Date().toISOString()
  });
}

export async function submitFalQueue(endpoint, input, options = {}) {
  const {
    metadataPath,
    metadata = {},
    onSubmit
  } = options;

  const falKey = await requireEnv("FAL_KEY");
  const submittedAt = new Date().toISOString();

  const submitResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const submitBody = await submitResponse.json().catch(() => ({}));

  if (!submitResponse.ok) {
    throw new Error(`FAL submit failed (${submitResponse.status}).`);
  }

  const requestId = submitBody.request_id;
  if (!requestId) {
    throw new Error("FAL submit response did not include request_id.");
  }

  const submitted = stripBase64({
    ...metadata,
    endpoint,
    request_id: requestId,
    status: "submitted",
    submitted_at: submittedAt,
    status_url: submitBody.status_url,
    response_url: submitBody.response_url
  });

  await updateMetadata(metadataPath, submitted);
  if (onSubmit) await onSubmit(submitted);

  return submitted;
}

export async function pollFalQueue(endpoint, requestId, options = {}) {
  const {
    statusUrl: providedStatusUrl,
    metadataPath,
    pollIntervalMs = 5000,
    logs = true,
    onStatus
  } = options;

  const falKey = await requireEnv("FAL_KEY");
  let statusBody;
  while (true) {
    const requestStatusUrl = new URL(
      providedStatusUrl || `https://queue.fal.run/${endpoint}/requests/${requestId}/status`
    );
    if (logs) requestStatusUrl.searchParams.set("logs", "1");

    const statusResponse = await fetch(requestStatusUrl, {
      headers: { Authorization: `Key ${falKey}` }
    });
    statusBody = await statusResponse.json().catch(() => ({}));

    if (!statusResponse.ok) {
      throw new Error(`FAL status failed (${statusResponse.status}).`);
    }

    const statusPatch = {
      endpoint,
      request_id: requestId,
      status: statusBody.status || "UNKNOWN",
      checked_at: new Date().toISOString(),
      queue_status: sanitizeForMetadata(statusBody)
    };
    await updateMetadata(metadataPath, statusPatch);
    if (onStatus) await onStatus(statusPatch);

    if (statusBody.status === "COMPLETED") {
      if (statusBody.error) {
        const message = typeof statusBody.error === "string" ? `: ${statusBody.error}` : "";
        throw new Error(`FAL request failed${message}.`);
      }
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    endpoint,
    request_id: requestId,
    status: statusBody
  };
}

export async function getFalQueueResult(endpoint, requestId, options = {}) {
  const {
    responseUrl,
    metadataPath
  } = options;

  const falKey = await requireEnv("FAL_KEY");
  const resultUrl = responseUrl || `https://queue.fal.run/${endpoint}/requests/${requestId}`;
  const resultResponse = await fetch(resultUrl, {
    headers: { Authorization: `Key ${falKey}` }
  });
  const resultBody = await resultResponse.json().catch(() => ({}));
  if (!resultResponse.ok) {
    throw new Error(`FAL result failed (${resultResponse.status}).`);
  }

  await updateMetadata(metadataPath, {
    endpoint,
    request_id: requestId,
    status: "completed",
    completed_at: new Date().toISOString(),
    result: sanitizeForMetadata(resultBody)
  });

  return {
    requestId,
    data: resultBody
  };
}

export async function callFalQueue(endpoint, input, options = {}) {
  const {
    metadataPath,
    metadata = {},
    pollIntervalMs = 5000,
    logs = true,
    onSubmit,
    onStatus
  } = options;

  const submitted = await submitFalQueue(endpoint, input, { metadataPath, metadata, onSubmit });
  const status = await pollFalQueue(endpoint, submitted.request_id, {
    statusUrl: submitted.status_url,
    metadataPath,
    pollIntervalMs,
    logs,
    onStatus
  });
  const result = await getFalQueueResult(endpoint, submitted.request_id, {
    responseUrl: submitted.response_url,
    metadataPath
  });

  return {
    requestId: submitted.request_id,
    submittedAt: submitted.submitted_at,
    status: status.status,
    data: result.data
  };
}
