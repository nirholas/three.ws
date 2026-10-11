// Pure helpers for the desktop assistant: the grounding prompt, the
// [[open:app]] actions a reply may carry, history trimming for /api/chat, and
// a small safe Markdown renderer. No DOM, no network: unit tested.

export const THREE_CA = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
export const HISTORY_MAX = 20;
const PROMPT_MAX = 2000;
const TURN_MAX = 4000;

/**
 * The system prompt for the platform assistant. `apps` is [{ id, title, desc }];
 * the list is trimmed to keep the whole prompt under the API's 2000 characters.
 */
export function systemPrompt(apps = [], { now = new Date(), agent = null } = {}) {
	const date = now.toISOString().slice(0, 10);
	if (agent) {
		return (
			`You are ${agent.name}, a three.ws agent, talking with a visitor inside the three.ws desktop. Stay in character, be concise and friendly. ` +
			`Today is ${date}. Never invent prices, balances or facts you do not have. Never ask for seed phrases or private keys.`
		).slice(0, PROMPT_MAX);
	}
	const head =
		`You are the three.ws assistant, built into the three.ws desktop in the visitor's browser. three.ws is a platform for 3D AI agents with avatars, wallets and their own coins on Solana. ` +
		`Answer concisely in plain language with short paragraphs or lists. Today is ${date}. ` +
		`$THREE is the platform's coin (contract ${THREE_CA}); it is the only coin you recommend. Never give financial advice, invent prices or balances, or ask for seed phrases or private keys. ` +
		`When an app would help, end your reply with one or two tags like [[open:appId]] using only these ids:\n`;
	const tail = '\nDo not use any other app id.';
	let list = '';
	for (const a of apps) {
		const line = `${a.id}: ${a.title}${a.desc ? ` (${a.desc})` : ''}\n`;
		if (head.length + list.length + line.length + tail.length > PROMPT_MAX) break;
		list += line;
	}
	return `${head}${list.trimEnd()}${tail}`;
}

/**
 * Pull [[open:appId]] tags out of a reply. Only ids in `known` survive, each
 * once; the tags are removed from the text either way.
 */
export function parseActions(text, known) {
	const ok = known instanceof Set ? known : new Set(known || []);
	const actions = [];
	const clean = String(text || '')
		.replace(/\[\[\s*open\s*:\s*([\w:/.-]+)\s*\]\]/gi, (_, id) => {
			if (ok.has(id) && !actions.includes(id)) actions.push(id);
			return '';
		})
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { text: clean, actions };
}

/** A tag still being typed at the end of a streamed reply: hide it until it closes. */
export function hidePartialTag(text) {
	return String(text || '').replace(/\[\[[^\]]*\]?$/, '');
}

/** The history /api/chat accepts: the last 20 user/assistant turns, text only, capped. */
export function trimHistory(messages) {
	return (Array.isArray(messages) ? messages : [])
		.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
		.map((m) => ({ role: m.role, content: m.content.slice(0, TURN_MAX) }))
		.slice(-HISTORY_MAX);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(s) {
	// Code spans first so their contents are not formatted.
	const codes = [];
	let out = esc(s).replace(/`([^`\n]+)`/g, (_, c) => {
		codes.push(c);
		return `\u0000${codes.length - 1}\u0000`;
	});
	out = out
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/(?!\/)[^\s)]*)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
		.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
		.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
	return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

/**
 * Render a reply as safe HTML: paragraphs, bullet and numbered lists,
 * headings, fenced code, bold, italics, inline code and links. Everything
 * else is escaped text.
 */
export function renderMarkdown(text) {
	const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
	const out = [];
	let list = null;
	let para = [];
	let fence = null;
	const flushPara = () => {
		if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
		para = [];
	};
	const flushList = () => {
		if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
		list = null;
	};
	for (const line of lines) {
		if (fence) {
			if (/^```/.test(line)) {
				out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
				fence = null;
			} else fence.push(line);
			continue;
		}
		if (/^```/.test(line)) {
			flushPara();
			flushList();
			fence = [];
			continue;
		}
		const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
		const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
		const head = line.match(/^\s{0,3}#{1,4}\s+(.*)$/);
		if (bullet || num) {
			flushPara();
			const tag = bullet ? 'ul' : 'ol';
			if (list && list.tag !== tag) flushList();
			list ||= { tag, items: [] };
			list.items.push((bullet || num)[1]);
		} else if (head) {
			flushPara();
			flushList();
			out.push(`<h4>${inline(head[1])}</h4>`);
		} else if (!line.trim()) {
			flushPara();
			flushList();
		} else {
			flushList();
			para.push(line.trim());
		}
	}
	if (fence) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
	flushPara();
	flushList();
	return out.join('');
}

/** Starter prompts shown on an empty conversation. */
export const SUGGESTIONS = [
	{ label: 'What can I build on three.ws?', prompt: 'What can I build on three.ws? Give me the three best places to start.' },
	{ label: 'Make my first agent', prompt: 'Walk me through creating my first 3D agent, step by step.' },
	{ label: 'What is $THREE?', prompt: 'What is $THREE and how does it fit into three.ws?' },
	{ label: 'Turn a prompt into a 3D model', prompt: 'How do I turn a text prompt into a textured 3D model here?' },
];
