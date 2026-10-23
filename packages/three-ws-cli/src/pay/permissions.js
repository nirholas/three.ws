// The spending policy for `three-ws pay`, read from
// ~/.config/three-ws/pay-permissions.json. Nothing is payable without it: a
// missing file refuses every challenge. Limits are written as decimal strings in
// whole units of the asset (USDC "0.10"), never floats.

import fs from 'node:fs';
import path from 'node:path';
import { configDir } from '../paths.js';
import { EXIT, PayError, REASON } from './errors.js';

export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GPDDDXvbX7sWR9gkk';

/** Assets whose decimals are known without asking the chain. */
export const KNOWN_DECIMALS = Object.freeze({
	[USDC_MAINNET]: 6,
	[USDC_DEVNET]: 6,
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
});

const NETWORK_ALIASES = {
	solana: SOLANA_MAINNET,
	mainnet: SOLANA_MAINNET,
	'solana-mainnet': SOLANA_MAINNET,
	'mainnet-beta': SOLANA_MAINNET,
	'solana-devnet': SOLANA_DEVNET,
	devnet: SOLANA_DEVNET,
};

/** Canonical CAIP-2 id for a network name from a challenge, a flag or the permissions file. */
export function normalizeNetwork(value) {
	if (typeof value !== 'string') return null;
	const v = value.trim();
	if (NETWORK_ALIASES[v]) return NETWORK_ALIASES[v];
	return v || null;
}

export function isSolanaNetwork(network) {
	return typeof network === 'string' && network.startsWith('solana:');
}

export function permissionsPath(env) {
	return env.vars.THREE_WS_PAY_PERMISSIONS || path.join(configDir(env), 'pay-permissions.json');
}

export function ledgerPath(env) {
	return path.join(configDir(env), 'pay-ledger.json');
}

export const DEFAULT_PERMISSIONS = Object.freeze({
	version: 1,
	allowedOrigins: ['https://three.ws'],
	allowedNetworks: [SOLANA_MAINNET],
	allowedAssets: [USDC_MAINNET],
	maxPerCall: '0.10',
	maxPerDay: '1.00',
	confirmAbove: '0.05',
});

/** Whole-unit decimal string to atomic units. Rejects anything that is not a plain non-negative decimal. */
export function decimalToAtomic(text, decimals, field = 'amount') {
	const s = String(text).trim();
	const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
	if (!m) throw new Error(`${field} must be a plain decimal like "0.10", got "${text}"`);
	const frac = m[2] ?? '';
	if (frac.length > decimals) throw new Error(`${field} "${s}" has more than ${decimals} decimal places`);
	return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function atomicToDecimal(atomic, decimals) {
	const n = BigInt(atomic);
	const base = 10n ** BigInt(decimals);
	const whole = n / base;
	const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : `${whole}`;
}

const LIMIT_FIELDS = ['maxPerCall', 'maxPerDay', 'confirmAbove'];

/** Validate a parsed permissions object and return it normalized. Throws PayError(permissions_invalid). */
export function validatePermissions(raw) {
	const bad = (msg) => new PayError(EXIT.PERMISSION_DENIED, REASON.permissionsInvalid, `pay-permissions.json: ${msg}`);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('must be a JSON object');
	if (raw.version !== 1) throw bad('"version" must be 1');
	const list = (key, required) => {
		const v = raw[key];
		if (v === undefined && !required) return undefined;
		if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) throw bad(`"${key}" must be an array of non-empty strings`);
		return v.map((x) => x.trim());
	};
	const allowedOrigins = list('allowedOrigins', true).map((o) => {
		let u;
		try {
			u = new URL(o);
		} catch {
			throw bad(`"allowedOrigins" entry "${o}" is not a URL origin like https://three.ws`);
		}
		return u.origin;
	});
	const allowedNetworks = list('allowedNetworks', true).map(normalizeNetwork);
	const allowedAssets = list('allowedAssets', false) ?? [USDC_MAINNET, USDC_DEVNET];
	const allowedPayees = list('allowedPayees', false);
	for (const key of LIMIT_FIELDS) {
		if (raw[key] === undefined) continue;
		if (typeof raw[key] !== 'string') throw bad(`"${key}" must be a decimal string like "0.10"`);
		try {
			decimalToAtomic(raw[key], 18, key);
		} catch (err) {
			throw bad(err.message);
		}
	}
	if (raw.maxPerCall === undefined) throw bad('"maxPerCall" is required so a single call has a ceiling');
	return {
		version: 1,
		allowedOrigins,
		allowedNetworks,
		allowedAssets,
		allowedPayees,
		maxPerCall: raw.maxPerCall,
		maxPerDay: raw.maxPerDay,
		confirmAbove: raw.confirmAbove,
	};
}

export function loadPermissions(env) {
	const file = permissionsPath(env);
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') {
			throw new PayError(
				EXIT.PERMISSION_DENIED,
				REASON.permissionsMissing,
				`No permissions file at ${file}. Nothing is payable until you create one: run \`three-ws pay init\`.`,
			);
		}
		throw err;
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new PayError(EXIT.PERMISSION_DENIED, REASON.permissionsInvalid, `${file} is not valid JSON: ${err.message}`);
	}
	return validatePermissions(parsed);
}

/** Write the conservative default policy. Never overwrites an existing file. Returns the path, or null when one exists. */
export function initPermissions(env, overrides = {}) {
	const file = permissionsPath(env);
	if (fs.existsSync(file)) return null;
	const perms = validatePermissions({ ...DEFAULT_PERMISSIONS, ...overrides });
	const out = Object.fromEntries(Object.entries(perms).filter(([, v]) => v !== undefined));
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
	return file;
}

// --- daily ledger -------------------------------------------------------------

function today(now) {
	return new Date(now).toISOString().slice(0, 10);
}

function readLedger(env, now) {
	try {
		const data = JSON.parse(fs.readFileSync(ledgerPath(env), 'utf8'));
		if (data.day === today(now) && data.spent && typeof data.spent === 'object') return data;
	} catch {
		// absent or unreadable ledger starts a fresh day
	}
	return { day: today(now), spent: {} };
}

const ledgerKey = (offer) => `${offer.network}|${offer.asset}`;

/** Atomic units already spent today (UTC) on this network and asset. */
export function spentToday(env, offer, now = Date.now()) {
	return BigInt(readLedger(env, now).spent[ledgerKey(offer)] ?? '0');
}

/** Record a settled payment. Called only after the server accepted it. */
export function recordSpend(env, offer, now = Date.now()) {
	const ledger = readLedger(env, now);
	const key = ledgerKey(offer);
	ledger.spent[key] = (BigInt(ledger.spent[key] ?? '0') + offer.amountAtomic).toString();
	const file = ledgerPath(env);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

// --- evaluation ---------------------------------------------------------------

export function offerDecimals(offer) {
	if (Number.isInteger(offer.decimals)) return offer.decimals;
	return KNOWN_DECIMALS[offer.asset] ?? null;
}

/**
 * Check one offer against the policy. Returns `{ confirm: boolean }` when payable,
 * throws PayError(PERMISSION_DENIED, <reason>) otherwise. `origin` is the origin of
 * the URL being fetched, `maxFlag` the `--max` decimal string (or undefined).
 */
export function evaluateOffer(perms, offer, { origin, maxFlag, spent = 0n }) {
	const refuse = (reason, message, detail) => new PayError(EXIT.PERMISSION_DENIED, reason, message, { offer: describeOffer(offer), ...detail });
	if (!perms.allowedOrigins.includes(origin)) {
		return fail(refuse(REASON.originNotAllowed, `${origin} is not in allowedOrigins. Add it to pay-permissions.json to pay there.`));
	}
	if (!perms.allowedNetworks.includes(offer.network)) {
		return fail(refuse(REASON.networkNotAllowed, `network ${offer.network} is not in allowedNetworks.`));
	}
	if (!perms.allowedAssets.includes(offer.asset)) {
		return fail(refuse(REASON.assetNotAllowed, `asset ${offer.asset} is not in allowedAssets.`));
	}
	if (perms.allowedPayees && !perms.allowedPayees.includes(offer.payTo)) {
		return fail(refuse(REASON.payeeNotAllowed, `payee ${offer.payTo} is not in allowedPayees.`));
	}
	const decimals = offerDecimals(offer);
	if (decimals === null) {
		return fail(refuse(REASON.assetNotAllowed, `decimals for asset ${offer.asset} are unknown, so no limit can be applied.`));
	}
	const amount = offer.amountAtomic;
	const perCall = decimalToAtomic(perms.maxPerCall, decimals, 'maxPerCall');
	if (amount > perCall) {
		return fail(refuse(REASON.perCallLimit, `${atomicToDecimal(amount, decimals)} exceeds maxPerCall ${perms.maxPerCall}.`));
	}
	if (maxFlag !== undefined) {
		const cap = decimalToAtomic(maxFlag, decimals, '--max');
		if (amount > cap) {
			return fail(refuse(REASON.maxFlag, `${atomicToDecimal(amount, decimals)} exceeds --max ${maxFlag}.`));
		}
	}
	if (perms.maxPerDay !== undefined) {
		const perDay = decimalToAtomic(perms.maxPerDay, decimals, 'maxPerDay');
		if (spent + amount > perDay) {
			return fail(
				refuse(
					REASON.dailyLimit,
					`${atomicToDecimal(amount, decimals)} on top of ${atomicToDecimal(spent, decimals)} already spent today exceeds maxPerDay ${perms.maxPerDay}.`,
				),
			);
		}
	}
	const confirm = perms.confirmAbove !== undefined && amount > decimalToAtomic(perms.confirmAbove, decimals, 'confirmAbove');
	return { confirm };
}

function fail(err) {
	throw err;
}

export function describeOffer(offer) {
	const decimals = offerDecimals(offer);
	return {
		protocol: offer.protocol,
		network: offer.network,
		asset: offer.asset,
		payTo: offer.payTo,
		amountAtomic: offer.amountAtomic.toString(),
		amount: decimals === null ? null : atomicToDecimal(offer.amountAtomic, decimals),
		decimals,
	};
}
