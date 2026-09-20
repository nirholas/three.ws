// Editorial standards for @trythreews posts, beyond the voice lint in
// quality.js. quality.js catches what makes a feed look automated; this module
// catches what makes a company look careless or exposed:
//
//   brand         the product, the token, and partner names written correctly
//   compliance    nothing that reads as investment advice or a price promise
//   register      no crypto slang, marketing filler, or begging calls to action
//   typography    spacing, punctuation, one link per post
//   claims        every number, superlative, and @tag is declared with evidence
//   media         resolution, crop-safe aspect ratio, useful alt text, fresh frames
//
// Everything here is deterministic and offline, so it runs in the CLI and in the
// production cron alike. Checks that need the network (live evidence, links,
// accounts, spelling) are in verify.js; judgment calls are in editor.js.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mediaType } from './media.js';
import { urlsIn } from './quality.js';

// Prose checks strip links but keep bare domains, so a brand name written
// "Three.ws" is still caught; link counting uses X's own notion of a link.
const LINKS_WITH_PATHS = /https?:\/\/[^\s]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*/gi;
const withoutUrls = (text) => String(text || '').replace(LINKS_WITH_PATHS, ' ');

// Written wrong -> written right. Case-sensitive on purpose.
export const BRAND_RULES = [
	[/\b(?:Three\.ws|THREE\.WS|Three\.WS|ThreeWS|Threews|three\s+ws)\b/, 'three.ws'],
	[/\$(?:three|Three)\b/, '$THREE'],
	[/\bTwitter\b/, 'X'],
	[/\b(?:tweet|tweets|tweeted|retweet)\b/i, 'post / repost'],
	[/\bGithub\b/, 'GitHub'],
	[/\bJavascript\b/, 'JavaScript'],
	[/\bTypescript\b/, 'TypeScript'],
	[/\b(?:Open AI|OpenAi)\b/, 'OpenAI'],
	[/\b(?:Nvidia|NVidia)\b/, 'NVIDIA'],
	[/(?<![@/.\w])solana\b(?!\.)/, 'Solana'],
	[/\b(?:Gltf|GLTF)\b/, 'glTF'],
	[/(?<![./\w])glb\b/, 'GLB'],
	[/(?<![@/.\w-])ai\b/, 'AI'],
	[/(?<![@/.\w-])(?:api|Api)\b/, 'API'],
	[/(?<![@/.\w-])(?:mcp|Mcp)\b/, 'MCP'],
	[/\bwebgl\b|\bWebgl\b/, 'WebGL'],
	[/\bwebxr\b|\bWebxr\b/, 'WebXR'],
];

// Language that reads as a financial promotion. A token post can say what
// $THREE does; it can never say what it will be worth.
export const COMPLIANCE_TERMS = [
	/\bto the moon\b/i, /\bmoon(?:ing|shot)?\b/i, /\b\d+\s*x\s+(?:gains?|returns?|potential)\b/i, /\b1000?x\b/i,
	/\bguaranteed?\b/i, /\bpassive income\b/i, /\bget rich\b/i, /\bfinancial freedom\b/i,
	/\b(?:returns?|profits?|gains?|yield) (?:for|to) holders\b/i, /\binvest(?:ment|ing|ors?)? (?:in|opportunity)\b/i,
	/\bbuy (?:now|\$THREE|the dip)\b/i, /\bdon'?t miss\b/i, /\blast chance\b/i, /\bprice (?:target|prediction|will)\b/i,
	/\bnot financial advice\b/i, /\bNFA\b/, /\bbullish\b/i, /\bbearish\b/i, /\bpump it\b/i, /\bape (?:in|into)\b/i,
];

export const SLANG_TERMS = [
	/\bgm\b/i, /\bgn\b/i, /\bwagmi\b/i, /\bngmi\b/i, /\blfg\b/i, /\bser\b/i, /\bfrens?\b/i, /\bdegens?\b/i,
	/\bbased\b/i, /\bwe'?re so back\b/i, /\bcooking\b/i, /\bfam\b/i, /\bIYKYK\b/i, /\blowkey\b/i, /\bngl\b/i, /\btbh\b/i,
];

// "awesome" is filler when it is an adjective and a proper noun when it is not:
// an awesome list is a named format on GitHub, and Awesome 3D Agents is the
// name of a surface this account has to be able to announce. Banning the word
// outright would have made the one post about that page unwritable, so the
// adjective is what is banned.
const AWESOME_AS_FILLER = /\bawesome\b(?![\s-]+(?:lists?\b|3D Agents\b))/i;

export const FILLER_TERMS = [
	/\bvery\b/i, /\breally\b/i, /\bsimply\b/i, /\bliterally\b/i, /\bactually\b/i, /\bbasically\b/i, /\btruly\b/i,
	/\bincredibly\b/i, /\bsuper (?!app)\w+/i, /\bpowerful\b/i, /\bcutting[- ]edge\b/i, /\bstate[- ]of[- ]the[- ]art\b/i,
	/\brobust\b/i, /\binnovative\b/i, /\bworld[- ]class\b/i, /\bbest[- ]in[- ]class\b/i, /\bleverag(?:e|es|ing)\b/i,
	/\bempower(?:s|ing)?\b/i, /\bunleash(?:es|ing)?\b/i, /\belevat(?:e|es|ing)\b/i, /\bharness(?:es|ing)?\b/i,
	/\bjourney\b/i, /\bsynerg(?:y|ies)\b/i, /\bparadigm\b/i, /\bgroundbreaking\b/i, AWESOME_AS_FILLER, /\bamazing\b/i,
];

export const PUSHY_CTAS = [
	/\bclick (?:the|this) link\b/i, /\bcheck (?:it|this) out\b/i, /\blike and (?:re)?post\b/i, /\bRT\b/,
	/\bfollow us\b/i, /\bsmash\b/i, /\blink in bio\b/i, /\bdrop a\b/i, /\btag a friend\b/i,
];

// Words that assert something absolute. Each needs a declared claim.
export const ABSOLUTES = /\b(?:first|only|fastest|largest|biggest|best|leading|never|always|every|no one|nobody|zero|unlimited|instant(?:ly)?|world'?s|#1|number one)\b/gi;

function termHits(text, terms) {
	return terms.map((term) => text.match(term)?.[0]).filter(Boolean);
}

export function languageProblems(text) {
	const problems = [];
	const prose = withoutUrls(text);
	for (const [wrong, right] of BRAND_RULES) {
		const hit = prose.match(wrong)?.[0];
		if (hit) problems.push({ rule: 'brand', severity: 'blocking', message: `"${hit}" is written "${right}"` });
	}
	for (const hit of termHits(prose, COMPLIANCE_TERMS)) {
		problems.push({ rule: 'compliance', severity: 'blocking', message: `"${hit}" reads as a financial promotion; say what the product does, never what a token will be worth` });
	}
	for (const hit of termHits(prose, SLANG_TERMS)) problems.push({ rule: 'register', severity: 'blocking', message: `"${hit}" is community slang, not company voice` });
	for (const hit of termHits(prose, FILLER_TERMS)) problems.push({ rule: 'register', severity: 'major', message: `"${hit}" is filler; replace it with the fact it stands in for` });
	for (const hit of termHits(prose, PUSHY_CTAS)) problems.push({ rule: 'register', severity: 'blocking', message: `"${hit}" is an engagement ask, not a reason to click` });

	if (/ {2,}/.test(text)) problems.push({ rule: 'typography', severity: 'blocking', message: 'double space' });
	if (/\s[,.;:!?](?:\s|$)/.test(prose)) problems.push({ rule: 'typography', severity: 'blocking', message: 'space before punctuation' });
	if (/[a-z][.!?][A-Z][a-z]/.test(prose)) problems.push({ rule: 'typography', severity: 'blocking', message: 'missing space after a sentence' });
	if (/[‘’“”]/.test(text) && /['"]/.test(prose)) problems.push({ rule: 'typography', severity: 'major', message: 'mixes curly and straight quotes' });
	if (/(?:\.\.\.|…)\s*$/.test(text.trim())) problems.push({ rule: 'structure', severity: 'blocking', message: 'ends on an ellipsis, which withholds the point' });
	if (/\b(?:1\/\d*|\(1\/\d+\))\s*$/.test(text.trim())) problems.push({ rule: 'structure', severity: 'blocking', message: 'thread counter teaser; lead with the strongest true statement instead' });

	const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
	if (sentences[0]?.endsWith('?')) problems.push({ rule: 'structure', severity: 'blocking', message: 'rhetorical-question opener; state what it does' });
	const oneWord = sentences.map((s) => s.split(/\s+/).length === 1);
	if (oneWord.some((flag, index) => flag && oneWord[index + 1] && oneWord[index + 2])) {
		problems.push({ rule: 'structure', severity: 'blocking', message: 'one-word-sentence drumbeat reads as ad copy' });
	}
	const links = urlsIn(text);
	if (links.length > 1) problems.push({ rule: 'links', severity: 'blocking', message: `${links.length} links; one post links one surface` });
	const mentions = prose.match(/(?<![\w@])@\w{1,15}/g) || [];
	if (mentions.length > 2) problems.push({ rule: 'mentions', severity: 'major', message: `${mentions.length} mentions; more than two reads as tag-baiting` });
	return problems;
}

export function mentionsIn(text) {
	return [...new Set((withoutUrls(text).match(/(?<![\w@])@\w{1,15}/g) || []).map((m) => m.toLowerCase()))];
}

// Numbers (other than those inside URLs and $THREE) and absolute words, each
// with the post it came from.
export function assertionsIn(text) {
	const prose = withoutUrls(text).replace(/\$THREE\b/g, ' ');
	// "3D", "ERC-8004", and "GPT-5" are names, not measurements.
	const numbers = [...prose.matchAll(/(?<![\w-])\d[\d,.]*(?:st|nd|rd|th|%|x\b|\s?(?:ms|seconds?|minutes?|hours?|days?|k|m|b)\b)?(?![\w-])/gi)].map((m) => m[0].replace(/[.,]$/, ''));
	const absolutes = [...prose.matchAll(ABSOLUTES)].map((m) => m[0]);
	return { numbers, absolutes };
}

// The claims ledger. Every number and absolute in the copy must sit inside a
// claim's `says`, every claim must appear in the copy and carry evidence, and
// every @mention must record why the tag is true.
export function claimProblems(item) {
	const problems = [];
	const texts = [...(item.posts || []).map((post) => post.text), item.kind === 'article' ? item.article?.title : null].filter(Boolean);
	const corpus = texts.join('\n').toLowerCase();
	const claims = item.claims || [];

	for (const claim of claims) {
		if (!claim.says || !corpus.includes(String(claim.says).toLowerCase())) {
			problems.push({ rule: 'claims', severity: 'blocking', message: `claim "${claim.says}" does not appear in the copy; claims must quote the post` });
		}
		if (!claim.evidence?.length) problems.push({ rule: 'claims', severity: 'blocking', message: `claim "${claim.says}" has no evidence` });
	}
	const covered = (fragment) => claims.some((claim) => String(claim.says || '').toLowerCase().includes(fragment.toLowerCase()));
	for (const text of texts) {
		const { numbers, absolutes } = assertionsIn(text);
		for (const number of numbers) if (!covered(number)) problems.push({ rule: 'claims', severity: 'blocking', message: `"${number}" is an unverified number; declare it in claims with evidence` });
		for (const word of absolutes) if (!covered(word)) problems.push({ rule: 'claims', severity: 'blocking', message: `"${word}" is an absolute; declare the claim it makes, with evidence, or cut it` });
	}
	const reasons = Object.fromEntries(Object.entries(item.mentions || {}).map(([handle, why]) => [handle.toLowerCase(), why]));
	for (const handle of mentionsIn(texts.join('\n'))) {
		if (!String(reasons[handle] || '').trim()) problems.push({ rule: 'mentions', severity: 'blocking', message: `${handle} has no recorded reason; tag only an account the feature genuinely runs on` });
	}
	return problems;
}

// Media most likely to embarrass: soft upscales, crops that cut the subject,
// alt text that says nothing, and a frame older than the product it shows.
export async function mediaQualityProblems(post, root, { maxFrameAgeDays = 21, now = Date.now() } = {}) {
	const problems = [];
	const list = post.media || [];
	const manifestPath = resolve(root, 'public/announce/media-manifest.json');
	const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { shots: {} };
	const shots = Object.values(manifest.shots || {});
	const { default: sharp } = await import('sharp');

	for (const media of list) {
		const type = mediaType(media.path);
		if (!type || !existsSync(resolve(root, media.path))) continue;
		if (type.kind !== 'video') {
			const meta = await sharp(resolve(root, media.path), { animated: type.kind === 'gif' }).metadata();
			const width = meta.width;
			const height = meta.pageHeight || meta.height;
			if (width < 1200) problems.push({ rule: 'media', severity: 'blocking', message: `${media.path} is ${width}px wide; X renders it soft below 1200px` });
			const ratio = width / height;
			if (list.length === 1 && (ratio > 2 || ratio < 0.75)) {
				problems.push({ rule: 'media', severity: 'major', message: `${media.path} is ${ratio.toFixed(2)}:1; X crops a single image outside 3:4 to 2:1 in the timeline` });
			}
			if (list.length > 1 && (ratio > 1.8 || ratio < 0.8)) {
				problems.push({ rule: 'media', severity: 'major', message: `${media.path} is ${ratio.toFixed(2)}:1; multi-image grids crop toward square` });
			}
			const alt = String(media.alt || '').trim();
			if (alt && alt.length < 40) problems.push({ rule: 'media', severity: 'blocking', message: `${media.path} alt text is ${alt.length} characters; describe what the image shows` });
			if (/^(?:an? )?(?:image|picture|photo|screenshot) of\b/i.test(alt)) problems.push({ rule: 'media', severity: 'major', message: `${media.path} alt text opens with "${alt.split(' of')[0]} of"; screen readers already say it is an image` });
			if (alt && alt === String(post.text || '').trim()) problems.push({ rule: 'media', severity: 'blocking', message: `${media.path} alt text repeats the post; describe the image instead` });
		}
		const shot = shots.find((row) => media.path === `public${row.src}`);
		if (shot?.capturedAt) {
			const age = (now - Date.parse(shot.capturedAt)) / 86_400_000;
			if (age > maxFrameAgeDays) {
				problems.push({ rule: 'media', severity: 'blocking', message: `${media.path} was captured ${Math.floor(age)} days ago from ${shot.route}; recapture with \`npm run announce:media\` so the frame shows the product as it is today` });
			}
		}
	}
	return problems;
}
