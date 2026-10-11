# Run receipts: what each stage was expected to do, and what it did

Every generation the free 3D Studio runs (`forge_avatar`, `text_to_avatar`, `mesh_forge`, `forge_free`, `rig_mesh`, `refine_model`) writes a **run receipt**. A receipt walks the pipeline stage by stage. For each stage it records:

- the **expected** result
- the **observed** result
- a **verdict**
- the **cause** whenever the verdict is not a clean pass

The finished record is hashed and signed with ed25519, so it cannot be edited after the fact without the edit showing.

Browse them at [three.ws/runs](https://three.ws/runs). Each receipt has its own page, `/runs/rr_…`, and every Studio result links to its receipt in the text and in `structuredContent.receipt`.

## Why this exists

A generation pipeline that answers "here is your model" and nothing else hides everything that matters when a result is disappointing. When the director model timed out, the prompt went in as written. When the high-detail lane was full, the job ran on the standard tier. When the rigger returned a skeleton with no legs, the walk cycle can never play. A receipt makes each of those visible as it happens, in the same response, written by the pipeline itself rather than reconstructed afterwards.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `met` | The stage did what it was expected to do. |
| `recovered` | The stage did not do the expected thing, but a named fallback carried the run (a different tier, the prompt used as written, an automatic regeneration). |
| `missed` | The stage did not do what was expected, and the receipt says why (`cause`). |
| `skipped` | The stage did not apply to this run (a reference image skips the brief; draft tiers skip the vision check). |
| `pending` | The stage was still running when the tool answered. `check_job` completes the receipt. |

## Stages

| Stage | Expected | How it is observed |
| --- | --- | --- |
| Input | A prompt or reference image that passes the content-safety check. | The safety check and image guard. A refused prompt is not stored. |
| Subject check | (`forge_avatar` only) A prompt that reads as a character, since rigging assumes a humanoid. | The same humanoid classifier the tool already gates on. |
| Brief | A director-written 3D specification. | Whether the director answered in time, or a known-mark brief applied. |
| Mesh | A textured mesh from the requested tier. | The engine and tier that actually ran, from the terminal job frame. |
| Geometry check | A valid GLB with real, textured geometry. | The deterministic geometry score the forge computes on every file (triangles, vertices, textures). |
| Visual check | A render that reads as a clean, complete subject. | The vision QA gate's verdict, score and defects, where the tier runs it. |
| Rig | A skinned humanoid skeleton with torso, arms and legs mapped. | **Read back from the delivered file**, using the same analysis as Rig Doctor ([src/rig-report.js](../src/rig-report.js)), not taken from the rigger's own report. |
| Delivery | A permanent first-party link. | Whether the file landed on three.ws storage or only on the engine's temporary link. |

Each run's overall outcome is one of the following:

- `delivered`
- `delivered_with_issues`
- `partial` (for example the mesh shipped but the rig failed)
- `pending`
- `refused`
- `failed`

The outcome is derived from the stages. A tool can only state a worse outcome than the stages imply, never a better one.

## The receipt object

```json
{
  "type": "three-run-receipt/v1",
  "id": "rr_88WfvqBfKtWPnaiT6S8NDb",
  "tool": "forge_free",
  "started_at": "2026-10-11T17:02:11.418Z",
  "finished_at": "2026-10-11T17:13:40.902Z",
  "duration_ms": 689484,
  "input": { "prompt": "a weathered brass ship lantern with a glass chimney", "reference_image": false },
  "stages": [
    { "id": "input", "label": "Input", "expected": "A request that passes the content-safety check.", "observed": "Received a text prompt; it passed the safety check.", "verdict": "met" },
    { "id": "brief", "label": "Brief", "expected": "A director-written brief that turns the idea into a single-subject 3D specification.", "observed": "The prompt was used as written.", "verdict": "recovered", "cause": "The director model did not return a usable brief in time." }
  ],
  "outcome": "delivered",
  "summary": "Delivered as expected. 1 carried by a fallback (Brief).",
  "issues": [ { "stage": "brief", "verdict": "recovered", "expected": "…", "observed": "…", "cause": "…" } ],
  "output": { "glb_url": "https://three.ws/cdn/forge/…glb", "viewer_url": "https://three.ws/viewer?src=…" }
}
```

It is stored inside a signed envelope:

```json
{ "receipt": { … }, "sha256": "<hex of the canonical bytes>", "signature": "<base58 ed25519>", "signer": "<base58 public key>" }
```

The signature covers `three-run-receipt/v1` + `\n` + the canonical JSON of the receipt (keys sorted, no whitespace).

## Verify one yourself

The server verifies every receipt it serves, but you do not have to trust it:

```bash
node scripts/run-receipt-verify.mjs rr_88WfvqBfKtWPnaiT6S8NDb
node scripts/run-receipt-verify.mjs https://three.ws/runs/rr_88WfvqBfKtWPnaiT6S8NDb --signer <pinned key>
node scripts/run-receipt-verify.mjs ./downloaded-receipt.json --json
```

The verifier fetches the envelope (or reads a downloaded file). It then recomputes the hash and checks the ed25519 signature locally, and optionally checks the signer against a key you pinned. It prints every stage and exits non-zero on any failed check. Changing one character of any stage breaks it.

The signing key is the platform attestation key (`ATTEST_AGENT_SECRET_KEY`). Its public half is returned as `signer` by `GET /api/runs?stats=1`. A deployment without the key still writes receipts, hashed but marked unsigned, and the page says so.

## API

| Call | Returns |
| --- | --- |
| `GET /api/runs?id=rr_…` | The envelope plus a fresh server-side `verification` (`{ ok, checks[] }`). 400 for a malformed id, 404 if unknown. |
| `GET /api/runs?stats=1&days=7` | Aggregate counts over 1 to 90 days: outcomes, delivery rate, clean rate, per-tool totals, per-stage verdict counts and met rate, and the most common causes. Counts only; no prompts. |

Both are public, CORS-open and keyless.

## Privacy

- A receipt id is an unguessable handle (`rr_` plus 16 random bytes in base58). Receipts are not listed individually anywhere. Only the person holding the link can open one.
- The job handle is stored only as a one-way hash, so a receipt never exposes a job token.
- A prompt refused by the safety check is not stored.
- The aggregate view at `/runs` shows counts and causes, never prompts.

## Failure behavior

A receipt never changes a tool's result; it only adds to it.

- If the database is unreachable, the tool still answers and carries the receipt inline, without a link.
- Saving waits at most 2.5 s.
- Reading the rig back has a 10 s budget. If it fails, the rig stage is `skipped` with the cause, never a guess.
- A link is only attached once the receipt is actually stored, so a receipt link never 404s.

## Code

- Core (stages, verdicts, signing, verification): [api/_lib/run-receipt.js](../api/_lib/run-receipt.js)
- Storage, stats, and rig read-back: [api/_lib/run-receipt-store.js](../api/_lib/run-receipt-store.js)
- Table: [api/_lib/migrations/20261014000000_run_receipts.sql](../api/_lib/migrations/20261014000000_run_receipts.sql)
- Studio wiring: [api/_mcp-studio/receipts.js](../api/_mcp-studio/receipts.js), [api/_mcp-studio/tools.js](../api/_mcp-studio/tools.js)
- API: [api/runs.js](../api/runs.js)
- Page: [pages/runs.html](../pages/runs.html), [src/runs.js](../src/runs.js)
- Offline verifier: [scripts/run-receipt-verify.mjs](../scripts/run-receipt-verify.mjs)
- Tests: [tests/run-receipt.test.js](../tests/run-receipt.test.js)

## Related

- [3D Studio MCP](mcp-studio.md): the tools that write receipts
- [Reasoning Ledger](reasoning-ledger.md): the same idea for agent decisions
