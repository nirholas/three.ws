// Payload-hash confirmation for locally filed approvals. Byte-for-byte the same
// canonical JSON + sha256 the cloud uses (api/_lib/approvals.js), so a hash
// shown on the desktop equals the hash the web flow would show for the same
// payload. tests/desktop-runtime.test.js proves the parity against the cloud
// module's own vectors.

import { createHash } from 'node:crypto';

export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
	if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
	const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function payloadHash(payload) {
	return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

const shortAddr = (a) => {
	const s = String(a || '');
	return s.length > 12 ? `${s.slice(0, 4)}...${s.slice(-4)}` : s;
};

function fmtAmount(amount, asset) {
	const n = Number(amount);
	if (!Number.isFinite(n)) return '';
	const digits = n >= 1 ? 4 : 6;
	return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })}${asset ? ` ${asset}` : ''}`;
}

export function chainLabel(chain, network) {
	const c = String(chain || 'solana');
	const name = c.charAt(0).toUpperCase() + c.slice(1);
	return network && network !== 'mainnet' ? `${name} ${network}` : name;
}

/** The CLAUDE.md spend-gate table: recipient, amount, asset, chain. */
export function confirmationTable(row) {
	return [
		{ key: 'recipient', label: 'Recipient', value: row.recipient_label ? `${row.recipient_label} (${shortAddr(row.recipient)})` : row.recipient || 'n/a', full: row.recipient || null },
		{ key: 'amount', label: 'Amount', value: fmtAmount(row.amount, row.asset) },
		{ key: 'asset', label: 'Asset', value: row.asset || 'n/a' },
		{ key: 'chain', label: 'Chain', value: chainLabel(row.chain, row.network) },
	];
}

export const confirmationText = (row) => confirmationTable(row).map((r) => `${r.label}: ${r.value}`).join('\n');
