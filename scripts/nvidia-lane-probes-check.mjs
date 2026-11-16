#!/usr/bin/env node
// Run the NVIDIA lane probes for real against the live NVIDIA endpoints and
// GPU workers, writing the rows to a throwaway PGlite database (never the
// production DB), then print the /api/nvidia/stats payload built from them.
//
//   NVIDIA_API_KEY=... node scripts/nvidia-lane-probes-check.mjs [lane,lane]
//
// Worker probes need the worker URL env vars (MODEL_TRELLIS_URL and friends)
// and GCP_RECONSTRUCTION_KEY; a lane without them reports unconfigured.

import { useIsolatedDb } from './lib/isolated-db.mjs';

await useIsolatedDb();
const { runLaneProbes, buildNvidiaStats } = await import('../api/_lib/nvidia-lanes.js');
const only = process.argv[2] ? process.argv[2].split(',') : null;
const results = await runLaneProbes({ force: true, only });
console.table(results);
const stats = await buildNvidiaStats();
console.log(JSON.stringify(stats, null, 2));
process.exit(0);
