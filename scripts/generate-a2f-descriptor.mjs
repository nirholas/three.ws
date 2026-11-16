#!/usr/bin/env node
// Regenerates api/_lib/a2f-protos/descriptor.js from the vendored NVIDIA
// Audio2Face-3D (ACE) .proto sources.
//
//   node scripts/generate-a2f-descriptor.mjs
//
// This is the A2F sibling of scripts/generate-riva-{tts,asr}-descriptor.mjs.
// Audio2Face-3D is hosted as an NVCF gRPC function on grpc.nvcf.nvidia.com:443
// (same transport as Magpie TTS and Riva ASR), selected by a `function-id`
// metadata entry with the nvapi key as a bearer `authorization` entry. Its wire
// contract is NVIDIA's ACE `nvidia_ace.services.a2f_controller.v1.A2FControllerService`
// (bidirectional streaming ProcessAudioStream); the proto definitions are
// vendored under api/_lib/a2f-protos/*.proto, copied verbatim from
// https://github.com/NVIDIA/Audio2Face-3D-Samples (proto/protobuf_files), plus
// minimal google/protobuf/{Any,Empty} stubs so the graph resolves without the
// real well-known-type files on disk.
//
// Why a generated JS descriptor instead of loading .proto at runtime: api/
// routes are esbuild-bundled in place on Vercel (scripts/bundle-api.mjs), so a
// runtime fs read of a .proto would need fragile includeFiles + import.meta.url
// path math. A checked-in JS module bundles cleanly, needs no filesystem at
// runtime, and is loaded via @grpc/proto-loader's fromJSON().
//
// Parsed with keepCase:true so the gRPC surface uses the snake_case field names
// from the proto (audio_stream_header, samples_per_second, blend_shape_weights,
// time_code) — the same names NVIDIA's docs and Python samples use.

import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const protobuf = require('protobufjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_DIR = resolve(ROOT, 'api/_lib/a2f-protos');

// Order matters only in that every referenced type must end up in the shared
// root before resolveAll(); protobufjs resolves field references by fully
// qualified type name, not by import filename, so the google stubs and leaf
// messages are parsed first.
const SOURCES = [
	'google_protobuf_any.proto',
	'google_protobuf_empty.proto',
	'nvidia_ace.audio.v1.proto',
	'nvidia_ace.animation_id.v1.proto',
	'nvidia_ace.status.v1.proto',
	'nvidia_ace.emotion_with_timecode.v1.proto',
	'nvidia_ace.emotion_aggregate.v1.proto',
	'nvidia_ace.a2f.v1.proto',
	'nvidia_ace.animation_data.v1.proto',
	'nvidia_ace.controller.v1.proto',
	'nvidia_ace.services.a2f_controller.v1.proto',
];
const OUTPUT = resolve(PROTO_DIR, 'descriptor.js');

const root = new protobuf.Root();
// Resolve the well-known-type imports ("google/protobuf/*.proto") to our
// vendored stubs so resolveAll() never tries to read them off disk.
const originalResolvePath = root.resolvePath.bind(root);
root.resolvePath = (origin, target) => {
	if (target.startsWith('google/protobuf/')) {
		const stub = `google_protobuf_${target.slice('google/protobuf/'.length).replace(/\.proto$/, '')}.proto`;
		return resolve(PROTO_DIR, stub);
	}
	if (!target.includes('/')) return resolve(PROTO_DIR, target);
	return originalResolvePath(origin, target);
};

for (const name of SOURCES) {
	const source = await readFile(resolve(PROTO_DIR, name), 'utf8');
	protobuf.parse(source, root, { keepCase: true });
}
root.resolveAll();

// Sanity: the exact surface api/_lib/a2f-nvidia.js depends on must exist.
root.lookupService('nvidia_ace.services.a2f_controller.v1.A2FControllerService');
root.lookupType('nvidia_ace.controller.v1.AudioStream');
root.lookupType('nvidia_ace.controller.v1.AudioStreamHeader');
root.lookupType('nvidia_ace.controller.v1.AnimationDataStream');
root.lookupType('nvidia_ace.audio.v1.AudioHeader');
root.lookupType('nvidia_ace.a2f.v1.AudioWithEmotion');
root.lookupType('nvidia_ace.animation_data.v1.SkelAnimation');
// Emotion output: AnimationData.metadata["emotion_aggregate"] is a
// google.protobuf.Any packing this message (decoded in a2f-nvidia.js).
root.lookupType('nvidia_ace.emotion_aggregate.v1.EmotionAggregate');

const banner = `// GENERATED FILE: do not edit by hand.
// Regenerate with: node scripts/generate-a2f-descriptor.mjs
// protobufjs JSON descriptor for NVIDIA Audio2Face-3D (ACE): the
// nvidia_ace.services.a2f_controller.v1.A2FControllerService gRPC surface,
// parsed (keepCase) from the vendored protos in api/_lib/a2f-protos/*.proto,
// themselves from https://github.com/NVIDIA/Audio2Face-3D-Samples.
// SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
`;

const body = `${banner}export default ${JSON.stringify(root.toJSON(), null, '\t')};\n`;
await writeFile(OUTPUT, body);
console.log(`wrote ${OUTPUT}`);
