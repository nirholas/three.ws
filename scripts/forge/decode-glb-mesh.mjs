#!/usr/bin/env node
// Decode Forge GLBs (meshopt + KHR_mesh_quantization, as the TRELLIS.2 worker
// writes them) into raw little-endian buffers that the bake rasteriser
// benchmark (workers/model-trellis2/bench_bake_raster.py) reads without a
// meshopt decoder of its own:
//
//   <out_dir>/<id>.uv.f32   N x 2  TEXCOORD_0 with KHR_texture_transform applied
//   <out_dir>/<id>.pos.f32  N x 3  POSITION in world space (node transforms applied)
//   <out_dir>/<id>.idx.i32  F x 3  triangle indices
//
// <id> is the first 8 characters of the file name.
// Usage: node scripts/forge/decode-glb-mesh.mjs <out_dir> <mesh.glb>...

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || files.length === 0) {
  console.error('usage: node scripts/forge/decode-glb-mesh.mjs <out_dir> <mesh.glb>...');
  process.exit(2);
}

function uvTransform(prim) {
  const info = prim.getMaterial()?.getBaseColorTextureInfo();
  const t = info?.getExtension('KHR_texture_transform');
  if (!t) return (u, v) => [u, v];
  const [ox, oy] = t.getOffset();
  const [sx, sy] = t.getScale();
  const r = t.getRotation();
  const c = Math.cos(r);
  const s = Math.sin(r);
  // KHR_texture_transform: uv' = T * R * S * uv, with R = [[c, s], [-s, c]].
  return (u, v) => [c * sx * u + s * sy * v + ox, -s * sx * u + c * sy * v + oy];
}

function applyMatrix(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const doc = await io.read(file);
  const node = doc.getRoot().listNodes().find((n) => n.getMesh());
  if (!node) throw new Error(`${file}: no mesh node`);
  const prim = node.getMesh().listPrimitives()[0];
  const uvAcc = prim.getAttribute('TEXCOORD_0');
  const posAcc = prim.getAttribute('POSITION');
  if (!uvAcc || !posAcc || !prim.getIndices()) throw new Error(`${file}: needs POSITION, TEXCOORD_0 and indices`);

  const toUv = uvTransform(prim);
  const world = node.getWorldMatrix();
  const n = posAcc.getCount();
  const uv = new Float32Array(n * 2);
  const pos = new Float32Array(n * 3);
  const el = [];
  for (let i = 0; i < n; i++) {
    uvAcc.getElement(i, el);
    const [u, v] = toUv(el[0], el[1]);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    posAcc.getElement(i, el);
    const [x, y, z] = applyMatrix(world, el[0], el[1], el[2]);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }
  const idx = Int32Array.from(prim.getIndices().getArray());
  const base = path.join(outDir, path.basename(file, '.glb').slice(0, 8));
  fs.writeFileSync(`${base}.uv.f32`, Buffer.from(uv.buffer));
  fs.writeFileSync(`${base}.pos.f32`, Buffer.from(pos.buffer));
  fs.writeFileSync(`${base}.idx.i32`, Buffer.from(idx.buffer));
  console.log(JSON.stringify({ id: path.basename(base), vertices: n, faces: idx.length / 3 }));
}
