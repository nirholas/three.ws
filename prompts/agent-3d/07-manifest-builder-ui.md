# Task 07 — Form-based manifest builder UI

## Context

Today a user creating an agent has two options: edit `manifest.json` by hand, or use [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) (which only captures name/description/GLB and produces an ERC-8004 registration JSON — a subset of the full manifest).

End-users should not touch JSON. The manifest builder replaces `register-ui.js` as the standard on-ramp — one form, every manifest field, progressive disclosure of advanced options, live preview via the `<agent-3d>` element.

See [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) for every field that needs a control.

## Goal

Ship `src/editor/manifest-builder.js` — a shadow-DOM form UI that produces a valid agent manifest bundle (manifest.json + instructions.md + memory/ + optional skills/) and either downloads it as a ZIP, pins it to IPFS, or registers it on-chain.

## Deliverable

1. **`src/editor/manifest-builder.js`** — `mountManifestBuilder(rootEl, options)` pattern mirroring [src/editor/embed-editor.js](../../src/editor/embed-editor.js).
2. **Form sections** (collapsible, in this order):
	 - **Identity** — name, description, tags, image (defaults to first GLB thumbnail).
	 - **Body** — GLB drop-zone (reuses `simple-dropzone`), auto-detected rig (Mixamo / VRM), auto-computed bounding box height.
	 - **Brain** — provider select (Anthropic / OpenAI / none), model dropdown filtered by provider, temperature slider, `maxTokens`, thinking toggle.
	 - **Voice** — TTS provider select, STT provider select, per-provider secondary fields (voiceId for ElevenLabs, language for Browser/Whisper).
	 - **Skills** — searchable list of known skills (load from `public/skills-index.json` — stub with 3 entries for now: wave, dance, explain-gltf). Each skill has "Install" toggle and version pin. Manual URI paste for custom skills.
	 - **Memory** — mode select (`local` / `ipfs` / `encrypted-ipfs` / `none`), maxTokens, advanced: timeline retention days.
	 - **Instructions** — markdown textarea with monospace font and live char counter. Frontmatter auto-prepended on export.
	 - **Provenance** (read-only until GLB loaded) — glTF validator report. Show errors/warnings count + a details drawer.
3. **Live preview panel** — always-mounted `<agent-3d>` inside the builder, manifest= fed by a blob URL of the current form state, re-mounted on change (debounced).
4. **Export actions**:
	 - **Download ZIP** — bundles manifest.json, instructions.md (with frontmatter), any dropped GLB, memory/MEMORY.md seed, and referenced skill bundles (if local). Pure client-side.
	 - **Pin to IPFS** — uses the configured pinner (see [08-ipfs-pinning-service.md](./08-ipfs-pinning-service.md)). On success, shows the CID and a copy-to-clipboard link.
	 - **Register on-chain** — opens the existing ERC-8004 flow with the IPFS CID pre-filled.
5. **Routing** — add to `agent-home.html` (already in [vite.config.js](../../vite.config.js)) as the canonical "create agent" page.

## Audit checklist

- [ ] Every manifest field documented in [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) has a corresponding control (or is explicitly noted as power-user-only and exposed in a raw JSON tab).
- [ ] Schema validation: form outputs JSON that passes a Zod/JSON Schema check derived from the spec. Show inline field errors.
- [ ] The live preview updates within 500ms of form changes without a full Viewer rebuild (swap GLB only when the body field changes).
- [ ] Skill install order preserves manifest array order.
- [ ] Markdown instructions preview renders via a tiny renderer (no new dep — a 50-line renderer is fine).
- [ ] Copy-paste a known-good manifest into a "Raw JSON" tab and the form hydrates from it. Round-trip identity: form → JSON → form yields the same JSON.
- [ ] ZIP export opens cleanly in Finder / Explorer, contains manifest.json + instructions.md + body.glb (if dropped).
- [ ] Feature flag: this builder is gated behind `?editor=v2` until the old register-ui is deprecated.

## Constraints

- No new npm dependencies. Use the existing `zod` (already in deps) for validation.
- Do not delete [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) in this task. Mark it deprecated in a code comment.
- Reuse [src/editor/embed-editor.js](../../src/editor/embed-editor.js)'s visual language — same accent color, same panel styling, same `aside` width — so the Create flow and Embed flow feel like siblings.
- Do not persist draft state on a backend. localStorage autosave is fine (one slot per browser).

## Verification

1. `node --check src/editor/manifest-builder.js`.
2. `npm run build` passes.
3. Manual: author a Coach Leo clone in the builder, download ZIP, extract, `diff` against `examples/coach-leo/` — structural parity.
4. Pin flow: with `__agent3dPinner` mocked to an in-memory store, confirm the CID round-trips back into a `manifest="ipfs://..."` preview.

## Scope boundaries — do NOT do these

- Do not introduce a WYSIWYG rich-text editor for instructions. Plain markdown textarea.
- Do not build a skill marketplace in this task — the skills index is a static JSON stub.
- Do not handle wallet connect / registration — defer to existing ERC-8004 flow.
- Do not add AI-assisted manifest generation (generate instructions from a prompt, etc.). Separate future task.

## Reporting

- Confirm the Raw-JSON round-trip works and list any fields that were lossy.
- Bundle size impact of the builder (strip unused fields if significant).
- UX friction points observed during a full author-to-ZIP pass.
- Any spec fields that didn't map cleanly to a form control — flag for spec refinement.
