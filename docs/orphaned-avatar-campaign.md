# Bring your avatar: landing copy and post set (draft for owner approval)

Status: draft. Nothing here is published or posted. The owner approves the wording, then posts it. Wording is neutral on purpose: it names no company and makes no comparison, so it stays true whichever avatar service a reader came from.

## Audience

People whose avatar lived in a cross-game avatar service that has since closed its hosted creator and public endpoints. Their exported `.glb` and `.vrm` files still load anywhere, but the apps and embeds that depended on the hosted service are left without a home for them. These readers already own a file. They need a place where that file keeps working and gains a purpose.

## What is true today (the only facts the copy may use)

Every line below is shipped and covered by a test or a live page. Sources: [import page](https://three.ws/import/rpm), `src/game/vrm-loader.js`, `src/game/vrm-expressions.js`, `src/animation-retarget.js`, `src/glb-canonicalize.js`, `tests/vrm-real.test.js`, `tests/import-rpm-source.test.js`, [Avatar engines](./avatar-engines.md), [Embedding](./embedding.md).

| Claim | Ground truth |
|---|---|
| Import by URL or by file | `/import/rpm` has a URL tab and a file tab. The server fetches URLs, so cross-origin rules do not block it. |
| `.glb` and `.vrm` accepted | The file tab accepts both. VRM 0.x and 1.0 load through the real `@pixiv/three-vrm` plugin. |
| VRM features work | MToon materials, spring-bone physics, node constraints, look-at and the 18 expression presets (`tests/vrm-real.test.js`). |
| `.vrma` animation clips play | Loaded through `VRMAnimationLoaderPlugin` and retargeted, so one clip plays on a VRM and on a Mixamo-named humanoid. |
| Voice and face capture drive VRM avatars | Expression presets map onto the ARKit-52 driver (`src/game/vrm-expressions.js`). |
| Any humanoid rig animates | Bone names from Mixamo, Avaturn, Unreal, VRM/VRoid, Daz, MakeHuman, Blender and simple rigs map to one canonical set, then the idle and walk clip library applies. A rig that cannot be skeleton-driven falls back to the default rig, never a T-pose. |
| The avatar is yours | It is stored in your account as a `.glb`, ready to become an agent with a wallet, and embeds anywhere with `<agent-3d>`. |
| Import reliability | A bug that made every import fail at the final save step was fixed with a regression test (`tests/import-rpm-source.test.js`). |

Do not claim: any count of imported avatars, any migration tool for a specific service, partnership or endorsement language, or any statement about another company's business.

## Landing copy

**Headline:** Your avatar file keeps working here.

**Subhead:** Bring the `.glb` or `.vrm` you already have. It loads, moves and talks on three.ws, and you can put it on any website with one tag.

**Primary button:** Import my avatar (links to `/import/rpm`)

**Three points**

1. **Bring it as it is.** Paste the file's URL or upload it. We read VRM 0.x and 1.0 with full support for toon materials, hair and cloth physics and facial expressions.
2. **It moves right away.** Whatever rig it has, it plays the idle and walk library. VRM animation clips (`.vrma`) play too, and voice or camera capture can drive its face.
3. **Give it a job.** Turn it into an agent with its own page and Solana wallet, or embed it on your site:

```html
<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js"></script>
<agent-3d src="https://example.com/my-avatar.glb"></agent-3d>
```

**How to find your file:** if your app loaded the avatar from a link, open the browser's developer tools, switch to the Network tab, filter by `.glb`, and copy the request URL. If you saved the file earlier, use the file tab.

**Footer line:** Free to import. Your file stays yours.

Implementation note: the existing page `pages/import-rpm.html` already is the destination and is marked `noindex`. Publishing this copy as a public page means adding a `data/pages.json` entry, removing `noindex`, and a deploy, which are owner-gated. The wording above is ready to drop into that page.

## Post set (not posted)

Each post links to `https://three.ws/import/rpm`. Add the image from a real import screenshot taken by the owner. Tone: friendly opening, technical detail after.

**Post 1, launch (X)**
If you have an avatar file sitting on your drive and nowhere to use it, bring it to three.ws. Paste a link or drop a .glb or .vrm and it moves, talks and embeds on any site. Free to import.

**Post 2, VRM depth (X)**
VRM support on three.ws is the real thing: MToon toon shading, spring-bone hair and cloth, 18 expression presets and .vrma animation clips. Same clip, any humanoid rig. Voice and camera capture drive the face.

**Post 3, one tag (X)**
Put your avatar on your website with one tag:
`<agent-3d src="your-avatar.glb"></agent-3d>`
No account needed to embed. Import yours at three.ws/import/rpm.

**Post 4, make it an agent (X)**
An avatar is better with a purpose. Import it, give it a personality, and it becomes an agent with a public page and its own Solana wallet. $THREE holders and builders are already doing this.

**Post 5, how-to thread (X, 4 parts)**
1. Find your avatar's file: open dev tools, Network tab, filter by .glb, copy the URL.
2. Open three.ws/import/rpm and paste it, or upload the file.
3. Pick a name. Your avatar is saved to your account.
4. Embed it, animate it, or turn it into an agent.

**Long-form article outline (blog or community forum)**
- Friendly opening: what it feels like to own an avatar file and want it to keep working.
- What import accepts and where the file ends up.
- VRM in depth: shading, physics, expressions, `.vrma`, one clip across rigs (technical middle).
- Embedding with `<agent-3d>` and driving moods from page code.
- Turning an avatar into an agent: page, wallet, skills.
- Ecosystem and partners: list only partner designations already published in the repo's partner docs, with their exact wording.
- Technical appendix: bone canonicalization, retargeting, how expressions map to ARKit-52.

## Owner step

Approve this wording and post it. Publishing the public page is the single command-level step: add the `data/pages.json` entry, drop `noindex` from `pages/import-rpm.html`, and deploy. Nothing else is outstanding.
