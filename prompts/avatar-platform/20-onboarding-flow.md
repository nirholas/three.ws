# Task: First-run onboarding — QR → photo → preview → name → ready

## Context

Repo: `/workspaces/3D`. The individual pieces — photo capture (04, 06), avatar generation (07, 08), editor (16), brain (14) — are all in. This task wires them into a single, delightful first-run experience that matches or exceeds Avaturn's signature flow.

Should be scheduled **after** tasks 04, 06, 07, 08, 14, 16, 18 are in.

## Goal

1. A new user visits the app and within 90 seconds has:
   - A personalized 3D avatar based on their photo.
   - A name entered.
   - A first conversational exchange with the agent.
   - Their state persisted locally for future visits.
2. Returning users land directly in the main experience; onboarding does not re-prompt.
3. Onboarding is skippable — "Use a default avatar and explore" route always available.

## Deliverable

1. **Onboarding controller** `src/onboarding/flow.js`:
   - Steps: `welcome → choose-capture → capture → fast-generating → fast-preview → name → ready` (with `hd-upgrade` happening in the background after `fast-preview`).
   - State machine, explicit transitions, every step has a "back" exit.
2. **Welcome** — one-screen hero: "Meet your agent." CTA: "Create my avatar" / secondary "Use a default".
3. **Choose capture** — two tiles: "Scan QR with phone" (opens task 06 desktop QR UI) / "Use webcam" (opens task 04). Third option: "Upload three photos" (file picker, gates only by file count + type).
4. **Fast generating** — loading screen with the fast-path (task 07) running. Subtle copy: "Meeting you…" — 3–5s max on a mid-range machine.
5. **Fast preview** — the avatar appears, rotating in the hero spot. User can:
   - **Retake** — back to capture.
   - **Looks good** — proceed.
   - **Tweak** — open the editor panel (task 16) inline; finishing takes them to "name".
6. **HD upgrade (background)** — task 08 runs asynchronously. On completion, a small "HD-ready" toast lets the user accept/dismiss. Accepting hot-swaps the avatar without interrupting flow.
7. **Name** — single input, default suggestion "My Agent". Stored to IndexedDB + sent as system-prompt context to the brain (task 14).
8. **Ready** — opens the agent panel with a welcome message that uses the user's name and avatar description. Agent (task 14 brain) already knows the viewer state.
9. **Persistence** — all state (avatar VRM blob, name, editor customizations) stored in IndexedDB under the `agentId` (task 15). On return, restored.
10. **Skip-and-explore** — "Use default" route bypasses everything, loads [template-neutral.vrm](../../public/avatars/template-neutral.vrm), still opens the name prompt but pre-fills "Guest".
11. **Reduced motion + a11y** — every step keyboard-navigable, reduced-motion skips transitions, focus order sensible.

## Audit checklist

- [ ] Brand-new browser profile → welcome appears.
- [ ] Full happy path (QR / webcam / upload) completes in < 90s on a dev machine with good network.
- [ ] Back button on every step returns to the prior step without data loss.
- [ ] HD-upgrade toast appears within 90s of fast-preview and the swap works.
- [ ] Reload mid-onboarding → returns to the correct step with preserved state.
- [ ] "Use default" route bypasses capture and still reaches the Ready step.
- [ ] Returning user → no onboarding; main app.
- [ ] "Reset onboarding" in the settings panel (task 15) reruns the flow.
- [ ] Lighthouse Performance ≥ 90 on the welcome route (first meaningful paint < 2s).

## Constraints

- No new ML models in this task — reuse 07 and 08's pipelines.
- No telemetry / analytics on onboarding completion.
- Do not require login / email / wallet.
- Do not pre-fetch the HD pipeline model weights — user must consent to the HD upgrade (even if that consent is implicit by accepting the toast).
- Do not wire up social sign-in, wallets, or cross-device.

## Verification

1. Complete end-to-end on Chrome, Safari (webcam path; iOS Safari for QR path), Firefox.
2. Three different faces → three distinct onboardings; each resulting avatar is recognizable.
3. Slow 3G throttled → HD upgrade times out gracefully; fast-path avatar is retained.
4. Refresh mid-flow → resume.
5. Full "Reset onboarding" + redo → final state replaces prior cleanly.

## Scope boundaries — do NOT do these

- No tutorial overlays beyond onboarding itself.
- No avatar naming beyond a single string (no avatar species, no backstory wizard).
- No social "share your avatar" — future task.
- No A/B testing infrastructure.
- No multi-avatar profiles (one avatar per agentId for now).

## Reporting

- End-to-end time measurement for the happy path (fast-only and fast+HD).
- Step conversion: you can't measure without telemetry, but **document where you'd put it** for future wiring.
- Any UX dead-ends you noticed (buttons that lead nowhere, back-button loops).
- Known device/browser quirks in the capture steps.
- A short qualitative verdict: does this feel better than Avaturn's flow? Where does it still fall short?
