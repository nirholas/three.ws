import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_TOOLS,
  DEFAULT_TASK,
  describeError,
  findGlbUrl,
  parseArgs,
  parseMcpBody,
  viewerLink,
  xaiKey,
} from "../src/lib.ts";

test("parseArgs reads --check and joins the other words into the request", () => {
  assert.deepEqual(parseArgs([]), { check: false, task: DEFAULT_TASK });
  assert.deepEqual(parseArgs(["--check"]), { check: true, task: DEFAULT_TASK });
  assert.deepEqual(parseArgs(["make", "a", "brass", "desk", "lamp"]), { check: false, task: "make a brass desk lamp" });
  assert.equal(parseArgs(["a lamp", "--check"]).check, true);
});

test("findGlbUrl finds the first .glb URL in Grok's prose, with or without a query string", () => {
  assert.equal(
    findGlbUrl("GLB: https://example.com/objects/chair_01.glb\nthanks"),
    "https://example.com/objects/chair_01.glb",
  );
  assert.equal(findGlbUrl("Here (https://example.com/a.glb?v=2) it is."), "https://example.com/a.glb?v=2");
  assert.equal(findGlbUrl("[model](https://example.com/b.glb)"), "https://example.com/b.glb");
  assert.equal(findGlbUrl("The job is still pending. job_id abc123"), undefined);
  assert.equal(findGlbUrl("https://example.com/page.html"), undefined);
});

test("viewerLink percent-encodes the GLB URL into the three.ws viewer", () => {
  assert.equal(
    viewerLink("https://example.com/a b/chair.glb?x=1&y=2"),
    "https://three.ws/viewer?src=https%3A%2F%2Fexample.com%2Fa%20b%2Fchair.glb%3Fx%3D1%26y%3D2",
  );
});

test("xaiKey prefers XAI_API_KEY, falls back to GROK_API_KEY, and treats empty as unset", () => {
  assert.equal(xaiKey({ XAI_API_KEY: "a", GROK_API_KEY: "b" }), "a");
  assert.equal(xaiKey({ GROK_API_KEY: "b" }), "b");
  assert.equal(xaiKey({ XAI_API_KEY: "" }), undefined);
  assert.equal(xaiKey({}), undefined);
});

test("parseMcpBody reads a JSON reply and a one-message event stream", () => {
  const reply = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
  assert.deepEqual(parseMcpBody("application/json", JSON.stringify(reply)), reply);
  assert.deepEqual(
    parseMcpBody("text/event-stream", `event: message\ndata: ${JSON.stringify(reply)}\n\n`),
    reply,
  );
});

test("describeError shows xAI's own status, code and message, and the plain message otherwise", () => {
  const apiError = (err: unknown): err is Error & { status?: number; code?: string | null } => err instanceof Error && "status" in err;
  const xai = Object.assign(new Error("Incorrect API key provided."), { status: 400, code: "invalid_argument" });
  assert.equal(describeError(xai, apiError), "xAI answered 400 invalid_argument: Incorrect API key provided.");
  assert.equal(describeError(new TypeError("fetch failed"), apiError), "TypeError: fetch failed");
  assert.equal(describeError("boom", apiError), "boom");
});

test("the example only allows the three catalog and generation tools", () => {
  assert.deepEqual(ALLOWED_TOOLS, ["search_catalog", "forge_free", "check_job"]);
});
