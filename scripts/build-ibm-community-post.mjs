#!/usr/bin/env node
// Turns the IBM Community draft in docs/ into the two paste-ready files the
// author actually publishes from.
//
// The draft carries YAML frontmatter (venue, media manifest, framing rules) and
// editor notes that must never reach the published post. This strips both, then
// writes:
//   *-post.md        the clean article body, for anyone who wants the Markdown
//   *-post.html      the same body styled, to read in a browser
//   *-post-ibm.html         a body fragment for the IBM Community editor's HTML
//                           view: no document shell, no <h1> (the form has a Title
//                           field), and every image swapped for a labelled
//                           placeholder to upload by hand. Works today.
//   *-post-ibm-hosted.html  the same fragment with the images pointed at their
//                           public three.ws URLs and a live avatar panel embedded,
//                           so publishing is one paste and no uploads. Requires the
//                           images under public/blog/ibm-sperax/ to be deployed
//                           first, otherwise every figure is a broken image.
//
// Both come from one source, so the Markdown and the HTML can never drift.
//
// Key styling is inlined on block elements as well as declared in the
// stylesheet: the IBM Community editor drops <style> on paste, so code blocks,
// tables and pull quotes would otherwise arrive as unformatted paragraphs.
//
//   node scripts/build-ibm-community-post.mjs
import { marked } from 'marked';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'docs/ibm-community-defi-3d-sperax.md');
const OUT_MD = resolve(root, 'docs/ibm-community-defi-3d-sperax-post.md');
const OUT_HTML = resolve(root, 'docs/ibm-community-defi-3d-sperax-post.html');
const OUT_IBM = resolve(root, 'docs/ibm-community-defi-3d-sperax-post-ibm.html');
const OUT_IBM_HOSTED = resolve(root, 'docs/ibm-community-defi-3d-sperax-post-ibm-hosted.html');
// NOT under /blog/: the route table rewrites `/blog/<slug>` to `<slug>.html`, and
// the top-level blog/ tree is copied into dist/ separately, so a public/blog/
// subdirectory is two collisions waiting to happen. Its own prefix has neither.
const HOSTED_BASE = 'https://three.ws/ibm-sperax';

const raw = readFileSync(SRC, 'utf8');

// Frontmatter is editorial metadata for us, never post content.
const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
if (!fm) throw new Error(`${SRC} has no frontmatter to strip; refusing to guess where the post starts.`);
const title = (fm[1].match(/^title:\s*"?(.*?)"?\s*$/m) || [, 'IBM Community post'])[1];

let body = raw.slice(fm[0].length);

// Editor notes are wrapped in _[...]_ and marked as not for publication.
const notes = body.match(/^_\[Editor note[^\n]*\]_\n\n?/gm) || [];
body = body.replace(/^_\[Editor note[^\n]*\]_\n\n?/gm, '');
if (/not for publication|do not paste this note/i.test(body)) {
	throw new Error('An editor note survived the strip; fix the pattern before shipping this file.');
}

// The live-embed marker is an HTML comment: invisible to a Markdown reader, and
// carried through the render so the hosted fragment can swap a live panel in at
// exactly that point. It has to survive into the rendered HTML, so strip it from
// the Markdown output only, never from `body` before parsing.
const LIVE_MARKER = '<!-- LIVE-EMBED -->';
// \\s* rather than \\n\\n: the renderer emits the comment with its own trailing
// whitespace, so a newline-exact pattern leaves the marker sitting in the HTML.
const stripMarker = (text) => text.replace(new RegExp(`${LIVE_MARKER}\\s*`, 'g'), '\\n');

writeFileSync(OUT_MD, `${stripMarker(body).trimStart()}`, 'utf8');

marked.setOptions({ gfm: true, breaks: false });
const rendered = marked.parse(body);

// Inline the styles that matter for a paste into a rich-text editor.
const INLINE = [
	[/<pre>/g, '<pre style="background:#f4f4f4;border-left:4px solid #0f62fe;padding:16px 20px;overflow-x:auto;font-family:\'IBM Plex Mono\',ui-monospace,monospace;font-size:14px;line-height:1.6">'],
	[/<code>/g, '<code style="font-family:\'IBM Plex Mono\',ui-monospace,monospace;font-size:0.92em;background:#f4f4f4;padding:1px 5px">'],
	[/<pre style="([^"]*)"><code style="[^"]*">/g, '<pre style="$1"><code>'],
	[/<blockquote>/g, '<blockquote style="border-left:4px solid #0f62fe;background:#edf5ff;margin:28px 0;padding:18px 24px;font-size:1.05em">'],
	[/<table>/g, '<table style="border-collapse:collapse;width:100%;margin:24px 0">'],
	[/<th>/g, '<th style="border:1px solid #e0e0e0;padding:10px 14px;text-align:left;background:#f4f4f4">'],
	[/<td>/g, '<td style="border:1px solid #e0e0e0;padding:10px 14px;vertical-align:top">'],
	[/<img /g, '<img style="max-width:100%;height:auto;border:1px solid #e0e0e0;margin:8px 0" '],
	[/<hr>/g, '<hr style="border:none;border-top:1px solid #e0e0e0;margin:44px 0">'],
];
const post = INLINE.reduce((html, [find, replace]) => html.replace(find, replace), rendered);

writeFileSync(
	OUT_HTML,
	`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body{ max-width:820px; margin:0 auto; padding:56px 24px 96px; background:#fff; color:#161616;
    font-family:'IBM Plex Sans',system-ui,sans-serif; font-size:17px; line-height:1.65; }
  h1{ font-size:40px; line-height:1.2; letter-spacing:-.01em; margin:0 0 24px; }
  h2{ font-size:27px; margin:52px 0 16px; letter-spacing:-.01em; }
  h3{ font-size:21px; margin:34px 0 12px; }
  p,li{ font-size:17px; }
  ul,ol{ padding-left:26px; }
  li{ margin-bottom:8px; }
  a{ color:#0f62fe; }
  em{ color:#525252; }
  img+p em{ display:block; margin-top:6px; font-size:15px; }
</style></head>
<body>
${stripMarker(post)}</body></html>
`,
	'utf8',
);

// ---------------------------------------------------- IBM editor HTML fragments
// Placeholders are labelled by role rather than by position: the captions in the
// body already number the four diagrams 1 to 4, and a placeholder that numbered
// the header lockup as 1 would put every later figure out of step with them.
const FIGURES = [
	['HEADER IMAGE', 'ibm-sperax-featured.png'],
	['FIGURE 1', 'ibm-sperax-integration-paths.png'],
	['FIGURE 2', 'ibm-sperax-tool-call-halves.png'],
	['FIGURE 3', 'ibm-sperax-empathy-decay.png'],
	['FIGURE 4', 'ibm-sperax-code-exchange.png'],
];

// three.ws serves `frame-ancestors 'self' https://ibm.com https://*.ibm.com`, so
// community.ibm.com is already allowed to frame the real plugin panel. Whether it
// SURVIVES depends on the editor's own sanitizer, which is why the hosted fragment
// carries a still image inside the same block as a fallback.
const LIVE_EMBED = `<h3>The panel, running, right here</h3>
<p>Below is the actual plugin panel three.ws serves to SperaxOS, framed live rather than
screenshotted. Same URL the host frames, same avatar, same emotion blend. If your browser
or this page's sanitizer blocks the frame, you get the still image underneath instead.</p>
<div style="border:1px solid #e0e0e0;background:#f4f4f4;padding:12px">
<iframe src="https://three.ws/sperax/iframe" title="Live three.ws avatar panel, the same one SperaxOS frames"
  width="100%" height="480" loading="lazy" style="border:0;display:block;background:#fff"></iframe>
</div>
<p><em>The live three.ws avatar panel. This is the plugin's <code>ui.url</code>, not a recording.</em></p>`;

const buildFragment = (imageFor, liveEmbed) => {
	let i = 0;
	const frag = post
		// The form has its own Title field; a second copy in the body reads as a typo.
		.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/, '')
		// Same for the byline: the post already shows its author and its group.
		.replace(/<p><em>By Jessica Swanson\.[\s\S]*?<\/em><\/p>\s*/, '')
		// ONE pass, and it must stay one pass. Both forms are matched by a single
		// alternation because the hosted replacement itself contains an <img>: a
		// second sweep would match the tags this one just inserted and run off the
		// end of FIGURES. The wrapping <p> is part of the match so a replacement
		// that is itself a <p> does not end up nested inside one.
		.replace(/<p>\s*<img[^>]*>\s*<\/p>|<img[^>]*>/g, () => imageFor(FIGURES[i++]))
		.replace(LIVE_MARKER, liveEmbed);
	if (i !== FIGURES.length) {
		throw new Error(
			`Expected ${FIGURES.length} images in the post, found ${i}. ` +
				'Update FIGURES to match the draft before shipping this fragment.',
		);
	}
	if (/<p>\s*<p /.test(frag)) throw new Error('A placeholder nested inside a paragraph; fix the replace.');
	return frag;
};

const placeholder = ([label, file]) =>
	`<p style="border:2px dashed #0f62fe;background:#edf5ff;padding:14px 18px;text-align:center;` +
	`font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:14px;color:#0f62fe">` +
	`${label}: click here, use the toolbar image button to upload ` +
	`<strong>${file}</strong>, then delete this line.</p>`;

const hostedImage = ([label, file]) =>
	`<p><img src="${HOSTED_BASE}/${file}" alt="${label}"` +
	` style="max-width:100%;height:auto;border:1px solid #e0e0e0;margin:8px 0"></p>`;

writeFileSync(OUT_IBM, buildFragment(placeholder, ''), 'utf8');
writeFileSync(OUT_IBM_HOSTED, buildFragment(hostedImage, LIVE_EMBED), 'utf8');

console.log('wrote docs/ibm-community-defi-3d-sperax-post.md');
console.log('wrote docs/ibm-community-defi-3d-sperax-post.html');
console.log('wrote docs/ibm-community-defi-3d-sperax-post-ibm.html');
console.log('wrote docs/ibm-community-defi-3d-sperax-post-ibm-hosted.html');
console.log(`  title:        ${title}`);
console.log(`  editor notes stripped: ${notes.length}`);
console.log(`  words:        ${body.split(/\s+/).filter(Boolean).length}`);
