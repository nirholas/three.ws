// Records a real draft text-to-3D exchange from production into
// test/fixtures/forge-draft-text.json. The client tests replay that file, so
// they exercise the real response shapes instead of hand-written fakes.
//
//   node test/record-fixture.mjs [base-url]
// A repeated prompt is answered from cache with no job id (recorded by hand in forge-draft-cached.json);
// set FORGE_PROMPT to a fresh subject to record a real job. Set FORGE_BACKEND (for example nvidia) to pin an engine when the default lane is cold.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "https://three.ws").replace(/\/+$/, "");
const headers = { accept: "application/json", "content-type": "application/json", "x-forge-client": "raycast-fixture-recorder" };
const submit = await (await fetch(`${base}/api/forge`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    prompt: process.env.FORGE_PROMPT || "a small wooden chair",
    tier: "draft",
    path: "image",
    aspect_ratio: "1:1",
    ...(process.env.FORGE_BACKEND ? { backend: process.env.FORGE_BACKEND } : {}),
  }),
})).json();
if (!submit.job_id) throw new Error(`submit failed: ${JSON.stringify(submit)}`);

const polls = [];
const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  const poll = await (await fetch(`${base}/api/forge?job=${encodeURIComponent(submit.job_id)}`, { headers })).json();
  polls.push(poll);
  if (poll.status === "done" || poll.status === "failed") break;
  await new Promise((r) => setTimeout(r, 4000));
}
const out = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "forge-draft-text.json");
writeFileSync(out, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), submit, polls }, null, 1));
console.log(`wrote ${out} with ${polls.length} polls, final status ${polls[polls.length - 1]?.status}`);
