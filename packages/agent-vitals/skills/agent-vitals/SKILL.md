---
name: agent-vitals
description: Model what an autonomous agent needs in order to act as a dependency graph and get the root blocker plus its fix with @three-ws/agent-vitals. Use when an agent reports healthy but is not acting, or when adding a "can it act" health check.
---

# Agent vitals

`@three-ws/agent-vitals` (Node 18+, zero dependencies, ESM) answers "can this agent act?" rather than "is it up?". You declare preconditions (vitals) with probes and `needs` edges, plus capabilities that AND over vitals. `attest()` probes the graph and reports the root cause, not the symptoms.

Install: `npm install @three-ws/agent-vitals`

## API

- `vitals({ agent?, timeoutMs? })` returns a chart (default probe timeout 10000 ms).
- `chart.vital(id, { describe, needs, probe, remedy, timeoutMs })` declares a precondition. `probe` returns `true`, `false`, or `{ ok, detail, data }`. `ok: null` or a thrown/timed-out read means `unknown`, never `down`. `remedy` is a string or `({ detail, data }) => string`.
- `chart.capability(id, { describe, needs: [vitalIds] })` declares an action as an AND over vitals.
- `await chart.attest({ signal? })` returns a `Verdict`.

Vital statuses: `up`, `down`, `blocked` (a dependency is not up, so it was not probed), `unknown`.

Verdict: `verdict.can` (`{ capability: true|false|null }`), `healthy`, `rootCauses` (deepest failing vitals), `remedies`, `vital(id)`, `explain()` (one sentence chain), `toJSON()` (safe to log or serve).

Unknown ids in `needs` throw at `attest()` time, duplicate ids throw at declaration time.

## Worked example

```js
import { vitals } from '@three-ws/agent-vitals';

const chart = vitals({ agent: 'sniper-1' })
  .vital('deploy-fresh', {
    describe: 'the running image matches HEAD',
    probe: async () => ({ ok: deployedSha === headSha, detail: `deployed ${deployedSha}` }),
    remedy: 'redeploy the worker',
  })
  .vital('cognition', {
    describe: 'a model call returns a decision',
    needs: ['deploy-fresh'],
    probe: async () => ({ ok: await modelReachable() }),
    remedy: 'top up model provider credits',
  })
  .vital('solvency', {
    probe: async () => ({ ok: balance >= perAction }),
    remedy: () => `fund the wallet with ${(perAction - balance).toFixed(4)} SOL`,
  })
  .capability('trade', { needs: ['cognition', 'solvency'] });

const verdict = await chart.attest();
if (!verdict.can.trade) {
  console.log(verdict.explain());
  console.log(verdict.rootCauses.map((r) => `${r.id}: ${r.remedy}`));
}
```

## Guidance

- Write probes as cheap, read-only checks. Return `ok: null` when the read itself failed so an RPC blip does not page anyone.
- Give every vital a `remedy` that names a real command or value. A verdict without a fix is a status page.
- Page on `rootCauses`, ignore `blocked` rows.
