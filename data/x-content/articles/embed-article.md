We pasted two lines of HTML into an empty file, opened it in a browser, and watched what the page did with them. A script tag loaded the `<agent-3d>` element from three.ws. The element, pointed at a 3D body, reported its boot as five phases in order: manifest, body, memory, skills, brain. Then it announced that it was ready, and the avatar on screen was already standing in a relaxed idle pose, on the page's own background, with no chat box or controls around it. There was no API key and no build step anywhere in that run.

That moment is the subject of this article. A 3D file is not a picture: when a character file lands in a renderer, it appears in the pose it was built in, which for most humanoid rigs is a T-pose with the arms held straight out. The element holds the frame back until a natural idle has rendered, so a visitor sees a person standing and not a mannequin being assembled. The sections below follow the same snippet through each stage between the tag and that frame, then through the choices that let the same tag sit safely on a busy page: pinned versions with integrity hashes, one idle clip that fits many skeletons, reduced motion, and a budget for how many avatars are alive at once. The numbers and claims in this piece come from the live reference, the element's source, or a capture we took while writing, and each is checked against the product before the article goes out.

## The whole embed

This is the entire embed. It pins an exact release of the element and checks the file against its integrity hash, which is the form the reference recommends for production pages:

```html
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"
        integrity="sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q"
        crossorigin="anonymous"></script>

<agent-3d body="https://three.ws/avatars/default.glb"
          style="width:480px;height:640px"></agent-3d>
```

The `body` attribute takes the address of a GLB file the browser is allowed to fetch. The one above is the platform's default body. Your own avatar, or a model you generated a minute ago, goes in the same attribute. The element's source attributes follow a fixed priority, so one tag can also point at a published agent instead of a bare body:

| Attribute | What it points at | Example |
|---|---|---|
| `src` | An on-chain agent URI | `src="agent://base/42"` |
| `agent-id` | A numeric id, a CAIP-10 id, or a backend account id | `agent-id="a_abc123"` |
| `manifest` | An IPFS or HTTPS manifest URL | `manifest="ipfs://bafy.../manifest.json"` |
| `body` | A bare GLB URL, which makes an ad-hoc agent | `body="https://three.ws/avatars/default.glb"` |

When several are set, the order of precedence runs from `src` down to `body`. The features beyond the silent viewer are opt-in, so a bare `body` tag makes no calls beyond the GLB itself.

![A plain HTML page we wrote for this article, with the snippet in its right-hand column. The avatar is the platform's default body, idling on the page's own background, with no chat box or controls around it.](/x-media/embed-article/demo-page.png)

## What the page reports while it boots

The element reports its own progress, which is what made it possible to watch the run. Each step fires an `agent:load-progress` event carrying a `phase` and a `pct` from 0 to 1, and the sequence ends in `agent:ready`. All events bubble and are composed, so they cross the element's shadow DOM boundary and can be caught on any ancestor. This listener, pasted under the snippet above, printed the boot as it happened:

```html
<script type="module">
  const el = document.querySelector('agent-3d');
  el.addEventListener('agent:load-progress', (e) => {
    console.log(e.detail.phase, e.detail.pct);
  });
  el.addEventListener('agent:ready', () => console.log('on screen, idling'));
  el.addEventListener('agent:error', (e) => console.error(e.detail.phase, e.detail.error));
</script>
```

The lifecycle events are a short table in the reference:

| Event | Detail | When it fires |
|---|---|---|
| `agent:load-progress` | `{ phase, pct }` | Incremental boot progress through manifest, body, memory, skills and brain |
| `agent:ready` | `{ agent, manifest }` | Fully booted, with the body already on screen holding its idle |
| `agent:error` | `{ phase, error }` | A fatal problem during boot or at runtime, with the phase it happened in |

The reference describes `agent:ready` as the event to swap out your own placeholder image on. A page can show a still of the avatar, listen for the event, and remove the still the moment the live body takes over, with the same pose on both sides of the swap.

![The events section of the live reference at three.ws/docs/web-component, showing the lifecycle event table with agent:ready, agent:load-progress and agent:error and the note that the body is already on screen holding its idle clip.](/x-media/embed-article/docs-events.png)

## Why the avatar waits for its pose

A renderer paints a rig the moment the file lands, and the file's rest state is its bind pose. The idle animation takes over once its clip has been fetched and retargeted onto that skeleton. Between those two moments a naive embed shows a T-pose for a beat, and the visitor sees an avatar that is assembling itself.

The element handles this in four steps, in this order.

1. **The stage is held fully transparent.** The canvas exists and the renderer runs, but the stage carries a settling class that keeps it invisible and switches its fade off.
2. **The idle snaps in with no crossfade.** A crossfade would blend the clip in from the bind pose, and the arms would visibly swing down. The element starts the idle with no fade instead.
3. **Two frames pass.** One frame poses the body and a second composites it. The stage is revealed after both, so the opening frame a visitor sees already shows the idle.
4. **The stage fades in.** The settling class is removed and a short opacity transition brings the avatar up, after which the ready event fires.

![Three captures of the same embed loading in headless Chromium. Left: the canvas exists but is held invisible. Middle: the frame where it was revealed, with the idle already playing. Right: the same avatar about two seconds later, still idling.](/x-media/embed-article/opening-frame.png)

A body that cannot take the idle, such as a prop or a quadruped, is revealed all the same on whatever pose the file gave it. The element does not invent a skeleton the file does not have.

## One idle clip for many skeletons

The idle is one clip from the platform's shared library, authored on one skeleton. Avatars from different tools name their bones differently, so before the clip plays, each bone name in the loaded rig is mapped onto one canonical set, and the clip's tracks are rewritten to address the rig's own bones. The mapping recognises the naming conventions of the common avatar tools. The reference table in the source header includes these:

| Source | Example bone names |
|---|---|
| Mixamo | `mixamorig:LeftArm`, `mixamorig1:LeftArm` |
| Blender | `Armature_LeftArm`, `upperarm.L` |
| Rigify | `DEF-LeftArm`, `ORG-LeftArm` |
| Unreal mannequin | `pelvis`, `clavicle_l`, `upperarm_l` |
| VRM and VRoid | `J_Bip_C_Hips`, `J_Bip_L_UpperArm` |
| VRM 1.0 | `upperChest`, `leftUpperArm` |
| Daz and Genesis | `hip`, `abdomen`, `lShldr` |
| Second Life | `mPelvis`, `mCollarLeft` |

The same mapping reaches the fingers. Of the 53 tracks in each clip of the library, 30 drive a finger joint, so a rig with a full hand skeleton gets a hand that moves with the body.

The capture below puts five bodies from the platform's avatar folder on one page, each in its own `<agent-3d>` element: the default body, Michelle, a realistic female, a realistic male, and the X Bot mannequin. They were loaded from the pinned snippet above. Michelle is a Mixamo character whose bones carry the `mixamorig:` prefix, and the others name theirs in their own ways. All five stand in an idle pose, retargeted on load.

![Five bodies from three.ws/avatars, each rendered live by its own agent-3d element on one page: default, michelle, realistic-female, realistic-male and xbot. Each is standing in an idle pose with its own proportions.](/x-media/embed-article/five-bodies.png)

The clip is long enough to read as a person and not a loop. The idle runs 15.8 seconds and repeats, and the shared library behind it is a public manifest you can read.

There is also a floor, and it is a design choice. A clip retargets when at least half of its tracks find a matching bone on the rig. Below that, the motion would read as a few twitching joints, so the retarget builds no animation at all and the body keeps the pose its file gave it. A new naming convention is handled by adding its mapping to the canonicalizer, not by maintaining a list of supported rigs.

## Pinned versions you can trust

The script URL carries a version, and the version decides how your page changes over time. The reference lays the choices out as a table:

| Path | Cache | Use it when |
|---|---|---|
| `/agent-3d/1.5.2/agent-3d.js` | Immutable | Production. Pin exact bytes and combine with an integrity hash. |
| `/agent-3d/1.5/agent-3d.js` | 5 minutes at the CDN, up to an hour in a browser | You want the newest code on one minor line. |
| `/agent-3d/1/agent-3d.js` | 5 minutes at the CDN, up to an hour in a browser | You want the newest code on one major line. |
| `/agent-3d/latest/agent-3d.js` | 5 minutes at the CDN, up to an hour in a browser | Demos and prototypes. |

An exact version is cut once. Each release is uploaded to a write-once archive, its integrity hashes are recorded in a ledger, and each deploy serves the archived bytes after checking them against that ledger. The hash in the snippet at the top of this article is therefore a hash of the release itself, which is why it stays valid for as long as the release exists. The full manifest is public, and an unchanged manifest answers a conditional request with a `304` and no body:

```bash
curl -s https://three.ws/agent-3d/versions.json
# {"latest":"1.5.2","channels":{"1.5.2":{"integrity":{...},"immutable":true,...},...}}

curl -s https://three.ws/agent-3d/1.5.2/integrity.json
```

The element also ships as `agent-3d.umd.cjs` for pages without ES modules, and as an ES module you can import. The reference includes integration snippets for React, Vue and Svelte, and it covers WordPress, Webflow, Framer, Notion embeds and Shopify, so the same tag travels across hosts.

## Bare by default, still when asked

A plain tag with a `body` is a bare avatar: a transparent canvas and the character, with no chat box, no input, no debug controls and no name plate. The page behind it shows through, which is why the avatar in the demo stands on the page's own background instead of in a box.

It also listens to the visitor's motion setting. When the system asks for reduced motion, a bare avatar settles into a single clean idle pose and freezes there, which also lets the render loop stop drawing and costs no continuous GPU or CPU time. We checked this while writing. With reduced motion emulated in the browser, captures taken seconds apart came out byte for byte identical, while the same page without the setting changed between captures. The element watches the setting live, so switching it in the operating system takes effect without a reload.

Motion the visitor asks for still plays. `playClip` resolves a clip name from the public animation manifest and retargets it onto whatever skeleton the page loaded, and the `userInitiated` option is the call for an animation behind a button:

```js
const el = document.querySelector('agent-3d');
const clips = await (await fetch('https://three.ws/animations/manifest.json')).json();

document.querySelector('#wave').addEventListener('click', () => {
  el.playClip(clips[0].name, { fade_ms: 400, userInitiated: true });
});
```

Looping clips loop, and one-shot clips play once and settle back into the idle without a snap at the boundary. Pass `userInitiated: true` when a real gesture asked for the motion, so ambient autoplay stays suppressed for visitors who asked for stillness.

## Many avatars on one page

The element is built to be used more than once on a page. Browsers cap how many WebGL contexts can be alive at once, around 16 in Chrome, and the oldest context is silently lost when a page asks for more. An avatar that loses its context freezes or goes blank. The element manages this budget itself, with three behaviours.

- **Lazy boot.** An IntersectionObserver watches each element and starts its boot when it comes within 300 pixels of the viewport, so an avatar far down a long page costs nothing until the reader scrolls toward it. The `eager` attribute skips the wait.
- **A live cap.** By default 8 avatars are live at a time. When another boots, the one that has been off screen longest releases its context, and it boots again by itself when it scrolls back into view.
- **A protected viewer.** The avatar a reader is looking at is not the one released.

The cap is a page-level setting. A page that knows its own budget can change it before the script loads:

```html
<script>window.AGENT3D_MAX_LIVE_VIEWERS = 4;</script>
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"
        integrity="sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q"
        crossorigin="anonymous"></script>
```

For scenes where several characters should share the stage, the reference describes `<agent-stage>`. It wraps several `<agent-3d>` elements in one WebGL context, each keeping its own brain, memory and voice, with a `formation` such as `row`.

## Styling and driving the avatar from your page

The avatar is a normal element, so the page controls its size with CSS and listens to it with events. Layout comes from the element's own width and height, and the host page's CSS does not leak into its shadow DOM beyond a small set of custom properties that theme the chat surface when chat is switched on. The `background` attribute chooses between `transparent`, `dark` and `light`, and `framing="portrait"` frames the head and shoulders for a profile card.

Because the methods are safe to call before the ready event, a page can wire behaviour up without waiting. `speak` triggers the lip-sync and talking gesture on the avatar without sending text to a model, which makes the avatar a presentation layer for logic you already have:

```js
const el = document.querySelector('agent-3d');
el.speak('Welcome to the site.');
el.addEventListener('agent:ready', () => {
  document.querySelector('#placeholder').remove();
});
```

The element also accepts messages from a parent page when it is placed in an iframe, and the reference documents that bridge together with its display modes and its sandboxing notes.

## Fallbacks, slots and strict pages

A page owner has to plan for the visitor whose script is blocked, whose connection is slow, or whose site runs a strict Content Security Policy. The element covers each of those with plain HTML, so the plan is a few lines of markup.

Content placed inside the tag is rendered as a fallback when JavaScript is disabled or the script fails to load. Named slots cover the moments inside a normal boot: a `poster` slot is shown during load and fades out when the model is ready, and an `error` slot replaces the default error overlay when loading fails. A page that wants a still of its avatar on screen from the moment the page paints, and a friendly message if the body fails to load, writes both in the markup:

```html
<agent-3d body="https://three.ws/avatars/default.glb" style="width:480px;height:640px">
  <img slot="poster" src="/img/guide-poster.webp" alt="Our guide, standing">
  <p slot="error">The 3D guide could not load. The page works without it.</p>
</agent-3d>
```

The element is also written for strict policies. The reference lists what it does and does not do to the host page:

| Concern | What the element does |
|---|---|
| Script injection | No inline `<script>` tags are added to the host page |
| Dynamic code | No `eval()` or `new Function()` |
| External resources | The GLB, environment maps and manifests load from URLs you provide in attributes |
| Decoders | The WASM decoders for compressed meshes and textures load from configurable CDN paths, and a self-hosted mode is supported |
| API keys | Model calls route through a `key-proxy` URL when one is set, so no keys sit in client-side markup |

An element placed in a sandboxed iframe needs `allow-scripts`, so that the element can run, and `allow-same-origin`, so that the browser can create a WebGL context.

## Built on open work

The element stands on open standards and open-source libraries. Rendering runs on [three.js](https://threejs.org), the MIT-licensed 3D library, at release 0.184 in this build. The body files are glTF, and the avatars in the demo are GLB files, glTF's single-file form. The platform also integrates the Khronos glTF-Validator for checking them. The element itself is a Custom Element with a Shadow DOM, two web platform standards, and its lazy boot uses the IntersectionObserver API from the same platform. The retargeting layer reads the naming conventions of tools it does not control, including Mixamo, Blender, Rigify, VRM and Unreal.

## The partners behind the embed

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below is stated as the [partners page](https://three.ws/partners) states it.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools, and an avatar made there can be placed on a page with the tag in this article.

**IBM.** IBM is listed as a Strategic partner. three.ws 3D agent identity integrates with IBM watsonx and IBM Granite, so an embedded agent can run an enterprise model behind its body.

**Amazon Web Services.** AWS is listed as a Cloud partner. three.ws is deployed on AWS infrastructure with Marketplace availability, so a page that embeds an avatar can sit inside a site hosted there.

**Google Cloud.** Google Cloud is listed as a Cloud partner. Google Cloud powers three.ws inference, storage, and real-time serving, and Vertex AI integration lets agents use Gemini models. The release archive behind the pinned embed files is a Google Cloud Storage bucket.

**Alibaba Cloud.** Alibaba Cloud is listed as a Cloud partner. It extends three.ws into APAC markets with Qwen model integration and regional MCP server deployment.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's program for startups building on accelerated computing. Every 3D generation lane already runs on NVIDIA silicon, which is where the bodies you embed come from.

**HackerNoon.** HackerNoon is listed as a Media partner: a builder-focused publishing partnership of feature articles, tutorials, and developer guides for people shipping with AI, which is where a tutorial like this one reaches builders.

**Quicknode.** Quicknode is listed as an Infrastructure partner, and three.ws is a member of the Quicknode Startup Program with approved infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind agent wallets, for the agents that carry an on-chain identity.

## Try it

The reference for the attributes, methods and events is the [`<agent-3d>` documentation](https://three.ws/docs/web-component), and the [end-to-end tutorial](https://three.ws/tutorials/web-component-end-to-end) walks the element through a real page. Start from the platform's default body at [three.ws/avatars/default.glb](https://three.ws/avatars/default.glb), find out whether your own GLB will animate with [Rig Doctor](https://three.ws/rig-doctor), which runs in your browser with nothing uploaded, and read the release manifest at [three.ws/agent-3d/versions.json](https://three.ws/agent-3d/versions.json). Make a new body in the browser at [three.ws/create/prompt](https://three.ws/create/prompt), or through the [3D Studio MCP server](https://three.ws/docs/mcp-studio), and put it in the `body` attribute.
