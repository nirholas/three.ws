import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  normalize,
  simplifyTriangles,
  writeAsciiStl,
  yUpToZUp,
} from './geometry.js';
import { parseStl } from './stl.js';
import { parseObj } from './obj.js';
import { loadGltfTriangles } from './gltf.js';

export {
  facetNormal,
  bounds,
  normalize,
  simplifyTriangles,
  writeAsciiStl,
  yUpToZUp,
} from './geometry.js';
export { parseStl, parseAsciiStl, parseBinaryStl, isAsciiStl } from './stl.js';
export { parseObj } from './obj.js';
export { loadGltfTriangles } from './gltf.js';

/** GitHub stops rendering markdown files larger than this (they show as raw). */
export const GITHUB_MARKDOWN_LIMIT = 512 * 1024;

/** '200kb' | '1.5mb' | '4096' -> bytes */
export function parseByteSize(value) {
  if (typeof value === 'number') return value;
  const m = /^([\d.]+)\s*(b|kb|mb)?$/i.exec(String(value).trim());
  if (!m) throw new Error(`unparseable size: ${value}`);
  const mult = { b: 1, kb: 1024, mb: 1024 * 1024 }[(m[2] || 'b').toLowerCase()];
  return Math.floor(parseFloat(m[1]) * mult);
}

const SUPPORTED_EXTENSIONS = ['.glb', '.gltf', '.stl', '.ast', '.obj'];

function assertSupported(ext, label) {
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`unsupported input format: ${ext || label} (use .glb, .gltf, .stl, .ast, or .obj)`);
  }
}

/** Parse model bytes of a known extension into a Z-up triangle soup. */
export async function loadTrianglesFromBytes(bytes, ext, { up, label = 'input' } = {}) {
  ext = ext.toLowerCase();
  assertSupported(ext, label);
  let triangles;
  let sourceUp;
  if (ext === '.glb' || ext === '.gltf') {
    triangles = await loadGltfTriangles(bytes);
    sourceUp = up ?? 'y';
  } else if (ext === '.stl' || ext === '.ast') {
    triangles = parseStl(bytes);
    sourceUp = up ?? 'z';
  } else {
    triangles = parseObj(Buffer.from(bytes).toString('utf8'));
    sourceUp = up ?? 'y';
  }
  if (!triangles.length) throw new Error(`no triangles found in ${label}`);
  return sourceUp === 'y' ? yUpToZUp(triangles) : triangles;
}

/** Load any supported model file into a Z-up triangle soup. */
export async function loadTriangles(path, { up } = {}) {
  const ext = extname(path).toLowerCase();
  assertSupported(ext, path);
  return loadTrianglesFromBytes(await readFile(path), ext, { up, label: path });
}

/**
 * Convert a model file into GitHub-renderable ASCII STL.
 *
 * Options:
 *   facets     max facet count (default 1500 - a good README default)
 *   budget     max output bytes (e.g. '200kb'); overrides facets downward
 *   name       solid name written into the STL
 *   precision  decimals per coordinate (default 2)
 *   normalize  rescale/ground the model (default true)
 *   size       normalized height in units (default 100)
 *   up         source up-axis 'y' | 'z' (defaults per format)
 */
export async function convert(path, opts = {}) {
  return convertTriangles(await loadTriangles(path, { up: opts.up }), opts);
}

/**
 * Same as convert(), for model bytes already in memory (an HTTP upload or a
 * fetched URL). `ext` names the format: '.glb', '.gltf', '.obj' or '.stl'.
 */
export async function convertBytes(bytes, ext, opts = {}) {
  return convertTriangles(await loadTrianglesFromBytes(bytes, ext, { up: opts.up }), opts);
}

/** Simplify, normalize and serialize an already-loaded Z-up triangle soup. */
export async function convertTriangles(source, opts = {}) {
  const {
    facets = 1500,
    budget,
    name = 'model',
    precision = 2,
    normalize: doNormalize = true,
    size = 100,
  } = opts;

  const budgetBytes = budget ? parseByteSize(budget) : null;

  // ~150 bytes per facet at precision 2 is a reliable first estimate.
  let target = facets;
  if (budgetBytes) {
    target = Math.min(target, Math.max(16, Math.floor(budgetBytes / 150)));
  }

  let triangles = await simplifyTriangles(source, target);
  if (doNormalize) triangles = normalize(triangles, { size });
  let stl = writeAsciiStl(triangles, { name, precision });

  let guard = 0;
  while (budgetBytes && stl.length > budgetBytes && guard++ < 6) {
    target = Math.max(16, Math.floor(target * (budgetBytes / stl.length) * 0.97));
    triangles = await simplifyTriangles(source, target);
    if (doNormalize) triangles = normalize(triangles, { size });
    stl = writeAsciiStl(triangles, { name, precision });
  }
  if (budgetBytes && stl.length > budgetBytes) {
    throw new Error(
      `could not fit model under ${budgetBytes} bytes (got ${stl.length}); lower --precision or raise --budget`
    );
  }

  return {
    stl,
    facets: triangles.length,
    bytes: stl.length,
    sourceFacets: source.length,
  };
}

/** Wrap ASCII STL in the fenced block GitHub renders as an interactive viewer. */
export function toMarkdown(stl, { details = false, summary = 'View 3D model (drag to rotate)' } = {}) {
  const block = '```stl\n' + stl.trimEnd() + '\n```\n';
  if (!details) return block;
  return `<details>\n<summary>${summary}</summary>\n\n${block}\n</details>\n`;
}

/** Size-check a markdown file against GitHub's render limit. */
export async function checkMarkdownFile(path) {
  const text = await readFile(path, 'utf8');
  const bytes = Buffer.byteLength(text);
  const blocks = [];
  const re = /```stl\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    blocks.push({
      bytes: Buffer.byteLength(m[1]),
      facets: (m[1].match(/facet normal/g) || []).length,
    });
  }
  return {
    bytes,
    limit: GITHUB_MARKDOWN_LIMIT,
    ok: bytes <= GITHUB_MARKDOWN_LIMIT,
    headroom: GITHUB_MARKDOWN_LIMIT - bytes,
    stlBlocks: blocks,
  };
}
