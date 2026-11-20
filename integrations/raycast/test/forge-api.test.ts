import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ForgeClient, ForgeError, viewerUrlFor } from "../src/forge-api";

// Recorded from production POST/GET /api/forge by test/record-fixture.mjs.
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "forge-draft-text.json"), "utf8")) as {
  submit: Record<string, unknown>;
  polls: Record<string, unknown>[];
};

function replay(responses: Array<{ status?: number; body: unknown }>) {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const noSleep = async () => undefined;

describe("ForgeClient against recorded production responses", () => {
  it("submits a prompt and reads the job id from the recorded submit response", async () => {
    const { fetchImpl, calls } = replay([{ body: fixture.submit }]);
    const client = new ForgeClient({ clientHandle: "t", fetchImpl, sleep: noSleep });
    const submission = await client.submit("a small wooden chair", "draft");
    expect(submission.job_id).toBe(fixture.submit.job_id);
    expect(calls[0]).toBe("https://three.ws/api/forge");
  });

  it("polls the recorded sequence until the GLB is done", async () => {
    const polls = fixture.polls.map((body) => ({ body }));
    const { fetchImpl } = replay(polls);
    const client = new ForgeClient({ clientHandle: "t", fetchImpl, sleep: noSleep });
    const seen: string[] = [];
    const result = await client.poll(String(fixture.submit.job_id), (s) => seen.push(s));
    const last = fixture.polls[fixture.polls.length - 1];
    expect(last.status).toBe("done");
    expect(result.glbUrl).toBe(last.glb_url);
    expect(result.viewerUrl).toBe(viewerUrlFor("https://three.ws", String(last.glb_url)));
    expect(seen.length).toBe(fixture.polls.length);
  });

  it("rejects a prompt that is too short before any network call", async () => {
    const { fetchImpl, calls } = replay([{ body: {} }]);
    const client = new ForgeClient({ clientHandle: "t", fetchImpl });
    await expect(client.submit("ab", "draft")).rejects.toMatchObject({ code: "invalid_prompt" });
    expect(calls.length).toBe(0);
  });

  it("surfaces an API error code and keeps polling through a 503", async () => {
    const { fetchImpl } = replay([
      { status: 503, body: { error: "busy" } },
      { body: { status: "done", glb_url: "https://example.test/m.glb" } },
    ]);
    const client = new ForgeClient({ clientHandle: "t", fetchImpl, sleep: noSleep });
    const result = await client.poll("j1");
    expect(result.glbUrl).toBe("https://example.test/m.glb");

    const failing = replay([{ status: 429, body: { error: "rate_limited", message: "Slow down" } }]);
    const c2 = new ForgeClient({ clientHandle: "t", fetchImpl: failing.fetchImpl });
    await expect(c2.submit("a small wooden chair", "draft")).rejects.toBeInstanceOf(ForgeError);
  });
});

describe("ForgeClient on a cache hit", () => {
  const cached = JSON.parse(readFileSync(join(__dirname, "fixtures", "forge-draft-cached.json"), "utf8")) as {
    submit: { glb_url: string };
  };

  it("returns the GLB from the submit response without polling", async () => {
    const { fetchImpl, calls } = replay([{ body: cached.submit }]);
    const client = new ForgeClient({ clientHandle: "t", fetchImpl, sleep: noSleep });
    const result = await client.generate("a small wooden chair", "draft");
    expect(result.glbUrl).toBe(cached.submit.glb_url);
    expect(result.viewerUrl).toBe(viewerUrlFor("https://three.ws", cached.submit.glb_url));
    expect(calls.length).toBe(1);
  });
});


describe("ForgeClient with a three.ws account", () => {
  // Making a model needs a free three.ws account: /api/forge answers an
  // anonymous POST with 401 sign_in_required (api/_lib/creator-account.js).
  function recording(body: unknown, status = 200) {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push({ ...((init?.headers as Record<string, string>) ?? {}) });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fetchImpl, seen };
  }

  it("sends the API key as a bearer on submit and on every poll", async () => {
    const submit = recording({ status: "queued", job_id: "j9" });
    const client = new ForgeClient({ clientHandle: "t", apiKey: " sk_live_abc ", fetchImpl: submit.fetchImpl, sleep: noSleep });
    await client.submit("a small wooden chair", "draft");
    expect(submit.seen[0].authorization).toBe("Bearer sk_live_abc");

    const poll = recording({ status: "done", glb_url: "https://example.test/m.glb" });
    const c2 = new ForgeClient({ clientHandle: "t", apiKey: "sk_live_abc", fetchImpl: poll.fetchImpl, sleep: noSleep });
    await c2.poll("j9");
    expect(poll.seen[0].authorization).toBe("Bearer sk_live_abc");
  });

  it("sends no authorization header when no key is set", async () => {
    const r = recording({ status: "queued", job_id: "j9" });
    const client = new ForgeClient({ clientHandle: "t", fetchImpl: r.fetchImpl });
    await client.submit("a small wooden chair", "draft");
    expect(r.seen[0]).not.toHaveProperty("authorization");
  });

  it("surfaces sign_in_required with its code and status so the UI can point at the key", async () => {
    const r = recording(
      {
        error: "sign_in_required",
        message: "Sign in to make a 3D model. A three.ws account is free.",
        sign_in_url: "/login",
        api_keys_url: "/dashboard/api-keys",
      },
      401,
    );
    const client = new ForgeClient({ clientHandle: "t", fetchImpl: r.fetchImpl });
    await expect(client.submit("a small wooden chair", "draft")).rejects.toMatchObject({
      code: "sign_in_required",
      status: 401,
    });
  });
});
