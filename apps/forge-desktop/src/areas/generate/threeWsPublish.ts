// Pure helpers for publishing the open model to three.ws, kept out of the
// component so they run under node --test.

const SERVE_FILE_PREFIX = '/optimize/serve-file?path='

/** The file path an output URL points at: a workspace path or an imported file. */
function sourcePath(outputUrl: string): string {
  if (outputUrl.startsWith('/workspace/')) return outputUrl.slice('/workspace/'.length)
  if (outputUrl.startsWith(SERVE_FILE_PREFIX)) return decodeURIComponent(outputUrl.slice(SERVE_FILE_PREFIX.length))
  return outputUrl.split('?')[0]
}

/**
 * Whether the open model can be published. three.ws stores GLB models; every
 * mesh Forge shows is served as GLB (imports are converted on the way in),
 * while Gaussian splats stay .splat/.ply and have no GLB form.
 */
export function canPublishToThreeWs(outputUrl: string | undefined): boolean {
  if (!outputUrl) return false
  return /\.glb$/i.test(sourcePath(outputUrl))
}

/**
 * A readable default name from the model's file: "chair_opt20000.glb" becomes
 * "Chair". Forge's own suffixes (_opt, _smooth, _xf_) and generated ids are
 * dropped; anything left empty falls back to "Forge model".
 */
export function defaultPublishName(outputUrl: string | undefined): string {
  if (!outputUrl) return 'Forge model'
  const file = sourcePath(outputUrl).split(/[\\/]/).pop() ?? ''
  const stem = file
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_(opt\d+|smooth\d+|xf_[0-9a-f]+)/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b[0-9a-f]{8,}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stem || /^(mesh|model|output|result)$/i.test(stem)) return 'Forge model'
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

/** "a, b ,,c" to ["a", "b", "c"]: the tags field is a comma list. */
export function parseTags(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter(Boolean)
}
