// Safety scan for an external SKILL.md before an owner may install it.
//
// The scan is deterministic first (validation, licence, static threat rules,
// capability detection against the MCP tool policy) and then, when a Granite
// Guardian lane is configured, a model pass over the body. It never executes
// anything: scripts and handlers beside a SKILL.md are listed, not run, and an
// installed external skill is prompt-only.
//
// Verdicts:
//   refused  at least one `block` finding. Cannot be installed, by anyone.
//   flagged  `warn` findings only. Installable after the owner reads them.
//   clean    nothing beyond `info`.
// `gated` is separate from the verdict: a skill that asks for spending,
// signing or outbound messaging installs only with an explicit acknowledgement
// and runs under the spend gate (skill-import-gate.js).

import { POLICY } from '@three-ws/mcp-policy';
import { assess, decide, guardianConfig, AGENT_INPUT_RISKS } from './granite-guardian.js';
import { PLAN_LIMITS } from './sandbox/limits.js';
import { CUSTOM_SKILL_MAX_CHARS, CUSTOM_SKILL_TOKEN_CAP, estimateTokens } from './agent-custom-skills.js';
import { LIMITS as REGISTRY_LIMITS } from '../../community-skills/tools/registry.mjs';
import { licensePolicy } from './skill-import-sources.js';

export const SCANNER_VERSION = '1.0.0';

export const SCAN_LIMITS = Object.freeze({
	body_max_chars: CUSTOM_SKILL_MAX_CHARS,
	token_cap: CUSTOM_SKILL_TOKEN_CAP,
	file_max_bytes: REGISTRY_LIMITS.fileMaxBytes,
	description_max_chars: 1024,
	name_max_chars: 64,
	sandbox_file_bytes: PLAN_LIMITS.free.fileBytes,
	sandbox_output_bytes: PLAN_LIMITS.free.outputBytes,
});

const SPEND_GROUPS = new Set(['wallet', 'trading', 'orders', 'perps', 'lending', 'predictions', 'launch', 'billing', 'marketplace', 'cards', 'domains']);

const POLICY_BY_TOOL = (() => {
	const m = new Map();
	for (const tools of Object.values(POLICY)) for (const [name, row] of Object.entries(tools)) if (!m.has(name)) m.set(name, row);
	return m;
})();

/** Map a requested tool name to what it could do on three.ws. */
export function classifyTool(name) {
	const bare = String(name).replace(/\(.*\)$/, '').trim();
	const row = POLICY_BY_TOOL.get(bare);
	const lower = bare.toLowerCase();
	const caps = new Set();
	if (row?.tier === 'financial' && SPEND_GROUPS.has(row.group)) caps.add('spend');
	if (/sign(ed)?_?(transaction|message|tx)|sign_and_send|send_signed/.test(lower)) caps.add('sign');
	if (row?.group === 'mail' || /(^|_)(post|tweet|send_message|send_email|email|telegram|discord|slack|knock|webhook|notify|dm)(_|$)/.test(lower)) caps.add('message');
	if (!row && /^(bash|shell|exec|terminal|run_command)$/i.test(bare)) caps.add('shell');
	return { name: bare, known: !!row, group: row?.group || null, tier: row?.tier || null, capabilities: [...caps] };
}

// ── Static rules ────────────────────────────────────────────────────────────

const SECRET = '\\b(private keys?|secret keys?|seed phrases?|mnemonics?|recovery phrases?|keypairs?|api[ _-]?keys?|access tokens?|session cookies?|passwords?|\\.env)\\b';
const SENSITIVE_PLACEHOLDER = /(conversation|chat|history|transcript|messages?|prompt|system|context|secret|private|seed|mnemonic|password|passphrase|cookie|session|api[_ -]?key|access[_ -]?token|auth|credential|env|memor(?:y|ies)|user[_ -]?(?:input|data|message))/i;

const NEGATED = /\b(never|do not|don't|dont|must not|mustn't|refuse|without ever|no one should|not)\b/i;

const RULES = [
	{
		id: 'instruction_override',
		severity: 'block',
		re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|system|safety|owner'?s?|other)\b[^.\n]{0,25}\b(instructions?|rules?|prompts?|guidelines|polic(?:y|ies)|guardrails?)/i,
		message: 'tells the agent to ignore its other instructions or safety rules',
	},
	{
		id: 'concealment',
		severity: 'block',
		re: /\b(do not|don't|never)\s+(tell|inform|alert|notify)\s+(the\s+)?(user|owner|human|operator)s?\b(?!\s+to\b)|\bwithout\s+(asking|telling|notifying|informing)\s+(the\s+)?(user|owner)|\bsilently\s+(send|transfer|forward|post|sign|share)|\bkeep\s+(this|it|these)\b[^.\n]{0,20}\b(secret|hidden)\s+from\b/i,
		message: 'tells the agent to hide what it does from its owner',
	},
	{
		id: 'withholding',
		severity: 'warn',
		re: /\b(do not|don't|never)\s+(mention|reveal|disclose|show)\b[^.\n]{0,40}\bto\s+(the\s+)?(user|owner|human|operator)s?\b/i,
		message: 'tells the agent to withhold something from the person it serves',
	},
	{
		id: 'secret_harvest',
		severity: 'block',
		re: new RegExp(
			[
				`${SECRET}[^.\\n]{0,60}\\b(to|into)\\b[^.\\n]{0,40}(https?:\\/\\/|webhook|endpoint|server|channel|address|this url|the url|\\bme\\b|@)`,
				`\\b(reveal|print|output|dump|exfiltrat\\w*|leak|display|echo|share|post)\\b[^.\\n]{0,40}${SECRET}`,
				`\\b(include|put|paste|embed|append)\\b[^.\\n]{0,30}${SECRET}[^.\\n]{0,40}\\b(reply|response|answer|message|url|link|post|query)`,
				`\\b(read|cat|open|load|collect|upload)\\b[^.\\n]{0,30}(\\.env\\b|id_rsa|keypair\\.json|wallet\\.json|\\.ssh\\b|solana\\/id\\.json)`,
			].join('|'),
			'i',
		),
		negatable: true,
		message: 'asks the agent to read or hand over secrets (keys, seed phrases, tokens)',
	},
	{
		id: 'gate_bypass',
		severity: 'block',
		re: /\b(bypass|skip|disable|circumvent|evade|turn off)\b[^.\n]{0,30}\b(confirm\w*|approvals?|spend gate|guardian|safety checks?|limits?|caps?|2fa|verification)\b/i,
		negatable: true,
		message: 'tells the agent to bypass confirmations, approvals or limits',
	},
	{
		id: 'fixed_destination',
		severity: 'block',
		re: /\b(send|transfer|pay|forward|deposit|withdraw|sweep|move|route|bridge)\b[^\n]{0,80}\bto\b[^\n]{0,24}\b([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})\b/,
		negatable: true,
		message: 'directs funds to an address written into the skill',
	},
	{
		id: 'exfil_url',
		severity: 'block',
		re: /https?:\/\/[^\s)"'>]+[?&][\w-]+=(?:\{\{|\{|\$\{|<)[^\s)"'>]*/i,
		test: (m) => SENSITIVE_PLACEHOLDER.test(m[0].split(/[?&]/).slice(1).join('&')),
		message: 'contains a URL template that would carry conversation data to a third party',
	},
	{
		id: 'remote_script',
		severity: 'warn',
		re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\beval\s*\(|base64\s+(-d|--decode)[^\n]*\|/i,
		message: 'pipes a downloaded script into a shell or evaluates code',
	},
];

// Text that speaks to the agent: a role prefix, a mode switch, or moving
// value or data somewhere. Plain inside visible prose; hostile in a comment.
const COMMENT_DIRECTIVE = /\b(system|assistant|developer)\s*:|\byou are now\b|\b(send|transfer|sweep|drain|forward|move|upload)\b[^.\n]{0,40}\b(balance|wallet|funds|keys?|history|conversation|secrets?)\b/i;

const BIDI_OR_TAG = /[‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/u;
const ZERO_WIDTH = /[​‌⁠-⁤﻿]/;
const BASE64_BLOB = /[A-Za-z0-9+/]{300,}={0,2}/;

const SPEND_RE = /\b(send|transfer|pay|tip|withdraw|swap|buy|sell|bridge|stake|deposit|mint|launch|ape)\b[^.\n]{0,50}\b(sol|usd[a-z]?|stablecoins?|tokens?|funds|lamports|coins?|\$\d)|\bx402\b|\bsendSol\b|\bwallet_send\b|\bsend_transfer\b/i;
const SIGN_RE = /\bsign(s|ing)?\s+(a |the |every |each )?(transactions?|messages?|tx|payloads?|typed data)\b|\bsign(Transaction|Message|AndSend)\b/i;
const MESSAGE_RE = /\b(post|tweet|publish|dm|message|email|announce|broadcast|reply)\b[^.\n]{0,40}\b(on |to |in )?(x|twitter|telegram|discord|slack|farcaster|email|channel|followers|group chat|webhook)\b/i;

function excerpt(line, idx = 0) {
	const s = line.trim();
	return s.length > 160 ? `${s.slice(Math.max(0, idx - 40), Math.max(0, idx - 40) + 160)}...` : s;
}

/** Static findings over a SKILL.md body. Pure, exported for tests. */
export function staticFindings(text) {
	const findings = [];
	const lines = String(text).split('\n');
	lines.forEach((line, i) => {
		for (const rule of RULES) {
			const m = line.match(rule.re);
			if (!m || (rule.test && !rule.test(m))) continue;
			if (rule.negatable && NEGATED.test(line.slice(0, m.index + m[0].length)) && !/\b(and|then)\s+(send|post|share|reveal)/i.test(line)) continue;
			findings.push({ rule: rule.id, severity: rule.severity, message: rule.message, line: i + 1, excerpt: excerpt(line, m.index) });
		}
		if (BIDI_OR_TAG.test(line)) findings.push({ rule: 'hidden_unicode', severity: 'block', message: 'contains invisible bidirectional or tag characters that can hide instructions', line: i + 1, excerpt: excerpt(line.replace(/[^\x20-\x7E]/g, '?')) });
		else if (ZERO_WIDTH.test(line)) findings.push({ rule: 'zero_width', severity: 'warn', message: 'contains zero-width characters', line: i + 1, excerpt: excerpt(line.replace(/[^\x20-\x7E]/g, '?')) });
		if (BASE64_BLOB.test(line)) findings.push({ rule: 'encoded_blob', severity: 'warn', message: 'contains a long encoded blob the owner cannot read', line: i + 1, excerpt: excerpt(line) });
	});
	for (const m of String(text).matchAll(/<!--([\s\S]*?)-->/g)) {
		const inner = m[1];
		const hostile = RULES.some((r) => r.severity === 'block' && r.re.test(inner)) || SPEND_RE.test(inner) || MESSAGE_RE.test(inner) || COMMENT_DIRECTIVE.test(inner);
		const line = String(text).slice(0, m.index).split('\n').length;
		findings.push(
			hostile
				? { rule: 'hidden_directive', severity: 'block', message: 'hides instructions inside an HTML comment', line, excerpt: excerpt(inner) }
				: { rule: 'html_comment', severity: 'info', message: 'contains an HTML comment (not shown to the agent differently, listed for review)', line, excerpt: excerpt(inner) },
		);
	}
	return findings;
}

/** What the skill asks to do: from its requested tools and from its text. */
export function detectCapabilities(text, requestedTools = [], requestedPermissions = []) {
	const tools = requestedTools.map(classifyTool);
	const caps = { spend: [], sign: [], message: [] };
	for (const t of tools) for (const c of t.capabilities) if (caps[c]) caps[c].push(`requests tool ${t.name}`);
	for (const p of requestedPermissions) {
		const lp = p.toLowerCase();
		if (/spend|pay|transfer|wallet|trade|swap/.test(lp)) caps.spend.push(`requests permission ${p}`);
		if (/sign/.test(lp)) caps.sign.push(`requests permission ${p}`);
		if (/post|message|email|social|notify|send_message/.test(lp)) caps.message.push(`requests permission ${p}`);
	}
	String(text)
		.split('\n')
		.forEach((line, i) => {
			if (SPEND_RE.test(line) && caps.spend.length < 6) caps.spend.push(`line ${i + 1}: ${excerpt(line)}`);
			if (SIGN_RE.test(line) && caps.sign.length < 6) caps.sign.push(`line ${i + 1}: ${excerpt(line)}`);
			if (MESSAGE_RE.test(line) && caps.message.length < 6) caps.message.push(`line ${i + 1}: ${excerpt(line)}`);
		});
	return {
		tools,
		capabilities: {
			spend: { requested: caps.spend.length > 0, evidence: caps.spend },
			sign: { requested: caps.sign.length > 0, evidence: caps.sign },
			message: { requested: caps.message.length > 0, evidence: caps.message },
		},
	};
}

function validationFindings(entry, body) {
	const out = [];
	const block = (rule, message) => out.push({ rule, severity: 'block', message });
	const warn = (rule, message) => out.push({ rule, severity: 'warn', message });
	if (!entry.parse_ok) block('invalid_frontmatter', 'SKILL.md has no valid YAML frontmatter between --- lines');
	if (!entry.name) block('missing_name', 'frontmatter has no name');
	if (!entry.description) block('missing_description', 'frontmatter has no description, so the agent could not tell when it applies');
	if (!body.trim()) block('empty_body', 'SKILL.md has no instructions after the frontmatter');
	if (body.length > SCAN_LIMITS.body_max_chars) block('too_long', `instructions are ${body.length} characters; the limit is ${SCAN_LIMITS.body_max_chars}`);
	const tokens = estimateTokens(body);
	if (tokens > SCAN_LIMITS.token_cap) block('over_budget', `instructions are about ${tokens} tokens, more than an agent's whole ${SCAN_LIMITS.token_cap}-token skill budget`);
	if ((entry.name || '').length > SCAN_LIMITS.name_max_chars) warn('long_name', `name is longer than ${SCAN_LIMITS.name_max_chars} characters and will be shortened`);
	if ((entry.description || '').length > SCAN_LIMITS.description_max_chars) warn('long_description', 'description is longer than the Agent Skills limit and will be shortened');
	const pol = licensePolicy(entry.license || { class: 'unknown' });
	if (!pol.listed) block('license', `licence does not permit reuse: ${pol.reason}`);
	else if (pol.notice) out.push({ rule: 'license_copyleft', severity: 'info', message: pol.notice });
	const runnable = (entry.files || []).filter((f) => /^(scripts|handlers?|bin|src)\//.test(f.path) || /\.(m?js|ts|py|sh|rb|go|rs)$/.test(f.path));
	if (runnable.length) {
		out.push({ rule: 'files_not_installed', severity: 'info', message: `${runnable.length} script or handler file(s) ship beside SKILL.md; they are listed here and never run. Only the instructions are installed.` });
		const huge = runnable.filter((f) => f.size > SCAN_LIMITS.sandbox_file_bytes);
		if (huge.length) warn('oversized_files', `${huge.length} file(s) exceed the ${SCAN_LIMITS.sandbox_file_bytes / (1024 * 1024)} MB skill sandbox file limit`);
	}
	return { findings: out, tokens };
}

async function guardianPass(body, { signal } = {}) {
	const cfg = guardianConfig();
	if (!cfg.configured) return { status: 'unavailable', note: 'Granite Guardian is not configured on this deployment; the static rules still ran' };
	try {
		const verdicts = await assess(cfg, { input: body.slice(0, 8000), risks: AGENT_INPUT_RISKS, signal });
		const d = decide(verdicts);
		return { status: 'ok', model: cfg.model, decision: d.decision, reasons: d.reasons, flagged: d.flagged };
	} catch (err) {
		return { status: 'error', note: `Guardian assessment failed: ${err.message}` };
	}
}

/**
 * Scan one fetched skill. `entry` is an index entry from skill-import-sources,
 * `content` its pinned SKILL.md text. Returns the full report.
 */
export async function scanSkill(entry, content, { guardian = true } = {}) {
	const body = String(content).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
	const { findings: validation, tokens } = validationFindings(entry, body);
	const statics = staticFindings(content);
	const detected = detectCapabilities(content, entry.requested_tools || [], entry.requested_permissions || []);
	for (const t of detected.tools) {
		if (t.capabilities.includes('shell')) statics.push({ rule: 'requests_shell', severity: 'info', message: `requests ${t.name}; installed skills are prompt-only and are never given shell access` });
	}
	const g = guardian ? await guardianPass(body) : { status: 'skipped' };
	if (g.status === 'ok' && g.decision === 'block') statics.push({ rule: 'guardian', severity: 'block', message: `Granite Guardian flagged the instructions: ${g.reasons.map((r) => r.label).join(', ')}` });
	else if (g.status === 'ok' && g.decision === 'review') statics.push({ rule: 'guardian', severity: 'warn', message: `Granite Guardian raised a low-confidence flag: ${g.flagged.join(', ')}` });

	const findings = [...validation, ...statics];
	const verdict = findings.some((f) => f.severity === 'block') ? 'refused' : findings.some((f) => f.severity === 'warn') ? 'flagged' : 'clean';
	const caps = detected.capabilities;
	return {
		scanner_version: SCANNER_VERSION,
		scanned_at: new Date().toISOString(),
		verdict,
		gated: caps.spend.requested || caps.sign.requested || caps.message.requested,
		capabilities: caps,
		requested_tools: detected.tools,
		findings,
		tokens,
		chars: body.length,
		license: entry.license,
		limits: SCAN_LIMITS,
		guardian: g,
	};
}
