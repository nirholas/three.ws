# 3D-Agent — Operating Rules for Claude Agents

These rules OVERRIDE defaults. Every agent in this workspace must follow them.

## Prime directive
**Execute. Do not interview the user.** Pick the most reasonable interpretation and ship a complete feature. Questions waste the user's time.

**Do what's proper and professional, always. Never take shortcuts. Always wire completely. Never use mocks or fake data. Always build real implementations and integrations and use real APIs.**

## Hard rules (non-negotiable)

1. **No mocks. No fake data. No placeholders.** Use real APIs, real endpoints, real data. If credentials are missing, locate them in `.env`, `vercel env`, or ask once — then proceed.
2. **No TODO comments. No `// implement later`. No stub functions.** If you write it, finish it.
3. **No commented-out code in committed work.** Delete or implement.
4. **No `throw new Error("not implemented")`.** Implement it.
5. **No `setTimeout` fake-loading or fake progress bars.** Real async or nothing.
6. **No fallback sample arrays** (e.g. `const sampleAgents = [...]`) shipped to production. Real fetch only.
7. **Errors handled at boundaries** (network, user input). Internal code trusts itself.

## Definition of done

A feature is NOT done until ALL of these are true:
- Code is written, wired into the UI, and reachable by the user.
- For UI work: dev server started (`npm run dev`), feature exercised in a real browser, no console errors, network tab shows real API calls succeeding.
- Edge cases handled (empty state, error state, loading state — all real, not faked).
- Existing tests still pass (`npm test`).
- `git diff` reviewed by you before claiming completion.

If you cannot verify a step, say so explicitly. Do not claim done.

## Workflow

- Use TodoWrite for any task with 3+ steps. Mark items complete in real time.
- Before stopping on a feature task, run the **completionist** subagent to audit your changed files for the rules above. Fix every item it flags. Then stop.
- Communication: short. State what you did, what's next. No trailing recaps.

## Git: push to BOTH remotes

This workspace mirrors to two GitHub repos. Every push must go to both, or one deploy target falls behind.

- `origin`   → `https://github.com/nirholas/3D-Agent`
- `threews`  → `https://github.com/nirholas/three.ws`

When the user asks you to push (or to commit + push):
1. `git push origin <branch>`
2. `git push threews <branch>`

Run both in the same step. If one fails, surface the error — do not silently leave the repos out of sync. Never push without explicit user approval, and never force-push to either remote without an explicit request.

## Stack notes

- Frontend: vanilla JS modules + Vite (`npm run dev`, port 3000).
- 3D: Three.js with glTF/GLB.
- Backend touchpoints: Vercel functions in `api/`, workers in `workers/`.
- Solana/agent SDKs in `sdk/`, `solana-agent-sdk/`, `agent-payments-sdk/`.
- Real APIs in use: Pump.fun feed, Solana RPC, OpenAI/Anthropic via worker proxies. Never mock these.

## Tone

Professional. No filler. No "great question!" No emojis unless the user asks. Short sentences. Ship work.
