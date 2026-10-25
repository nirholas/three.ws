import { readdir } from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJson, safeFileName, stripBase64 } from "./fal-queue.mjs";

export function parseIndexedName(value) {
  const fileName = path.basename(value || "");
  const requestMatch = fileName.match(/^\.(\d+)-(.+?)(?:__([a-z0-9._-]+))?-request\.json$/i);
  if (requestMatch) {
    return {
      index: Number(requestMatch[1]),
      slug: requestMatch[2],
      scope: requestMatch[3],
      extension: ".json",
      hidden: true,
      name: fileName,
      path: value
    };
  }

  const artifactMatch = fileName.match(/^(\d+)-(.+?)(\.[^.]+)$/);
  if (artifactMatch) {
    return {
      index: Number(artifactMatch[1]),
      slug: artifactMatch[2],
      scope: undefined,
      extension: artifactMatch[3],
      hidden: false,
      name: fileName,
      path: value
    };
  }

  return undefined;
}

export function isHiddenRequestMetadata(value) {
  return parseIndexedName(value)?.hidden === true;
}

export function isVisibleFile(value) {
  return !path.basename(value || "").startsWith(".");
}

async function indexedEntries(filesOrDir) {
  if (Array.isArray(filesOrDir)) {
    return filesOrDir.map((file) => parseIndexedName(file)).filter(Boolean);
  }

  await ensureDir(filesOrDir);
  const entries = await readdir(filesOrDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => parseIndexedName(path.join(filesOrDir, entry.name)))
    .filter(Boolean);
}

export async function nextIndex(filesOrDir, slug) {
  const entries = await indexedEntries(filesOrDir);
  const maxIndex = entries.reduce((max, entry) => {
    if (slug && entry.slug !== slug) return max;
    return Number.isInteger(entry.index) ? Math.max(max, entry.index) : max;
  }, -1);
  return maxIndex + 1;
}

export async function latestIndexed(filesOrDir, slug) {
  const entries = await indexedEntries(filesOrDir);
  const artifacts = entries.filter((entry) => !entry.hidden && (!slug || entry.slug === slug));
  return artifacts.sort((a, b) => b.index - a.index).at(0);
}

export async function requestMetadataFiles(dir, options = {}) {
  const { slug, scope } = options;
  await ensureDir(dir);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const requests = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parsed = parseIndexedName(path.join(dir, entry.name));
    if (!parsed?.hidden) continue;
    if (slug && parsed.slug !== slug) continue;
    if (scope !== undefined && parsed.scope !== scope) continue;
    const filePath = path.join(dir, entry.name);
    let data;
    try {
      data = await readJson(filePath);
    } catch {
      continue;
    }
    requests.push({
      ...parsed,
      path: filePath,
      data
    });
  }

  return requests.sort((a, b) => b.index - a.index);
}

export function requestPath(dir, index, slug, scope) {
  const safeSlug = safeFileName(slug);
  const safeScope = scope ? `__${safeFileName(scope)}` : "";
  return path.join(dir, `.${index}-${safeSlug}${safeScope}-request.json`);
}

export function artifactPath(dir, index, slug, extension) {
  return path.join(dir, `${index}-${safeFileName(slug)}${extension}`);
}

export function buildRequestSummary(options) {
  const {
    kind,
    provider,
    endpoint = provider,
    metadata = {},
    requestId,
    submittedAt,
    completedAt = new Date().toISOString(),
    prompt,
    inputFiles = [],
    outputFiles = [],
    downloadedFiles = [],
    result,
    error = null,
    extra = {}
  } = options;

  return stripBase64({
    schema_version: 1,
    kind,
    ...metadata,
    provider,
    endpoint,
    status: error ? "failed" : "completed",
    request_id: requestId,
    submitted_at: submittedAt,
    completed_at: completedAt,
    ...(prompt !== undefined ? { prompt } : {}),
    input_files: inputFiles,
    output_files: outputFiles,
    downloaded_files: downloadedFiles,
    result,
    error,
    ...extra
  });
}
