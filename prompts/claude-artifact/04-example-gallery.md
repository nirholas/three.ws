# Task: Example gallery of ready-to-paste Claude Artifact templates

## Context

Repo: `/workspaces/3D`. Tasks [./01-artifact-snippet.md](./01-artifact-snippet.md), [./02-zero-dep-viewer-bundle.md](./02-zero-dep-viewer-bundle.md), and [./03-idle-animation-loop.md](./03-idle-animation-loop.md) together produce:

- A hosted bundle at `https://3dagent.vercel.app/artifact.js` exposing `Agent3D.mount(target, opts)`.
- A single minimal HTML snippet users paste into a Claude chat to render their own agent.

This task extends that with a **curated gallery of ready-to-paste templates** for the four main use cases. The goal is that a Claude user (or, meta-circle, a Claude instance generating HTML for its user) can pick the closest template and paste it verbatim.

Relevant existing files:
- [../../public/agent/index.html](../../public/agent/index.html) — already hosts a share panel; add a "Claude Artifacts" tab group here.
- [../../public/artifact/snippet.html](../../public/artifact/) — produced by task 01.
- [../../public/artifact.js](../../public/artifact.js) — produced by task 02.
- [../../src/erc8004/abi.js](../../src/erc8004/abi.js) — ERC-8004 registry deployments per chain.

## Goal

Produce four self-contained Claude Artifact HTML templates, each &lt;3 KB, hosted and discoverable on a single gallery page. Each template is copy-pasteable into Claude's Artifact code editor with minimal or no modification.

## The four templates

### A. "My agent"
The trivial case — the signed-in user's own agent.
```html
<script src="https://3dagent.vercel.app/artifact.js"></script>
<script>
  Agent3D.mount('#a', { agentId: 'AGENT_ID_HERE' });
</script>
```
*Already delivered by task 01. Just reference it from the gallery.*

### B. "Any wallet's agent"
Resolve the primary agent for a given Ethereum address.
```html
<script src="https://3dagent.vercel.app/artifact.js"></script>
<script>
  Agent3D.mount('#a', { wallet: '0xWALLET_HERE' });
</script>
```
*Depends on the bundle's `wallet` mode (task 02). If the wallet has no registered agent, the bundle renders the stand-in.*

### C. "Any ERC-8004 agent from chain"
Look up directly by onchain agent id.
```html
<script src="https://3dagent.vercel.app/artifact.js"></script>
<script>
  Agent3D.mount('#a', { chain: 'base', onchainId: 42 });
</script>
```
*`chain` accepts keys from `REGISTRY_DEPLOYMENTS` in [../../src/erc8004/abi.js](../../src/erc8004/abi.js). Document the supported chain keys inline in the gallery.*

### D. "Talking agent — responds to chat messages via postMessage"
The novel template. The Artifact sandbox receives `postMessage` from its parent (Claude's chat UI) or from a sibling Artifact, and the avatar responds by speaking the text (routing through the Empathy Layer so the face reacts).
```html
<script src="https://3dagent.vercel.app/artifact.js"></script>
<script>
  const agent = Agent3D.mount('#a', { agentId: 'AGENT_ID_HERE' });
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg && msg.type === 'speak' && typeof msg.text === 'string') {
      agent.then(a => a.say(msg.text));
    }
  });
</script>
```
*Caveat: Claude's chat UI does not currently post arbitrary messages into Artifact iframes. This template is valuable for (1) Artifact-to-Artifact communication within the same chat, (2) hosts beyond Claude that adopt the same protocol, (3) future Claude features. The gallery page must document this caveat clearly.*

## Deliverable

1. **File created** — `public/artifact/gallery.html`. A static page under `/artifact/gallery` that:
   - Lists the four templates as cards with a live preview iframe for each (loading `public/artifact/preview-{a,b,c,d}.html`).
   - Each card has a "Copy" button that copies the template's HTML snippet to clipboard.
   - Includes the Artifact-sandbox caveats from [./README.md](./README.md) in a short expandable section.
   - Minimal CSS, self-contained, no frameworks.

2. **Files created** — `public/artifact/preview-a.html`, `preview-b.html`, `preview-c.html`, `preview-d.html`. Each is a rendering of the corresponding template with a working placeholder id/wallet/onchainId so visitors can see what the result looks like before pasting into Claude.

3. **Files created** — `public/artifact/tpl-a.html`, `tpl-b.html`, `tpl-c.html`, `tpl-d.html`. The raw exact snippet served at `https://3dagent.vercel.app/artifact/tpl-{a,b,c,d}.html`. Text/html; the gallery copy button fetches these and writes to clipboard.

4. **Edit** — add a section to [../../public/agent/index.html](../../public/agent/index.html)'s share panel linking to `/artifact/gallery` from the existing "Claude Artifact" tab (introduced in task 01). Do not duplicate the templates there.

5. **Edit** — append a link from the repo's top-level documentation surface — concretely, add one bullet to [../../prompts/README.md](../../prompts/README.md) row 5 noting the gallery URL once live. (This is the one docs-edit that's explicitly allowed for this task.)

## Audit checklist — must handle all of these

- Each template, as served, is byte-stable across rebuilds (no timestamps/hashes in the file).
- Each template is &lt;3 KB raw.
- All four preview iframes load `artifact.js` and render their respective resolved agents. If resolution fails, each preview shows the bundle's stand-in overlay — not a browser error page.
- Copy buttons write the exact template string (byte-identical to the `tpl-*.html` payload).
- Gallery page has no inline API keys, no trackers, no third-party requests except `artifact.js` (and whatever three.js CDN that triggers).
- Gallery works when loaded via a non-same-origin iframe (e.g. embedded on LobeHub's docs). Test this.
- Template D's caveat about postMessage is displayed prominently near the template, not buried in a footnote.
- The `chain` keys listed in template C exactly match the keys present in `REGISTRY_DEPLOYMENTS` in [../../src/erc8004/abi.js](../../src/erc8004/abi.js) at the time of shipping. Spot-check.

## Constraints

- No new runtime deps.
- No build-time deps beyond what task 02 introduces.
- Do not edit [../../src/element.js](../../src/element.js), [../../src/viewer.js](../../src/viewer.js), or any other `src/` files.
- Do not add new API endpoints. Reuse what tasks 01/02 expose.
- Do not create a "Claude Artifact tutorial" page beyond the gallery itself. Terse.
- Do not introduce React, Tailwind, or any CSS framework. Plain HTML+CSS.
- Clipboard copy must use `navigator.clipboard.writeText`. No third-party clipboard lib.

## Verification

1. `curl https://localhost:PORT/artifact/tpl-a.html` (or `preview vercel dev`) — confirm each template file serves as `text/html` with the exact bytes.
2. `wc -c public/artifact/tpl-*.html` — report sizes.
3. Open `/artifact/gallery` in a browser. Each of the four previews shows a live breathing avatar (for A, B, D) or the stand-in (for C with an onchainId that likely doesn't exist in dev).
4. Click each Copy button, paste into a text editor, diff against the `tpl-*.html` file — must be byte-identical.
5. Paste template A into a real Claude Artifact. Describe result.
6. Paste template B into a real Claude Artifact, using a wallet known to have a registered agent (use one from `/api/agents`). Describe result.
7. Paste template C into a real Claude Artifact with a real onchain id if one is registered, else describe the stand-in behaviour.
8. Paste template D into a real Claude Artifact, then in the browser devtools console of the Artifact frame run `window.postMessage({ type: 'speak', text: 'hello from the parent' }, '*')`. Confirm the avatar reacts (Empathy Layer emotion shift + mouth animation via `say()`).

## Scope boundaries — do NOT do these

- Do not build LobeHub-specific templates — those live in [../lobehub-embed/](../lobehub-embed/).
- Do not wire the gallery into a backend (no database, no analytics). Static files only.
- Do not add template variants for "floating widget", "fullscreen", etc. — scope is the four listed.
- Do not write a CLI tool that generates templates. Static files only.
- Do not propose a postMessage protocol spec. Template D documents one useful message shape and stops there.

## Reporting

At the end, summarise:
- Files created under `public/artifact/` with byte counts.
- The one `prompts/README.md` edit (one bullet, line number).
- The paste-into-Claude result for each of the four templates — one line each.
- Any template that did NOT work in a live Claude Artifact and why.
- Any sandbox surprise discovered during gallery testing (blocked domain, CORS refusal, clipboard API denial inside Artifact).
- Any unverified assumption about Claude's iframe sandbox that should be re-checked before marketing this gallery.
