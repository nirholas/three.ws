import {
  callFalQueue,
  downloadRemoteFiles,
  ensureDir,
  toModelInputUrl,
  writeJson
} from "./fal-queue.mjs";
import { buildRequestSummary, requestPath } from "./request-metadata.mjs";

export async function runFalImageTo3DProvider(options) {
  const {
    endpoint,
    providerSlug,
    imageInputKey,
    image,
    outputDir,
    assetName,
    input,
    metadataPath,
    metadata = {},
    pollIntervalMs = 10000,
    onSubmit,
    onStatus
  } = options;

  if (!endpoint) throw new Error("endpoint is required.");
  if (!providerSlug) throw new Error("providerSlug is required.");
  if (!imageInputKey) throw new Error("imageInputKey is required.");
  if (!image) throw new Error("Input image is required.");
  if (!outputDir) throw new Error("outputDir is required.");

  await ensureDir(outputDir);

  const normalizedInput = {
    ...input,
    [imageInputKey]: await toModelInputUrl(image)
  };
  const requestMetadataPath = metadataPath || requestPath(outputDir, 0, providerSlug);

  const result = await callFalQueue(endpoint, normalizedInput, {
    metadataPath: requestMetadataPath,
    metadata: {
      kind: "3d",
      provider: endpoint,
      provider_slug: providerSlug,
      input: normalizedInput,
      ...metadata
    },
    pollIntervalMs,
    onSubmit,
    onStatus
  });

  const downloaded = await downloadRemoteFiles(result.data, outputDir, providerSlug);
  const summary = buildRequestSummary({
    kind: "3d",
    provider: endpoint,
    metadata: {
      provider_slug: providerSlug,
      ...metadata
    },
    requestId: result.requestId,
    submittedAt: result.submittedAt,
    inputFiles: [image],
    outputFiles: downloaded.map((file) => file.path),
    downloadedFiles: downloaded,
    result: result.data,
    extra: { asset_name: assetName, input: normalizedInput }
  });

  await writeJson(requestMetadataPath, summary);
  return summary;
}
