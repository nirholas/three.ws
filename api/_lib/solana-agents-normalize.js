// Pure normalization helpers for the Solana agent crawlers. Kept free of any
// I/O (no db, no RPC) so the field-parsing logic is unit-testable in isolation
// and can be imported without dragging in the serverless DB driver.

import { IPFS_GATEWAYS } from '../../src/ipfs.js';

export const MAX_NAME = 200;
export const MAX_DESC = 1000;

export function truncate(s, max) {
	if (s == null) return null;
	const str = String(s).trim();
	if (!str) return null;
	return str.length > max ? str.slice(0, max) : str;
}

// Resolve ipfs:// and bare-CID metadata pointers to an HTTPS gateway so a fetch
// can actually retrieve them. Leaves https/http URLs untouched.
export function resolveGateway(uri) {
	if (!uri) return null;
	const s = String(uri).trim();
	if (!s) return null;
	if (s.startsWith('ipfs://')) return `${IPFS_GATEWAYS[0]}${s.slice(7).replace(/^ipfs\//, '')}`;
	if (s.startsWith('ar://')) return `https://arweave.net/${s.slice(5)}`;
	if (/^[a-zA-Z0-9]{46,59}$/.test(s) && !s.includes('.')) return `${IPFS_GATEWAYS[0]}${s}`;
	return s;
}

// Pure normalization of a DAS getAsset result into the index fields. Extracted
// so the field-picking logic (image source priority, GLB detection, owner) is
// unit-testable without a live RPC.
export function normalizeDasAsset(a) {
	if (!a) return null;
	const meta = a.content?.metadata || {};
	const files = a.content?.files || [];
	const links = a.content?.links || {};
	const image = links.image || files.find((f) => /image/i.test(f?.mime || ''))?.uri || null;
	// A glTF/GLB file attached to the asset means it carries a 3D model.
	const glb = files.find((f) => /model\/gltf|\.glb($|\?)|\.gltf($|\?)/i.test(`${f?.mime || ''} ${f?.uri || ''}`))?.uri || null;
	return {
		name: truncate(meta.name, MAX_NAME),
		description: truncate(meta.description, MAX_DESC),
		image: image || null,
		glb_url: glb || null,
		metadata_uri: a.content?.json_uri || null,
		owner: a.ownership?.owner || null,
	};
}

const AGENC_STATUS = { 0: 'pending', 1: 'active', 2: 'inactive', 3: 'suspended' };

// Map an AgenC on-chain status (numeric code, or Anchor enum object like
// {active:{}}) to a human label. Exported for unit coverage of the enum decoding.
export function agencStatusLabel(raw) {
	const code = typeof raw === 'object' && raw ? Object.keys(raw)[0] : raw;
	return AGENC_STATUS[Number(code)] || (typeof code === 'string' ? code : null);
}

// AgenC statuses that mean the agent should be hidden from the directory.
export function agencActive(statusLabel) {
	return statusLabel !== 'suspended' && statusLabel !== 'inactive';
}
