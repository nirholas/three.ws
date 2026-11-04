/**
 * "Put on Solana" panel for a drop collection page.
 *
 * Owner flow: create the drop's Metaplex Core collection once, then mint
 * revealed items into it one at a time or in bounded batches. Devnet is the
 * default and free; mainnet is a real on-chain write, so it is behind an
 * explicit toggle, an up-front cost line and a confirmation checkbox, and the
 * server independently refuses a mainnet call without confirm_mainnet:true.
 *
 * Everyone sees the collection address and a Solscan link once it exists.
 */

const BATCH_PAUSE_GUARD = 40;
const RENT_PER_ITEM_SOL = '0.003';

const $ = (id) => document.getElementById(id);

const ui = {
	root: $('dr-chain'),
	status: $('dr-chain-status'),
	skeleton: $('dr-chain-skeleton'),
	body: $('dr-chain-body'),
	networkDevnet: $('dr-chain-net-devnet'),
	networkMainnet: $('dr-chain-net-mainnet'),
	cost: $('dr-chain-cost'),
	confirmRow: $('dr-chain-confirm-row'),
	confirm: $('dr-chain-confirm'),
	wallet: $('dr-chain-wallet'),
	empty: $('dr-chain-empty'),
	collection: $('dr-chain-collection'),
	create: $('dr-chain-create'),
	mintOne: $('dr-chain-mint-one'),
	mintAll: $('dr-chain-mint-all'),
	progress: $('dr-chain-progress'),
	note: $('dr-chain-note'),
	controls: $('dr-chain-controls'),
};

let api = null;
let network = 'devnet';
let busy = false;

function say(message, kind) {
	ui.note.textContent = message || '';
	ui.note.className = `dr-note${kind ? ` dr-note--${kind}` : ''}`;
}

function explorer(address, net) {
	
}

async function post(path, body) {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(friendly(res.status, data));
		err.code = data?.error || data?.code;
		err.status = res.status;
		throw err;
	}
	return data;
}

function friendly(status, data) {
	const msg = data?.error_description || data?.message || '';
	if (status === 401) return 'Sign in as the creator to put this drop on Solana.';
	if (status === 403) return 'Only the creator of this drop can put it on Solana.';
	if (status === 429) return msg || 'Mint budget reached for now. Try again shortly.';
	if (status === 503) return 'Solana minting is not configured on this deployment.';
	if (status >= 500) {
		return `The Solana RPC or storage did not answer (${status}). Nothing was minted and this item can be retried.`;
	}
	return msg || `The request failed (${status}).`;
}

function setBusy(next) {
	busy = next;
	render();
}

function render() {
	const drop = api.getDrop();
	if (!drop) return;
	const live = drop.status !== 'draft';
	const showPanel = drop.is_owner || Boolean(drop.collection_address);
	ui.root.hidden = !showPanel;
	if (!showPanel) return;

	ui.skeleton.hidden = true;
	ui.body.hidden = false;

	const locked = drop.collection_network || null;
	if (locked) network = locked;
	ui.networkDevnet.setAttribute('aria-pressed', String(network === 'devnet'));
	ui.networkMainnet.setAttribute('aria-pressed', String(network === 'mainnet'));
	ui.networkDevnet.disabled = busy || Boolean(locked);
	ui.networkMainnet.disabled = busy || Boolean(locked);

	const isMainnet = network === 'mainnet';
	ui.cost.textContent = isMainnet
		? `Mainnet is a real, irreversible on-chain write. Each item costs roughly ${RENT_PER_ITEM_SOL} SOL of rent, paid by the three.ws collection authority, and the collection account is created once.`
		: 'Devnet costs nothing and uses test SOL. Use it to check the result before going to mainnet.';
	ui.confirmRow.hidden = !isMainnet || !drop.is_owner;

	if (drop.collection_address) {
		ui.collection.hidden = false;
		ui.collection.textContent = '';
		const label = document.createElement('span');
		label.textContent = 'Collection ';
		const a = document.createElement('a');
		a.href = explorer(drop.collection_address, drop.collection_network || 'devnet');
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.className = 'dr-hash';
		a.textContent = drop.collection_address;
		ui.collection.append(label, a);
	} else {
		ui.collection.hidden = true;
	}

	ui.controls.hidden = !drop.is_owner;
	const mintable = Math.max((drop.revealed_count || 0) - (drop.minted_count || 0), 0);
	const item = api.getSelected();
	const hasCollection = Boolean(drop.collection_address);
	const confirmed = !isMainnet || ui.confirm.checked;

	ui.empty.hidden = !(drop.is_owner && (drop.revealed_count || 0) === 0 && !hasCollection) && !(drop.is_owner && !live);
	ui.empty.textContent = !live
		? 'Publish the drop first. A collection can only be anchored once its seed is public.'
		: 'Reveal items first. Only revealed items can be minted.';

	ui.create.hidden = hasCollection;
	ui.create.disabled = busy || !live || !confirmed;
	ui.create.textContent = busy ? 'Working...' : `Create collection on ${isMainnet ? 'mainnet' : 'devnet'}`;

	const canMintSelected = hasCollection && item && item.status === 'revealed' && !item.mint_address;
	ui.mintOne.hidden = !hasCollection;
	ui.mintOne.disabled = busy || !canMintSelected || !confirmed;
	ui.mintOne.textContent = item?.mint_address ? 'Item minted' : 'Mint this item';

	ui.mintAll.hidden = !hasCollection;
	ui.mintAll.disabled = busy || mintable === 0 || !confirmed;
	ui.mintAll.textContent = mintable ? `Mint all revealed (${mintable})` : 'Nothing left to mint';
}

async function createCollection() {
	setBusy(true);
	say('Creating the collection on Solana. This waits for chain confirmation.', '');
	try {
		const data = await post('/api/drops/mint-collection', {
			slug: api.getDrop().slug,
			network,
			confirm_mainnet: network === 'mainnet' ? ui.confirm.checked : undefined,
		});
		say(data.created ? 'Collection created.' : 'This drop already had its collection.', 'ok');
		await api.reloadDrop();
	} catch (err) {
		say(err.message, 'error');
	} finally {
		setBusy(false);
	}
}

async function mintSelected() {
	const item = api.getSelected();
	if (!item) return;
	setBusy(true);
	say(`Minting item #${item.index}. This waits for chain confirmation.`, '');
	try {
		const data = await post('/api/drops/mint', {
			slug: api.getDrop().slug,
			index: item.index,
			network: api.getDrop().collection_network || network,
			owner_wallet: ui.wallet.value.trim() || undefined,
			confirm_mainnet: network === 'mainnet' ? ui.confirm.checked : undefined,
		});
		api.onMinted(data);
		say(data.idempotent ? 'Already minted. Showing the existing mint.' : 'Minted.', 'ok');
		await api.reloadDrop();
	} catch (err) {
		say(err.message, 'error');
	} finally {
		setBusy(false);
	}
}

async function mintAll() {
	setBusy(true);
	let total = 0;
	let failures = 0;
	try {
		for (let i = 0; i < BATCH_PAUSE_GUARD; i++) {
			say(total ? `Minted ${total} so far...` : 'Minting revealed items in batches...', '');
			ui.progress.hidden = false;
			ui.progress.textContent = `${total} minted`;
			const data = await post('/api/drops/mint', {
				slug: api.getDrop().slug,
				all: true,
				network: api.getDrop().collection_network || network,
				owner_wallet: ui.wallet.value.trim() || undefined,
				confirm_mainnet: network === 'mainnet' ? ui.confirm.checked : undefined,
			});
			total += data.minted.length;
			failures += data.failed.length;
			data.minted.forEach((m) => api.onMinted(m));
			await api.reloadDrop();
			if (data.done || data.remaining === 0 || (data.minted.length === 0 && data.failed.length > 0)) break;
		}
		say(
			failures
				? `${total} minted, ${failures} failed. Failed items stay retryable; press the button again.`
				: `${total} minted.`,
			failures ? 'error' : 'ok',
		);
	} catch (err) {
		say(`${total} minted before it stopped: ${err.message}`, 'error');
	} finally {
		ui.progress.hidden = true;
		setBusy(false);
	}
}

export function initMintPanel(hooks) {
	if (!ui.root) return { render() {} };
	api = hooks;
	ui.skeleton.hidden = false;
	ui.body.hidden = true;
	const pick = (net) => () => {
		network = net;
		ui.confirm.checked = false;
		render();
	};
	ui.networkDevnet.addEventListener('click', pick('devnet'));
	ui.networkMainnet.addEventListener('click', pick('mainnet'));
	ui.confirm.addEventListener('change', render);
	ui.create.addEventListener('click', createCollection);
	ui.mintOne.addEventListener('click', mintSelected);
	ui.mintAll.addEventListener('click', mintAll);
	return { render };
}
