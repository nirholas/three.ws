// Outbound content rules for agent mail, enforced on the server before any
// charge or send. An agent writes to real people; every message must read like
// correspondence from someone accountable: a real subject, a greeting, a body
// with substance, a sign-off, and no manufactured urgency.
//
// checkOutboundContent() is pure and returns every violation at once, each with
// a stable code, so a model can fix its draft in one pass. The same rules are
// stated to models in the tool descriptions and in docs/agent-mail.md.

const GREETING_RE =
	/^(hi|hello|hey|dear|greetings|good (morning|afternoon|evening|day)|thanks|thank you|welcome|hope you|to whom it may concern)\b/i;
// A salutation line such as "Maria," or "Team at Acme," also counts.
const NAME_SALUTATION_RE = /^[\p{L}][\p{L}\p{M}'. -]{0,58},$/u;

const SIGNOFF_RE =
	/^(best|best regards|best wishes|regards|kind regards|warm regards|warmly|thanks|thank you|many thanks|cheers|sincerely|yours|yours truly|all the best|talk soon|with thanks|respectfully|take care)\b[,.!]?/i;
// A dash signature ("- Ava", or the same with an em dash) also counts.
const DASH_SIGNATURE_RE = /^(-{1,2}|\u2014|\u2013)\s*\p{L}/u;

// Pressure tactics that turn a message into a phishing template. Matched on the
// subject and the body; any hit rejects the draft.
const URGENCY_PATTERNS = [
	{ re: /\bact (now|immediately|fast)\b/i, label: 'act now' },
	{ re: /\b(urgent|urgently)\b/i, label: 'urgent' },
	{ re: /\bimmediate(ly)? action\b/i, label: 'immediate action' },
	{ re: /\bfinal (notice|warning|reminder)\b/i, label: 'final notice' },
	{ re: /\blast chance\b/i, label: 'last chance' },
	{ re: /\b(expires?|ending|ends) (today|tonight|in \d+ (minutes?|hours?))\b/i, label: 'expires today' },
	{ re: /\bwithin (the next )?\d+ (minutes?|hours?)\b/i, label: 'within N hours' },
	{ re: /\blimited[- ]time (offer|only)\b/i, label: 'limited time offer' },
	{ re: /\baccount (has been |will be )?(suspended|locked|closed|terminated|deactivated|compromised)\b/i, label: 'account suspended' },
	{ re: /\bverify your (account|identity|wallet|password)\b/i, label: 'verify your account' },
	{ re: /\b(don'?t|do not) (miss out|delay)\b/i, label: 'do not miss out' },
	{ re: /\bor (else|you will lose)\b/i, label: 'or else' },
];

const MIN_SUBJECT_CHARS = 3;
const MAX_SUBJECT_CHARS = 200;
const MIN_BODY_WORDS = 12;
const MIN_BODY_CHARS = 60;

function lines(text) {
	return String(text || '')
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
}

function words(s) {
	return String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
}

function isShouting(subject) {
	const letters = subject.match(/\p{L}/gu) || [];
	if (letters.length < 8) return false;
	const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
	return upper / letters.length > 0.8;
}

/** Strip tags from HTML to judge its words. Not a sanitizer; never rendered. */
export function textFromHtml(html) {
	return String(html || '')
		.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&quot;/gi, '"')
		.replace(/[ \t]+/g, ' ');
}

/**
 * Judge a draft. `isReply` is true when the send threads onto a received
 * message (in_reply_to set); only then may the subject start with "Re:".
 *
 * @param {{ subject?: string, text?: string, html?: string, isReply?: boolean }} draft
 * @returns {{ ok: boolean, violations: Array<{ code: string, message: string }> }}
 */
export function checkOutboundContent({ subject, text, html, isReply = false } = {}) {
	const violations = [];
	const add = (code, message) => violations.push({ code, message });

	const subj = String(subject || '').trim();
	if (subj.length < MIN_SUBJECT_CHARS) {
		add('subject_missing', 'Write a real subject line that says what the email is about.');
	} else if (subj.length > MAX_SUBJECT_CHARS) {
		add('subject_too_long', `Keep the subject under ${MAX_SUBJECT_CHARS} characters.`);
	} else {
		if (words(subj).length < 2 && !isReply) {
			add('subject_one_word', 'A one-word subject reads as spam. Say what the email is about in a few words.');
		}
		if (isShouting(subj)) add('subject_all_caps', 'Do not write the subject in capital letters.');
		if (/^(re|fwd?|fw)\s*:/i.test(subj) && !isReply) {
			add('subject_fake_reply', 'Only a reply to a received message may start with "Re:" or "Fwd:".');
		}
		if (/!{2,}|\?{3,}|\$\$+/.test(subj)) add('subject_punctuation', 'Drop the repeated punctuation from the subject.');
	}

	const bodyText = String(text || '').trim() || textFromHtml(html).trim();
	const bodyLines = lines(bodyText);
	if (!bodyLines.length) {
		add('body_missing', 'The email has no body. Write the message.');
	} else {
		const first = bodyLines[0];
		if (!(GREETING_RE.test(first) || NAME_SALUTATION_RE.test(first))) {
			add('greeting_missing', 'Open with a greeting, such as "Hi Maria," on the first line.');
		}
		const tail = bodyLines.slice(-3);
		if (!tail.some((l) => SIGNOFF_RE.test(l) || DASH_SIGNATURE_RE.test(l))) {
			add('signoff_missing', 'Close with a sign-off, such as "Best," followed by the agent\'s name.');
		}
		// Substance is judged on the lines between the greeting and the sign-off.
		const core = bodyLines.slice(1, Math.max(1, bodyLines.length - 1)).join(' ');
		if (words(core).length < MIN_BODY_WORDS || core.length < MIN_BODY_CHARS) {
			add('body_too_short', `Write a body of substance: at least ${MIN_BODY_WORDS} words between the greeting and the sign-off.`);
		}
	}

	const haystack = `${subj}\n${bodyText}`;
	const hits = URGENCY_PATTERNS.filter((p) => p.re.test(haystack)).map((p) => p.label);
	if (hits.length) {
		add('deceptive_urgency', `Remove pressure language (${[...new Set(hits)].join(', ')}). State facts and real dates instead.`);
	}

	return { ok: violations.length === 0, violations };
}
