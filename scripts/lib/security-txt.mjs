// RFC 9116 (security.txt) validation for /.well-known/security.txt.
//
// Pure: takes the file body, returns the problems. Used by
// scripts/audit-security-headers.mjs and tested in tests/security-txt.test.js.

/** Parse "Field: value" lines, skipping comments and blanks. */
export function parseSecurityTxt(body) {
	const fields = [];
	for (const raw of String(body).split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const i = line.indexOf(':');
		if (i <= 0) {
			fields.push({ name: null, value: line });
			continue;
		}
		fields.push({ name: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() });
	}
	return fields;
}

/**
 * Every way a security.txt body breaks RFC 9116.
 * @param {string} body
 * @param {{now: Date, origin?: string|null}} opts origin, when given, must
 *   match every Canonical URL (RFC 9116 section 2.5.2).
 * @returns {string[]}
 */
export function validateSecurityTxt(body, { now, origin = null }) {
	const problems = [];
	const fields = parseSecurityTxt(body);
	for (const f of fields) if (!f.name) problems.push(`line "${f.value}" is not a "Field: value" pair`);

	const contacts = fields.filter((f) => f.name === 'contact');
	if (!contacts.length) problems.push('Contact is required');
	for (const c of contacts) {
		if (!/^(mailto:|tel:|https:\/\/)/i.test(c.value)) problems.push(`Contact "${c.value}" must be a mailto:, tel: or https:// URI`);
	}

	const expires = fields.filter((f) => f.name === 'expires');
	if (expires.length !== 1) problems.push(`Expires must appear exactly once (found ${expires.length})`);
	else {
		const value = expires[0].value;
		const when = new Date(value);
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(when.getTime()))
			problems.push(`Expires "${value}" is not an RFC 3339 date-time`);
		else if (when <= now) problems.push(`Expires ${value} is in the past`);
		else if (when.getTime() - now.getTime() > 366 * 24 * 3600 * 1000)
			problems.push(`Expires ${value} is more than a year away (RFC 9116 recommends under a year)`);
	}

	for (const single of ['preferred-languages']) {
		if (fields.filter((f) => f.name === single).length > 1) problems.push(`${single} must not repeat`);
	}
	for (const f of fields) {
		if (!f.name) continue;
		if (['canonical', 'policy', 'encryption', 'acknowledgments', 'hiring', 'csaf'].includes(f.name) && !/^https:\/\//i.test(f.value))
			problems.push(`${f.name} "${f.value}" must be an https:// URL`);
		if (f.name === 'canonical' && origin && !f.value.startsWith(`${origin}/.well-known/security.txt`))
			problems.push(`Canonical "${f.value}" does not match ${origin}/.well-known/security.txt`);
	}
	return problems;
}
