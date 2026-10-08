// @ts-check
// Turn one X mention into exactly one intent, deterministically, before any
// model sees it.
//
// PURE: no network, no database, no clock, no randomness. The only import is
// the /launch page's own pure form rules, so a launch link this parser
// prefills is held to the same name and ticker limits the page enforces.
// tests/x-mention-intents.test.js asserts the import graph stays that way.
//
// Mention text is untrusted (x-grok design rule 1). This module only ever
// reads it, cuts it down, and labels it; nothing it returns performs an
// action. The strongest thing an intent can lead to is one reply to the same
// author: a 3D generation shown back to them, a help text, a prefilled
// /launch link they review and sign themselves on three.ws, or a short
// tool-less chat reply. Text that asks for money to move or for secrets is
// answered with `help`, so it never reaches a model at all.
//
// Input: a normalized mention from x-mentions.js plus our account
//   ({ handle, userId, kind }; defaults to mention.account).
// Output: { intent, args, reason }
//   intent  make | image3d | avatar | help | launch | chat | ignore
//   args    intent-specific fields plus `normalization` (what was dropped),
//           `flags` (which hostile phrasing was refused) and `addressing`
//   reason  a short machine-readable why, recorded on x_mention_events

import { NAME_MAX, SYMBOL_MAX, DESCRIPTION_MAX, normalizeSymbol } from '../../src/launch/launch-model.js';

export const INTENTS = Object.freeze(['make', 'image3d', 'avatar', 'help', 'launch', 'chat', 'ignore']);

// Caps. A post can be 25,000 characters (note_tweet); nothing downstream
// needs more than these, and the scan itself is bounded first.
export const SCAN_MAX = 4000;
export const PROMPT_MAX = 400;
export const CHAT_MAX = 500;
export const PROMPT_MIN_LETTERS = 2;

// Tickers nobody may launch through the bot: the platform's own coin.
const RESERVED_TICKERS = new Set(['THREE']);

const HANDLE_RE = /@([A-Za-z0-9_]{1,15})\b/g;
const LEADING_HANDLES_RE = /^(?:@[A-Za-z0-9_]{1,15}[\s,:;.!-]*)+/;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+|\b(?:pic\.(?:x|twitter)\.com|t\.co)\/[^\s]+/gi;
// Invisible and direction-changing characters: zero-width, bidi overrides,
// isolates, the BOM, soft hyphen, and the C0/C1 controls except newline/tab.
const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// Phrasing that asks for funds to move or for secrets. Matched on the whole
// addressed text; a hit turns any intent into `help`.
const MONEY_VERBS = 'send|transfer|withdraw|pay|tip|airdrop|drain|bridge|swap|sweep|buy|sell|ape|stake|unstake';
// The objects are generic on purpose (funds, tokens, an amount with a unit, a
// cashtag), so the refusal never depends on knowing a particular coin.
const MONEY_OBJECTS = 'funds?|tokens?|coins?|wallets?|balance|lamports|money|crypto|nfts?|treasury|sol|usdc|\\d+(?:[.,]\\d+)?\\s*[a-z]{2,6}';
const ACTION_RE = new RegExp(`\\b(?:${MONEY_VERBS})\\b[^.!?\\n]{0,48}?(?:\\b(?:${MONEY_OBJECTS})\\b|\\$[a-z][a-z0-9]{1,9}\\b)`, 'i');
const SIGN_RE = /\b(?:sign|approve|confirm|authori[sz]e)\b[^.!?\n]{0,32}\b(?:transactions?|txn?s?|transfers?|withdrawals?|payments?|swaps?)\b/i;
const SECRET_RE = /\b(?:private\s*key|secret\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|api[\s_-]*key|password|passphrase|keypair)\b/i;
// Instruction-override phrasing ("ignore previous instructions", "you are now
// ..."). Refused like the two above: a request that opens by trying to
// rewrite the bot's rules gets the help text, not a model.
const OVERRIDE_RE = /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,32}\b(?:instructions?|prompts?|rules?|system|guidelines?|polic(?:y|ies)|previous|above|prior)\b|\b(?:system\s*prompt|jailbreak|developer\s*mode|you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you))\b/i;

const POLITE_RE = /^(?:(?:please|pls|plz|pretty\s+please|hey|hi|hello|yo|gm|ok|okay|so|now|can\s+you|could\s+you|would\s+you|will\s+you|could\s+u|can\s+u|i\s+want\s+you\s+to|i'?d\s+like\s+you\s+to|i\s+want|i\s+need|go\s+ahead\s+and)[\s,:!.-]+)+/i;
const HELP_RE = /^(?:help|commands?|menu|usage|how\s+(?:does\s+(?:this|it)\s+work|do\s+i\s+use\s+(?:this|you|it))|what\s+(?:can|do)\s+you\s+do|what\s+are\s+you|info|\?+)(?:[\s?!.]|$)/i;
const AVATAR_RE = /^(?:(?:make|create|generate|build|give|turn)\s+(?:me\s+(?:into\s+)?(?:an?\s+)?|my\s+)(?:3d\s+|rigged\s+)?(?:avatar|character)\b|avatar\s+me\b|me\s+as\s+an?\s+(?:3d\s+)?avatar\b)/i;
// "3d my pfp", "turn my profile picture into 3d": the author's own picture.
const AVATAR_PFP_RE = /\b(?:3d|3-d|make|turn|convert)\b.{0,24}\bmy\s+(?:pfp|profile\s+(?:pic(?:ture)?|photo|image))\b|\bmy\s+(?:pfp|profile\s+(?:pic(?:ture)?|photo|image))\b.{0,24}\b(?:3d|3-d|avatar)\b/i;
// A 3D request that points at an image rather than describing an object.
const IMAGE3D_RE = /\b(?:3d|3-d|three[\s-]?d)\s+(?:this|it|that|these|pls|please|me\s+this)\b|\b(?:make|turn|render)\s+(?:this|it|that)\s+(?:3d|3-d|three[\s-]?d)\b|\b(?:this|it|that)\s+(?:in|into|to|as)\s+(?:a\s+)?(?:3d|3-d|three[\s-]?d)\b|\b(?:make|turn|convert|render)\s+(?:this|it|that)(?:\s+(?:in|into|to)\s+(?:a\s+)?(?:3d|3-d|three[\s-]?d))?(?:\s+(?:pls|please))?\s*[.!]*$|\b(?:make|turn|convert)\s+(?:this|it|that|my\s+\S+|the\s+\S+)\s+(?:in|into|to)\s+(?:a\s+)?(?:3d|3-d|three[\s-]?d)/i;
const HAS_3D_RE = /\b(?:3d|3-d|three[\s-]?d)\b/i;
// make, 3d, forge, generate, model, followed by a description. A few verbs
// from the languages our audience posts in most, so a Spanish or Portuguese
// request is a request and not chat.
const MAKE_RE = /^(?:make|3d|forge|generate|gen|model|create|build|render|sculpt|haz|hazme|crea|cr[eé]ame|genera|fais|fait|cr[eé]e|g[eé]n[eè]re|fa[cç]a|faz|cria|gere|mach|erstelle|generiere|baue?)\b[\s:,-]*(?<rest>.*)$/is;
const MAKE_LEAD_RE = /^(?:(?:me|us|for\s+me)\s+)?(?:(?:(?:a|an|the)\s+)?(?:(?:3d|3-d|three[\s-]?d)\s+)?(?:model|mesh|version|object|asset|render)\s+of\s+)?/i;
const LAUNCH_RE = /^launch\b(?<rest>.*)$/is;
const LAUNCH_GRAMMAR_RE = /^\s*(?<name>[^$\n]{1,64}?)\s+\$(?<ticker>[A-Za-z0-9]{1,16})\b(?<desc>[\s\S]*)$/;

/**
 * Normalize untrusted text: Unicode NFKC (folds full-width @ and letters),
 * invisible and bidi characters removed, whitespace collapsed. Records what
 * changed. PURE.
 */
export function normalizeText(raw) {
	let text = String(raw ?? '');
	const record = { scanTruncated: false, nfkcChanged: false, invisibleRemoved: 0 };
	if (text.length > SCAN_MAX) {
		text = text.slice(0, SCAN_MAX);
		record.scanTruncated = true;
	}
	const folded = text.normalize('NFKC');
	if (folded !== text) record.nfkcChanged = true;
	text = folded;
	text = text.replace(INVISIBLE_RE, () => {
		record.invisibleRemoved += 1;
		return '';
	});
	text = text.replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
	return { text, record };
}

/** Split a post into its leading reply handles and the body after them. PURE. */
export function splitLeadingHandles(text) {
	const m = LEADING_HANDLES_RE.exec(text);
	if (!m) return { prefix: [], body: text };
	const prefix = [...m[0].matchAll(HANDLE_RE)].map((h) => h[1]);
	return { prefix, body: text.slice(m[0].length).trim() };
}

function handlesIn(text) {
	return [...String(text || '').matchAll(HANDLE_RE)].map((h) => h[1]);
}

const eqHandle = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Remove URLs and @handles from free text that will be shown back or sent to
 * a generator, cap it, and record every drop. PURE.
 */
export function sanitizeArg(text, max, record) {
	let out = String(text || '');
	out = out.replace(URL_RE, (u) => {
		record.droppedUrls.push(u);
		return ' ';
	});
	out = out.replace(HANDLE_RE, (h) => {
		record.droppedHandles.push(h.slice(1));
		return ' ';
	});
	out = out.replace(/\s+/g, ' ').trim();
	if ([...out].length > max) {
		const chars = [...out];
		record.truncated.push({ from: chars.length, to: max });
		out = chars.slice(0, max).join('').trim();
	}
	return out;
}

function letters(text) {
	return (String(text).match(/\p{L}|\p{N}/gu) || []).length;
}

function firstPhoto(media) {
	return (Array.isArray(media) ? media : []).find((m) => m && m.type === 'photo' && m.url) || null;
}

function imageSource(mention) {
	const own = firstPhoto(mention.media);
	if (own) return { source: 'mention', post: mention, media: own, authorId: mention.userId || mention.author?.id || null };
	for (const [source, ref] of [['replied_to', mention.repliedTo], ['quoted', mention.quoted]]) {
		if (!ref?.available) continue;
		const m = firstPhoto(ref.media);
		if (m) return { source, post: ref, media: m, authorId: ref.author?.id || null };
	}
	return null;
}

/**
 * How the post reaches us. `direct` when our handle is typed in the body, when
 * it leads a fresh post, when the post replies to us, or when it leads a reply
 * to someone whose post never named us (a deliberate tag, the way people call
 * @grok under someone else's post). `inherited` when it only rides along in
 * the reply handles of a thread we were already tagged in. `absent` when it
 * only appears inside a quoted or replied-to post. PURE.
 */
export function addressing(mention, account, prefix, body) {
	const handle = account.handle;
	const inBody = handlesIn(body).some((h) => eqHandle(h, handle));
	const inPrefix = prefix.some((h) => eqHandle(h, handle));
	if (inBody) return 'direct';
	if (!inPrefix) return 'absent';
	const parent = mention.repliedTo || null;
	const isReply = !!(parent || mention.inReplyToUserId);
	if (!isReply) return 'direct';
	const repliesToUs = (account.userId && (String(mention.inReplyToUserId || '') === String(account.userId) || String(parent?.author?.id || '') === String(account.userId)))
		|| eqHandle(parent?.author?.username, handle);
	if (repliesToUs) return 'direct';
	if (!parent?.available) return 'inherited';
	const parentNamesUs = handlesIn(normalizeText(parent.text).text).some((h) => eqHandle(h, handle));
	return parentNamesUs ? 'inherited' : 'direct';
}

function newRecord(base) {
	return { ...base, droppedHandles: [], droppedUrls: [], truncated: [] };
}

function hostileFlags(text) {
	const flags = [];
	if (ACTION_RE.test(text) || SIGN_RE.test(text)) flags.push('money_action');
	if (SECRET_RE.test(text)) flags.push('secret_request');
	if (OVERRIDE_RE.test(text)) flags.push('instruction_override');
	return flags;
}

const out = (intent, args, reason) => ({ intent, args, reason });

/**
 * The launch grammar (order 925): `launch <NAME> $<TICKER> [description]`.
 * The bot never launches; this only fills a /launch link the author reviews
 * and signs on three.ws. PURE.
 * @returns {{ ok: true, name: string, symbol: string, description: string } | { ok: false, reason: string }}
 */
export function parseLaunch(rest, record) {
	const m = LAUNCH_GRAMMAR_RE.exec(String(rest || ''));
	if (!m?.groups) return { ok: false, reason: 'launch_malformed' };
	const name = sanitizeArg(m.groups.name.replace(/^[\s:,-]+/, ''), NAME_MAX + 1, record);
	if (!name || letters(name) < 1) return { ok: false, reason: 'launch_missing_name' };
	if ([...name].length > NAME_MAX) return { ok: false, reason: 'launch_name_too_long' };
	const raw = m.groups.ticker;
	const symbol = normalizeSymbol(raw);
	if (raw.length > SYMBOL_MAX || symbol.length < 2) return { ok: false, reason: 'launch_bad_ticker' };
	if (RESERVED_TICKERS.has(symbol)) return { ok: false, reason: 'launch_reserved_ticker' };
	const description = sanitizeArg(m.groups.desc.replace(/^[\s:,-]+/, ''), DESCRIPTION_MAX, record);
	return { ok: true, name, symbol, description };
}

/**
 * Parse one normalized mention into one intent.
 *
 * @param {any} mention  a mention from x-mentions.js normalizeMentions
 * @param {{ handle?: string, userId?: string|null, kind?: 'company'|'agent' }} [accountIn]
 * @returns {{ intent: string, args: Record<string, any>, reason: string }}
 */
export function parseMentionIntent(mention, accountIn = {}) {
	const account = {
		handle: String(accountIn.handle || mention?.account?.handle || mention?.account?.ref || '').replace(/^@/, ''),
		userId: accountIn.userId ?? mention?.account?.userId ?? null,
		kind: accountIn.kind || mention?.account?.kind || 'company',
	};
	if (!mention || typeof mention !== 'object' || !account.handle) return out('ignore', {}, 'malformed');

	// Our own posts and retweets are never requests.
	const authorId = mention.userId || mention.author?.id || null;
	if (mention.fromSelf || (account.userId && authorId && String(authorId) === String(account.userId)) || eqHandle(mention.username || mention.author?.username, account.handle)) {
		return out('ignore', {}, 'own_post');
	}
	if (mention.isRetweet || /^RT @/.test(String(mention.text || ''))) return out('ignore', {}, 'retweet');

	const { text, record: base } = normalizeText(mention.text);
	const record = newRecord(base);
	const { prefix, body } = splitLeadingHandles(text);
	record.droppedHandles.push(...prefix);
	const how = addressing(mention, account, prefix, body);
	if (how === 'absent') return out('ignore', { normalization: record }, 'not_addressed');

	// Our own handle typed inside the body is the address, not content.
	const ownHandleRe = new RegExp(`@${account.handle.replace(/[^A-Za-z0-9_]/g, '')}\\b[\\s,:;.!-]*`, 'gi');
	const addressed = body.replace(ownHandleRe, () => {
		record.droppedHandles.push(account.handle);
		return ' ';
	}).replace(/\s+/g, ' ').trim();
	const command = addressed.replace(POLITE_RE, '').trim();
	const flags = hostileFlags(addressed);
	const withMeta = (args) => ({ ...args, normalization: record, flags, addressing: how });

	// Money movement, secrets, or an attempt to rewrite the bot's rules: the
	// help text when addressed to us, silence when it only rides along in a
	// thread. Never parsed further, never handed to a model.
	if (flags.length) {
		if (how !== 'direct') return out('ignore', withMeta({}), 'inherited_thread_mention');
		return out('help', withMeta({ topic: 'refused' }), `refused_${flags[0]}`);
	}

	// A bare tag, or a tag plus only links (X appends a t.co link for every
	// attached photo), carries no words to parse.
	if (!command.replace(URL_RE, ' ').trim()) {
		const img = imageSource(mention);
		if (how === 'direct' && img?.source === 'mention') return out('image3d', withMeta(image3dArgs(img, '', record)), 'image_only');
		return how === 'direct' ? out('help', withMeta({ topic: 'empty' }), 'empty_mention') : out('ignore', withMeta({}), 'inherited_thread_mention');
	}

	if (HELP_RE.test(command)) return out('help', withMeta({ topic: 'general' }), 'command:help');

	const launch = LAUNCH_RE.exec(command);
	if (launch?.groups) {
		const parsed = parseLaunch(launch.groups.rest, record);
		if (!parsed.ok) return out('help', withMeta({ topic: 'launch' }), parsed.reason);
		return out('launch', withMeta({ name: parsed.name, symbol: parsed.symbol, description: parsed.description }), 'command:launch');
	}

	if (AVATAR_RE.test(command) || AVATAR_PFP_RE.test(command)) {
		return out('avatar', withMeta({ authorId, authorUsername: mention.username || mention.author?.username || null }), 'command:avatar');
	}

	const img = imageSource(mention);
	const points3d = IMAGE3D_RE.test(command);
	if (img && (points3d || (img.source === 'mention' && (HAS_3D_RE.test(command) || MAKE_RE.test(command))))) {
		return out('image3d', withMeta(image3dArgs(img, command, record)), 'command:image3d');
	}
	if (points3d) return out('help', withMeta({ topic: 'image3d' }), 'image3d_without_image');

	const make = MAKE_RE.exec(command);
	if (make?.groups) {
		const described = make.groups.rest.replace(MAKE_LEAD_RE, '');
		const prompt = sanitizeArg(described, PROMPT_MAX, record);
		if (letters(prompt) >= PROMPT_MIN_LETTERS) return out('make', withMeta({ prompt }), 'command:make');
		return out('help', withMeta({ topic: 'make' }), 'make_without_description');
	}

	if (how !== 'direct') return out('ignore', withMeta({}), 'inherited_thread_mention');
	const chat = sanitizeArg(command, CHAT_MAX, record);
	if (letters(chat) < 1) return out('help', withMeta({ topic: 'empty' }), 'empty_mention');
	return out('chat', withMeta({ text: chat }), account.kind === 'agent' ? 'agent_chat' : 'company_chat');
}

function image3dArgs(img, command, record) {
	return {
		source: img.source,
		sourcePostId: img.post?.id ? String(img.post.id) : null,
		sourceAuthorId: img.authorId ? String(img.authorId) : null,
		mediaKey: img.media.key || null,
		mediaUrl: img.media.url,
		width: img.media.width ?? null,
		height: img.media.height ?? null,
		hint: sanitizeArg(command.replace(IMAGE3D_RE, ' '), PROMPT_MAX, record),
	};
}
