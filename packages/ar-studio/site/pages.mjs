// The three pages of the docs site. Content lives here as plain HTML strings so
// there is no template language to learn and no markdown renderer to ship.

export function homePage() {
	return `
<section class="wrap" style="padding-top:56px">
	<span class="pill">Apache-2.0 · one script tag · works on iPhone and Android</span>
	<h1>Put anything in your room.</h1>
	<p class="lead">
		A complete augmented-reality studio you can drop into any web page. Place as many 3D models
		as you like in your real space through the camera, describe a new one and watch it appear,
		arrange everything by hand, then share the whole scene as a link, a QR code, or a live room
		someone else can build in with you.
	</p>
	<div class="row" style="margin:22px 0 30px">
		<a class="btn primary" href="./studio.html">Open the live demo</a>
		<a class="btn" href="#quickstart">Add it to your site</a>
		<a class="btn" href="https://github.com/nirholas/3D-AR-Studio">Star on GitHub</a>
	</div>
	<div class="stage"><ar-studio embedded style="position:absolute;inset:0;min-height:0"
		title="Live demo" share-base="https://nirholas.github.io/3D-AR-Studio/studio.html"></ar-studio></div>
	<p style="font-size:13px;color:var(--faint);margin-top:12px">
		That frame is the real package, running the same code you install. On a phone, tap
		<strong>Place in your space</strong> and the model is anchored to your actual floor by
		ARKit or ARCore. <strong>Camera</strong> is the in-page preview beside it: it turns with
		the phone, it does not track the room.
	</p>
</section>

<section class="wrap" id="quickstart">
	<div class="eyebrow">Quick start</div>
	<h2>One line, and you have AR.</h2>
	<p class="lead">No build step, no API key, no account. The models and the text-to-3D lane are free and keyless.</p>
	<h3>Plain HTML</h3>
<pre><code>&lt;script type="module" src="https://unpkg.com/3d-ar-studio/dist/ar-studio.min.js"&gt;&lt;/script&gt;
&lt;ar-studio&gt;&lt;/ar-studio&gt;</code></pre>
	<h3>npm</h3>
<pre><code>npm i 3d-ar-studio three</code></pre>
<pre><code>import { createArStudio } from '3d-ar-studio'

const studio = createArStudio('#stage', {
  assets: 'https://your.cdn/models.json',   // your catalogue, or leave it out for the free CC0 library
  branding: { title: 'Acme AR', accent: '#00b894' },
})

studio.on('add', ({ placement }) =&gt; console.log('placed', placement.title))</code></pre>
	<h3>Scaffold a deployable page</h3>
<pre><code>npx 3d-ar-studio create my-ar-site      # a ready-to-publish folder
npx 3d-ar-studio deploy                 # push it and turn on GitHub Pages</code></pre>
</section>

<section class="wrap">
	<div class="eyebrow">What you get</div>
	<h2>Not a model viewer. A studio.</h2>
	<div class="grid">
		<div class="card"><span class="ico" aria-hidden="true">🏠</span>
			<h3>Many models, one room</h3>
			<p>Place, drag, pinch-resize, twist-rotate and duplicate as many models as you want in a single live camera view. Every other web-AR drop-in stops at one.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">✍️</span>
			<h3>Generate without leaving the camera</h3>
			<p>Type "a brass desk lamp" into the dock. The generation runs behind the live view and the finished model drops into the room. Free, keyless, no account.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">✦</span>
			<h3>Real WebXR, not a fallback</h3>
			<p>An always-armed hit-test reticle, one XRAnchor per model, real-world light estimation, and depth occlusion so models hide behind your furniture.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">📱</span>
			<h3>Real ARKit on iPhone, not an approximation</h3>
			<p>Tap <strong>Place in your space</strong> and Apple's own "View in AR" sheet opens: true plane detection, true scale, true occlusion. The model is converted to USDZ on the device, stood on the floor rather than left at the height it was modelled at, and prepared before the tap, because iOS opens Quick Look only while the gesture is still live. Android without WebXR gets Scene Viewer.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">🔗</span>
			<h3>Scenes are links</h3>
			<p>The whole arrangement (models, positions, rotations, scales) round-trips through the URL. Compose on a laptop, scan the QR, it reopens exactly on your phone.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">👥</span>
			<h3>Build together, live</h3>
			<p>Open a room, share a six-character code, and every add and move syncs to everyone in it in real time, with live presence.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">🕺</span>
			<h3>Characters actually move</h3>
			<p>Any humanoid GLB with no baked animation gets an idle clip retargeted onto its own skeleton: Mixamo, VRM, Avaturn, Unreal, Daz. No rig allow-list, no T-poses.</p></div>
		<div class="card"><span class="ico" aria-hidden="true">🤖</span>
			<h3>Agents can drive it</h3>
			<p>A bundled MCP server lets Claude, ChatGPT or any agent generate a model, compose an arrangement, and hand your user one link that opens it in their room.</p></div>
	</div>
</section>

<section class="wrap" id="assets">
	<div class="eyebrow">Your models</div>
	<h2>Bring your own catalogue.</h2>
	<p class="lead">
		Out of the box the tray is filled from three.ws: a few hundred public-domain (CC0) props,
		free for commercial use, served with open CORS. Swap in your own with one option
		a URL, an array, or a function.
	</p>
<pre><code>// 1. A JSON file anywhere. Five common shapes are read without reshaping.
createArStudio(el, { assets: 'https://cdn.acme.com/models.json' })

// 2. A list you hold in code.
import { staticSource } from '3d-ar-studio/sources'
createArStudio(el, { assets: staticSource({
  label: 'Our furniture',
  items: [{ src: 'https://cdn.acme.com/chair.glb', title: 'Aero chair', poster: '…' }],
}) })

// 3. Several tabs at once, in order.
createArStudio(el, { assets: ['recent', myCatalogue, 'objects', 'link'] })

// 4. Anything else: a source is just an object with a list().
createArStudio(el, { assets: {
  id: 'search', label: 'Search', searchable: true,
  async list() {
    const r = await fetch('/api/models').then((x) =&gt; x.json())
    return r.map((m) =&gt; ({ src: m.glb, title: m.name, poster: m.thumb }))
  },
} })</code></pre>
	<p>Your users can also point the studio somewhere else themselves, without touching your code:
	add <code>?assets=https://…/manifest.json</code> to the page URL. Only https URLs are accepted, and every
	model source is re-validated before it reaches the loader.</p>
</section>

<section class="wrap" id="options">
	<div class="eyebrow">Configuration</div>
	<h2>Options</h2>
	<table>
		<thead><tr><th>Option</th><th>Default</th><th>What it does</th></tr></thead>
		<tbody>
			<tr><td><code>assets</code></td><td><code>'three.ws'</code></td><td>Where models come from: a preset, a manifest URL, a source object, or an array of them.</td></tr>
			<tr><td><code>generate</code></td><td>enabled, free three.ws lane</td><td><code>{ enabled, endpoint, kind, tier }</code>. <code>endpoint</code> is any MCP server exposing a compatible generate tool.</td></tr>
			<tr><td><code>rooms</code></td><td>enabled</td><td><code>{ enabled, server }</code>. Point <code>server</code> at your own Colyseus deployment to host shared rooms yourself.</td></tr>
			<tr><td><code>animations</code></td><td>three.ws idle clip</td><td><code>{ enabled, manifestUrl, clip }</code>. The clip retargeted onto humanoid models that ship no animation.</td></tr>
			<tr><td><code>lighting</code></td><td><code>'studio'</code> HDRI</td><td><code>{ preset, urls }</code>. Set <code>preset: null</code> for procedural lighting only and zero HDRI download.</td></tr>
			<tr><td><code>branding</code></td><td> </td><td><code>{ title, accent, backHref, backLabel }</code>.</td></tr>
			<tr><td><code>shareBaseUrl</code></td><td>this page</td><td>Where share links and QR codes point.</td></tr>
			<tr><td><code>persistKey</code></td><td><code>'ar-studio:scene:v1'</code></td><td>localStorage key for the saved scene. Change it to run two studios on one origin.</td></tr>
			<tr><td><code>maxPlacements</code></td><td><code>20</code></td><td>Cap on simultaneous models. Keeps low-end phones interactive.</td></tr>
			<tr><td><code>allowUrlOverride</code></td><td><code>true</code></td><td>Honour <code>?assets=</code>, <code>?src=</code>, <code>?room=</code> and <code>?forge=</code> on the hosting page's URL.</td></tr>
			<tr><td><code>onEvent</code></td><td><code>null</code></td><td>Called with <code>(event, detail)</code> for every notable action: wire it to your analytics.</td></tr>
		</tbody>
	</table>
	<h3>Events</h3>
	<p>Subscribe with <code>studio.on(name, fn)</code>, or listen for <code>ar-studio:&lt;name&gt;</code> DOM events on the mounted element:
	<code>add</code>, <code>remove</code>, <code>select</code>, <code>clear</code>, <code>generate</code>,
	<code>generate-error</code>, <code>camera</code>, <code>xr</code>, <code>room</code>, <code>share</code>.</p>
</section>

<section class="wrap">
	<div class="eyebrow">Provenance</div>
	<h2>Extracted from a studio people already use.</h2>
	<p class="lead">
		This is not a demo written to look good in a README. The rendering ladder, the anchor
		lifecycle, the retargeting pipeline, the scene format and the shared-room protocol are
		lifted from the AR surfaces running in production on
		<a href="https://three.ws">three.ws</a>, and generalized so they work on your site
		with your models.
	</p>
</section>
`;
}

export function studioPage() {
	return `
<div style="position:fixed;inset:0"><ar-studio id="studio" style="position:absolute;inset:0;min-height:0"
	title="AR Studio" back-href="./index.html"></ar-studio></div>
`;
}

export function mcpPage() {
	return `
<section class="wrap" style="padding-top:48px">
	<span class="pill">Model Context Protocol</span>
	<h1>Let an agent build the scene.</h1>
	<p class="lead">
		The package ships an MCP server. Point Claude, ChatGPT, Cursor or your own agent at it and
		it can generate 3D models, compose an arrangement, and hand a person one link that opens
		that arrangement in their actual room.
	</p>
	<h2>Install</h2>
<pre><code>{
  "mcpServers": {
    "3d-ar-studio": {
      "command": "npx",
      "args": ["-y", "3d-ar-studio-mcp"]
    }
  }
}</code></pre>
	<p>No API key. Every tool below is free and keyless.</p>

	<h2>Tools</h2>
	<table>
		<thead><tr><th>Tool</th><th>What it does</th></tr></thead>
		<tbody>
			<tr><td><code>generate_3d_model</code></td><td>Turn a text prompt into a downloadable, textured GLB. Returns the model URL plus links that open it in AR.</td></tr>
			<tr><td><code>check_generation</code></td><td>Collect a generation that was still rendering when the first call returned.</td></tr>
			<tr><td><code>search_models</code></td><td>Search the free CC0 library (or any catalogue you configure) by name, category and tag.</td></tr>
			<tr><td><code>compose_ar_scene</code></td><td>Arrange several models into one scene and return a single link (and a QR-friendly short form) that reopens it exactly.</td></tr>
			<tr><td><code>export_ar</code></td><td>Turn any GLB URL into a device-aware "View in your space" link: Quick Look on iOS, Scene Viewer on Android, WebGL on desktop.</td></tr>
			<tr><td><code>create_ar_page</code></td><td>Emit a complete, self-contained HTML page that embeds the studio, configured for the caller's models: ready to commit and publish.</td></tr>
		</tbody>
	</table>

	<h2>What a session looks like</h2>
<pre><code>&gt; Put a mid-century lamp and a potted fern in my living room.

  generate_3d_model  { prompt: "a brass mid-century desk lamp" }   → lamp.glb
  search_models      { query: "potted plant" }                     → fern.glb
  compose_ar_scene   { models: [{ src: lamp.glb, x: 0,   z: -1.4 },
                                { src: fern.glb, x: 0.9, z: -1.2 }] }

  → https://your-page.example/ar/#s=… (open it on a phone; both objects
    stand in the room, exactly where they were arranged)</code></pre>

	<h2>Configuration</h2>
	<table>
		<thead><tr><th>Environment variable</th><th>Default</th><th>What it changes</th></tr></thead>
		<tbody>
			<tr><td><code>AR_STUDIO_PAGE_URL</code></td><td>the hosted demo</td><td>The page <code>compose_ar_scene</code> links to. Set it to your own deployment.</td></tr>
			<tr><td><code>AR_STUDIO_ASSETS</code></td><td>the free CC0 library</td><td>Catalogue URL <code>search_models</code> searches.</td></tr>
			<tr><td><code>AR_STUDIO_MCP_ENDPOINT</code></td><td>three.ws 3D Studio</td><td>The MCP endpoint used for generation.</td></tr>
			<tr><td><code>AR_STUDIO_ORIGIN</code></td><td><code>https://three.ws</code></td><td>Origin for the hosted "View in your space" launcher and viewer links.</td></tr>
		</tbody>
	</table>
	<p style="margin-top:24px"><a class="btn primary" href="./studio.html">See what it builds</a>
	<a class="btn" href="https://github.com/nirholas/3D-AR-Studio#mcp-server">Full MCP docs</a></p>
</section>
`;
}
