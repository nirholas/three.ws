// On-chain (BNB) presence mode — prompt 16.
//
// Opt-in layer over player-mode.js: when ON, the local avatar's moves are
// gaslessly written to WorldMoves.sol (contracts/src/WorldMoves.sol) every
// ~1 block via src/bnb/move-sender.js (prompt 15), and other players' real
// on-chain moves are read back (src/bnb/world-presence-reader.js) and
// rendered as lightweight ghost markers, interpolated by
// src/bnb/onchain-ghosts.js. A fully-on-chain presence layer riding BSC's
// live ~0.45s blocks (00-CONTEXT verified fact #3).
//
// OFF by default — zero BNB code runs, no wallet prompt, no network call,
// until the visitor explicitly opts in. The toggle never blocks or alters
// local movement: on-chain writes are best-effort commentary on a walk that
// keeps working with or without them (00-CONTEXT: "never freeze the game").

import * as THREE from 'three';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createMoveSender } from '../bnb/move-sender.js';
import { sendJoin, sendLeave } from '../../api/_lib/bnb/world-moves.js';
import { fetchWorldConfig } from '../bnb/world-config-client.js';
import { watchWorldPresence } from '../bnb/world-presence-reader.js';
import { createGhostTracker } from '../bnb/onchain-ghosts.js';
import { buildLabelSprite } from './citizen-avatar.js';
import { log } from '../shared/log.js';
import { shortAddress } from '../shared/address.js';

const STORAGE_KEY = 'three.ws:bnb-presence-key';
const COORD_SCALE = 1000; // mirrors src/bnb/move-sender.js's meters→millimeters convention
const FIRST_HERE_HINT_MS = 4000; // grace period before showing "you're the first one here"
const GHOST_HEIGHT = 1.6; // marker sits roughly head-height, matching player-mode's avatars

function fromContractPos({ x, y, z }) {
	return { x: x / COORD_SCALE, y: y / COORD_SCALE, z: z / COORD_SCALE };
}
function fromContractFacing(centidegrees) {
	return ((centidegrees / 100) * Math.PI) / 180;
}
function shortAddr(addr) { return shortAddress(addr, 6, 4); }
// Deterministic per-address hue so the same on-chain identity always renders
// the same ghost color across sessions/tabs — a cheap, real "who's that"
// visual cue with zero extra state.
function colorForAddress(addr) {
	let h = 0;
	for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
	return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55);
}

function loadOrCreateKey() {
	try {
		const existing = localStorage.getItem(STORAGE_KEY);
		if (existing) return existing;
	} catch {
		/* private mode */
	}
	const key = generatePrivateKey();
	try {
		localStorage.setItem(STORAGE_KEY, key);
	} catch {
		/* private mode — the key survives for this tab only */
	}
	return key;
}

function hasStoredKey() {
	try {
		return !!localStorage.getItem(STORAGE_KEY);
	} catch {
		return false;
	}
}

/** See the "Dev/demo override" comment in `turnOn()` for why this exists. */
function devOverrideFromUrl() {
	try {
		const params = new URLSearchParams(location.search);
		const address = params.get('bnbDevAddress');
		const rpc = params.get('bnbDevRpc');
		if (address && rpc && /^0x[0-9a-fA-F]{40}$/.test(address)) return { address, rpc };
	} catch {
		/* no location/URLSearchParams (non-browser test import) */
	}
	return null;
}

/**
 * Mount the on-chain presence toggle + ghost layer.
 *
 * @param {object} ctx
 * @param {THREE.Scene} ctx.scene
 * @param {HTMLElement} ctx.hudRoot HUD container to append the toggle control into
 * @param {'bscTestnet'|'bscMainnet'} [ctx.network]
 * @returns {{ update(dt:number, positionMeters:{x,y,z}, headingRadians:number):void, dispose():void }}
 */
export function mountOnchainPresence({ scene, hudRoot, network = 'bscTestnet' }) {
	const wrap = document.createElement('div');
	wrap.className = 'agora-oc-wrap';
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'agora-oc-toggle';
	toggle.setAttribute('aria-pressed', 'false');
	toggle.dataset.state = 'off';
	toggle.innerHTML = `<span class="dot"></span><span class="agora-oc-label">Record on-chain (BNB testnet)</span>`;
	const confirmBox = document.createElement('div');
	confirmBox.className = 'agora-oc-confirm';
	confirmBox.hidden = true;
	confirmBox.innerHTML = `
		<p>Sign moves with a local BSC testnet session key? No funds needed — moves are gasless via MegaFuel, self-pay only if sponsorship is ever down.</p>
		<div class="agora-oc-confirm-row">
			<button type="button" class="agora-oc-btn agora-oc-btn-primary" data-act="enable">Enable</button>
			<button type="button" class="agora-oc-btn" data-act="cancel">Cancel</button>
		</div>`;
	const hint = document.createElement('div');
	hint.className = 'agora-oc-hint';
	hint.hidden = true;
	wrap.append(toggle, confirmBox, hint);
	hudRoot.appendChild(wrap);

	const ghostGroup = new THREE.Group();
	ghostGroup.name = 'onchain-ghosts';
	scene.add(ghostGroup);
	const ghosts = createGhostTracker();
	const markerMeshes = new Map(); // player -> { group, sprite }

	let on = false;
	let disposed = false;
	let account = null;
	let worldId = 1;
	let contractAddress = null;
	let sender = null;
	let watcher = null;
	let firstHereTimer = null;
	let statusReason = '';
	let rpcOverrideClient = null; // set only by the ?bnbDevAddress/?bnbDevRpc override, see turnOn()

	function setState(state, reason = '') {
		toggle.dataset.state = state;
		toggle.setAttribute('aria-pressed', String(state.startsWith('on')));
		statusReason = reason;
		const labels = {
			off: 'Record on-chain (BNB testnet)',
			connecting: 'Connecting to BSC testnet…',
			on: 'On-chain · gasless',
			'on-selfpay': 'On-chain · self-pay (sponsor down)',
			'on-nofunds': 'On-chain paused — no funds',
			unavailable: 'On-chain unavailable (not deployed)',
		};
		toggle.querySelector('.agora-oc-label').textContent = labels[state] || labels.off;
		toggle.title = reason || '';
		toggle.disabled = state === 'unavailable';
	}

	function clearGhosts() {
		for (const [, m] of markerMeshes) disposeMarker(m);
		markerMeshes.clear();
		ghosts.clear();
		hint.hidden = true;
	}

	function disposeMarker(m) {
		ghostGroup.remove(m.group);
		m.mesh.geometry?.dispose?.();
		m.mesh.material?.dispose?.();
		m.sprite.material?.map?.dispose?.();
		m.sprite.material?.dispose?.();
	}

	function ensureMarker(player) {
		let m = markerMeshes.get(player);
		if (m) return m;
		const color = colorForAddress(player);
		const geo = new THREE.OctahedronGeometry(0.22, 0);
		const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.1 });
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.y = GHOST_HEIGHT;
		const group = new THREE.Group();
		group.add(mesh);
		const sprite = buildLabelSprite(shortAddr(player), 'on-chain', `#${color.getHexString()}`);
		sprite.position.y = GHOST_HEIGHT + 0.42;
		group.add(sprite);
		ghostGroup.add(group);
		m = { group, mesh, sprite };
		markerMeshes.set(player, m);
		return m;
	}

	function scheduleFirstHereHint() {
		clearTimeout(firstHereTimer);
		firstHereTimer = setTimeout(() => {
			if (on && ghosts.size === 0) {
				hint.hidden = false;
				hint.textContent = "You're the first one here on-chain — walk around, others will appear as they join.";
			}
		}, FIRST_HERE_HINT_MS);
	}

	async function turnOn() {
		setState('connecting');
		// Dev/demo override: `?bnbDevAddress=0x...&bnbDevRpc=http://host:port` points
		// this session at an already-deployed WorldMoves instance and RPC directly,
		// bypassing /api/bnb/world-config. Exists purely because the public BSC
		// testnet deploy is still blocked on a funded deployer key (PROGRESS.md
		// prompt 14/15) — the same "prove it against a real anvil fork of testnet
		// state" technique this campaign has used since prompt 02, just reachable
		// from a real browser session instead of only `cast`/`forge script`. It is
		// NEVER used unless BOTH params are explicitly present in the URL.
		let cfg;
		const override = devOverrideFromUrl();
		if (override) {
			cfg = { deployed: true, address: override.address, worldId: 1 };
			const { getPublicClient } = await import('../../api/_lib/bnb/chains.js');
			rpcOverrideClient = getPublicClient(network, { rpcs: [override.rpc], cache: false });
		} else {
			try {
				cfg = await fetchWorldConfig(network);
			} catch (err) {
				setState('off', `couldn't reach world-config: ${err.message}`);
				on = false;
				toggle.setAttribute('aria-pressed', 'false');
				return;
			}
			if (!cfg.deployed || !cfg.address) {
				setState('unavailable', 'WorldMoves is not deployed on this network yet — code is ready, address pending (see PROGRESS.md).');
				on = false;
				return;
			}
		}
		contractAddress = cfg.address;
		worldId = cfg.worldId;
		account = privateKeyToAccount(loadOrCreateKey());

		sender = createMoveSender({
			account,
			worldId,
			network,
			address: contractAddress,
			publicClient: rpcOverrideClient || undefined,
			onSent: (result) => {
				if (disposed) return;
				log.info(`[onchain-presence] move sent hash=${result.hash} mode=${result.mode} from=${account.address}`);
				setState(result.mode === 'sponsored' ? 'on' : 'on-selfpay', result.mode === 'sponsored' ? '' : result.reason || 'sponsorship unavailable right now');
			},
			onError: (err) => {
				if (disposed) return;
				log.warn('[onchain-presence] move send failed', err?.message);
				setState('on-nofunds', 'moves cannot be recorded on-chain right now — local movement is unaffected.');
			},
		});

		try {
			await sendJoin({ account, worldId, network }, { address: contractAddress, publicClient: rpcOverrideClient || undefined });
		} catch (err) {
			log.warn('[onchain-presence] join announce failed (non-fatal)', err?.message);
		}

		try {
			watcher = await watchWorldPresence({
				worldId,
				address: contractAddress,
				network,
				publicClient: rpcOverrideClient || undefined,
				onMove: (ev) => {
					if (ev.player.toLowerCase() === account.address.toLowerCase()) return; // never ghost yourself
					// Ghost tracker interpolates facing in contract centidegrees
					// (its default facingRange=36000) — converted to radians only at
					// render time in update(), below.
					const pos = fromContractPos(ev);
					const { isNew } = ghosts.upsert(ev.player, { ...pos, facing: ev.facing });
					if (isNew) log.info(`[onchain-presence] ghost joined player=${ev.player} pos=${JSON.stringify(pos)}`);
					hint.hidden = true;
				},
				onLeave: (ev) => {
					if (ev.player.toLowerCase() === account.address.toLowerCase()) return;
					const m = markerMeshes.get(ev.player.toLowerCase());
					if (m) {
						disposeMarker(m);
						markerMeshes.delete(ev.player.toLowerCase());
					}
					ghosts.remove(ev.player);
				},
				onError: (err) => log.warn('[onchain-presence] event watch error', err?.message),
			});
		} catch (err) {
			log.warn('[onchain-presence] could not start presence watcher', err?.message);
		}

		on = true;
		setState('on');
		scheduleFirstHereHint();
	}

	async function turnOff() {
		on = false;
		clearTimeout(firstHereTimer);
		sender?.stop();
		sender = null;
		watcher?.stop();
		watcher = null;
		if (account && contractAddress) {
			try {
				await sendLeave({ account, worldId, network }, { address: contractAddress, publicClient: rpcOverrideClient || undefined });
			} catch {
				/* best-effort — presence timeout via staleness covers this either way */
			}
		}
		clearGhosts();
		rpcOverrideClient = null;
		setState('off');
	}

	toggle.addEventListener('click', () => {
		if (toggle.disabled) return;
		if (on) {
			turnOff();
			return;
		}
		if (hasStoredKey()) {
			turnOn();
			return;
		}
		confirmBox.hidden = false;
	});
	confirmBox.addEventListener('click', (e) => {
		const act = e.target.closest('button')?.dataset.act;
		if (act === 'enable') {
			confirmBox.hidden = true;
			turnOn();
		} else if (act === 'cancel') {
			confirmBox.hidden = true;
		}
	});

	function update(dt, positionMeters, headingRadians) {
		if (disposed) return;
		if (on && sender) sender.updatePosition(positionMeters, headingRadians);
		const dead = ghosts.tick(dt);
		for (const key of dead) {
			const m = markerMeshes.get(key);
			if (m) {
				disposeMarker(m);
				markerMeshes.delete(key);
			}
		}
		for (const g of ghosts.values()) {
			let m = markerMeshes.get(g.player);
			if (!m) m = ensureMarker(g.player);
			m.group.position.set(g.x, g.y, g.z);
			m.mesh.rotation.y = fromContractFacing(g.facing);
			m.mesh.rotation.x += dt * 0.6; // gentle idle spin — reads as "on-chain" without a full avatar rig
		}
	}

	function dispose() {
		disposed = true;
		clearTimeout(firstHereTimer);
		sender?.stop();
		watcher?.stop();
		clearGhosts();
		scene.remove(ghostGroup);
		wrap.remove();
	}

	return { update, dispose, get isOn() { return on; }, get statusReason() { return statusReason; } };
}
