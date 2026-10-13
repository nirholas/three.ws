/**
 * pump-launch-core — shared engine for launching one pump.fun coin per GitHub
 * repo with 100% of creator rewards routed to a GitHub user's social-fee escrow.
 *
 * Used by both the CLI (scripts/pump-launch-repos.mjs) and the local control
 * panel (scripts/pump-launch-server.mjs). No process globals, no side effects on
 * import — every function takes an explicit config so the server can drive
 * multiple users/params in one process.
 *
 * Reward routing: pump.fun keys a deterministic escrow PDA off the numeric
 * GitHub user id — socialFeePda(id, 2) (platform 2 = GitHub). Each coin is
 * launched by a throwaway repo wallet (the on-chain creator + payer), then a
 * fee-sharing config sets the ONLY shareholder to that PDA at 10000 bps (100%).
 * The repo wallet keeps the fee-sharing admin authority; the GitHub owner claims
 * from the escrow by linking a Solana wallet.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	Keypair,
	Connection,
	PublicKey,
	Transaction,
	SystemProgram,
	ComputeBudgetProgram,
	LAMPORTS_PER_SOL,
	sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
	PumpSdk,
	OnlinePumpSdk,
	socialFeePda,
	feeSharingConfigPda,
	canonicalPumpPoolPda,
	getBuyTokenAmountFromSolAmount,
} from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import BN from 'bn.js';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const PLATFORM_GITHUB = 2;

// Cost model (SOL). pump.fun account rents are non-recoverable by the launcher.
export const COST = {
	create: 0.02, // mint + bonding-curve + metadata rent, baked into the create tx
	feeConfigRent: 0.0025, // rent for the fee-sharing config PDA
	txFees: 0.0003, // ~4 txs incl. priority fee + the master→wallet transfer
	buffer: 0.004, // headroom so a wallet never underfunds mid-launch
};

const DEFAULT_RPC = {
	mainnet: 'https://three.ws/api/solana-rpc',
	devnet: 'https://api.devnet.solana.com',
};

export const sol = (lamports) => lamports / LAMPORTS_PER_SOL;
export const lamports = (s) => Math.round(s * LAMPORTS_PER_SOL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Config ───────────────────────────────────────────────────────────────────
export function makeConfig(overrides = {}) {
	const network = overrides.network === 'devnet' ? 'devnet' : 'mainnet';
	const githubUser = overrides.githubUser || 'nirholas';
	const githubId = String(overrides.githubId || '');
	const devBuySol = Number(overrides.devBuySol ?? 0);
	const perCoin = COST.create + COST.feeConfigRent + COST.txFees + devBuySol;
	const cfg = {
		network,
		rpcUrl: overrides.rpcUrl || process.env.SOLANA_RPC_URL || DEFAULT_RPC[network],
		githubUser,
		githubId,
		platform: PLATFORM_GITHUB,
		devBuySol,
		fundPerWalletSol: Number(overrides.fundPerWalletSol ?? roundUp(perCoin + COST.buffer, 0.001)),
		includeForks: overrides.includeForks !== false,
		includeArchived: overrides.includeArchived !== false,
		walletDir: join(ROOT, '.pump-launch-wallets'),
		zipPath: join(ROOT, 'pump-launch-wallets.zip'),
	};
	cfg.manifestPath = join(cfg.walletDir, 'manifest.json');
	cfg.progressPath = join(cfg.walletDir, 'progress.json');
	cfg.masterPath = join(cfg.walletDir, 'master.json');
	cfg.socialPda = githubId ? socialFeePda(githubId, PLATFORM_GITHUB).toBase58() : null;
	cfg.perCoinSol = perCoin;
	return cfg;
}

function roundUp(n, step) {
	return Math.ceil(n / step) * step;
}

// ── JSON helpers ─────────────────────────────────────────────────────────────
export function loadJson(path, fallback = null) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return fallback;
	}
}
export function saveJson(path, data) {
	writeFileSync(path, JSON.stringify(data, null, 2));
}
function keypairFromFile(path) {
	return Keypair.fromSecretKey(Uint8Array.from(loadJson(path)));
}

// ── GitHub ───────────────────────────────────────────────────────────────────
function gh(args) {
	const res = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (res.status !== 0) throw new Error(`gh ${args[0]} failed: ${res.stderr || res.stdout}`);
	return res.stdout;
}

/** Resolve a GitHub login to its profile + numeric id + social-fee PDA. */
export function resolveGithubUser(login) {
	const clean = String(login || '').replace(/^@/, '').trim();
	if (!clean) throw new Error('missing GitHub username');
	const out = gh(['api', `users/${clean}`, '--jq', '{login,id,name,bio,avatar_url,public_repos,followers,html_url}']);
	const u = JSON.parse(out.trim());
	return {
		login: u.login,
		id: String(u.id),
		name: u.name,
		bio: u.bio,
		avatarUrl: u.avatar_url,
		publicRepos: u.public_repos,
		followers: u.followers,
		htmlUrl: u.html_url,
		socialFeePda: socialFeePda(String(u.id), PLATFORM_GITHUB).toBase58(),
	};
}

/**
 * List a user's public repos, enriched for the UI. Fetches twice and unions by
 * name so a transient short page can't silently undercount (this bit us once).
 */
export function fetchRepos(cfg) {
	const jq =
		'.[] | select(.private==false) | ' +
		'{name, description, fork, archived, stars: .stargazers_count, language, ' +
		'updated_at, homepage, html_url}';
	const byName = new Map();
	for (let pass = 0; pass < 2; pass++) {
		const out = gh([
			'api',
			`users/${cfg.githubUser}/repos?per_page=100&type=owner`,
			'--paginate',
			'--jq',
			jq,
		]);
		for (const line of out.trim().split('\n').filter(Boolean)) {
			const r = JSON.parse(line);
			if (!byName.has(r.name)) byName.set(r.name, r);
		}
	}
	let repos = [...byName.values()];
	if (!cfg.includeForks) repos = repos.filter((r) => !r.fork);
	if (!cfg.includeArchived) repos = repos.filter((r) => !r.archived);
	// Stable, useful default order: stars desc, then name.
	repos.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name));
	return repos.map((r) => ({
		...r,
		ogImage: `https://opengraph.githubassets.com/1/${cfg.githubUser}/${r.name}`,
	}));
}

// ── Ticker / metadata helpers ────────────────────────────────────────────────
export function makeSymbol(name, used) {
	let base = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
	if (!base) base = 'COIN';
	let sym = base;
	let n = 1;
	while (used.has(sym)) {
		const suffix = String(n++);
		sym = base.slice(0, 10 - suffix.length) + suffix;
	}
	used.add(sym);
	return sym;
}

// ── SDK / connection ─────────────────────────────────────────────────────────
export function makeConnection(cfg) {
	return new Connection(cfg.rpcUrl, 'confirmed');
}
export function makeSdk(connection) {
	return { offline: new PumpSdk(), online: new OnlinePumpSdk(connection) };
}
function budgetIxs(microLamports = 200_000, units = 400_000) {
	return [
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
		ComputeBudgetProgram.setComputeUnitLimit({ units }),
	];
}
async function sendTx(connection, instructions, payer, extraSigners = []) {
	const tx = new Transaction();
	tx.add(...budgetIxs(), ...instructions);
	return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners], {
		commitment: 'confirmed',
		maxRetries: 5,
	});
}

// ── Metadata upload (real image + JSON → pump.fun IPFS, no creds needed) ──────
export async function uploadMetadata(cfg, { name, symbol, description, website }) {
	let imageBuf = null;
	for (const url of [
		`https://opengraph.githubassets.com/1/${cfg.githubUser}/${name}`,
		`https://avatars.githubusercontent.com/u/${cfg.githubId}?s=400&v=4`,
	]) {
		try {
			const r = await fetch(url);
			if (r.ok) {
				imageBuf = Buffer.from(await r.arrayBuffer());
				break;
			}
		} catch {
			/* next */
		}
	}
	if (!imageBuf) throw new Error('could not fetch any coin image');

	const form = new FormData();
	form.append('file', new Blob([imageBuf], { type: 'image/png' }), 'image.png');
	form.append('name', name);
	form.append('symbol', symbol);
	form.append('description', description);
	form.append('twitter', '');
	form.append('telegram', '');
	form.append('website', website);
	form.append('showName', 'true');

	const r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: form });
	if (!r.ok) throw new Error(`pump.fun ipfs upload failed: ${r.status}`);
	const j = await r.json();
	const uri = j.metadataUri || j.metadata_uri || j.uri;
	if (!uri) throw new Error('pump.fun ipfs returned no metadataUri');
	return uri;
}

// ── Instruction builders ─────────────────────────────────────────────────────
export async function buildCreateIxs({ cfg, offline, online, mint, creator, uri, name, symbol }) {
	const global = await online.fetchGlobal();
	if (cfg.devBuySol > 0) {
		const solAmount = new BN(lamports(cfg.devBuySol));
		const amount = getBuyTokenAmountFromSolAmount({
			global,
			feeConfig: null,
			mintSupply: null,
			bondingCurve: null,
			amount: solAmount,
		});
		const ixs = await offline.createV2AndBuyInstructions({
			global,
			mint,
			name,
			symbol,
			uri,
			creator,
			user: creator,
			solAmount,
			amount,
			mayhemMode: false,
		});
		return Array.isArray(ixs) ? ixs : [ixs];
	}
	const ix = await offline.createV2Instruction({
		mint,
		name,
		symbol,
		uri,
		creator,
		user: creator,
		mayhemMode: false,
	});
	return [ix];
}

// ── Cost ─────────────────────────────────────────────────────────────────────
export function estimateCost(cfg, count) {
	const perCoin = cfg.perCoinSol;
	return {
		perCoinSol: perCoin,
		fundPerWalletSol: cfg.fundPerWalletSol,
		count,
		fundingTotalSol: +(cfg.fundPerWalletSol * count).toFixed(6),
		minSpendSol: +(perCoin * count).toFixed(6),
		breakdown: { ...COST, devBuySol: cfg.devBuySol },
	};
}

// ── Master ───────────────────────────────────────────────────────────────────
export function ensureMaster(cfg) {
	mkdirSync(cfg.walletDir, { recursive: true });
	if (existsSync(cfg.masterPath)) return keypairFromFile(cfg.masterPath);
	const master = Keypair.generate();
	writeFileSync(cfg.masterPath, JSON.stringify(Array.from(master.secretKey)), { mode: 0o600 });
	return master;
}
export function masterPubkey(cfg) {
	if (!existsSync(cfg.masterPath)) return null;
	return keypairFromFile(cfg.masterPath).publicKey.toBase58();
}
export async function masterBalanceLamports(cfg) {
	const pk = masterPubkey(cfg);
	if (!pk) return 0;
	try {
		return await makeConnection(cfg).getBalance(new PublicKey(pk));
	} catch {
		return 0;
	}
}

// ── Generate wallets + manifest + csv + readme + zip ─────────────────────────
export function generate(cfg, repos) {
	mkdirSync(cfg.walletDir, { recursive: true });
	const master = ensureMaster(cfg);

	const existing = loadJson(cfg.manifestPath, null);
	const existingByRepo = new Map((existing?.repos || []).map((r) => [r.repo, r]));
	const usedSymbols = new Set((existing?.repos || []).map((r) => r.symbol));

	const manifestRepos = [];
	const csvLines = ['repo,symbol,name,wallet_pubkey,wallet_secret_base58'];

	for (const r of repos) {
		const repoName = r.name || r.repo || r;
		const prev = existingByRepo.get(repoName);
		const walletFile = join(cfg.walletDir, `repo-${repoName.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
		let kp;
		let symbol;
		// Reuse any key already on disk — generating a subset must never mint a new
		// address over an existing wallet file (that would strand the old one).
		if (existsSync(walletFile)) {
			kp = keypairFromFile(walletFile);
			symbol = prev?.symbol || r.symbol || makeSymbol(repoName, usedSymbols);
			usedSymbols.add(symbol);
		} else {
			kp = Keypair.generate();
			writeFileSync(walletFile, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
			symbol = r.symbol || makeSymbol(repoName, usedSymbols);
		}
		const name = (r.coinName || repoName).slice(0, 32);
		const website = r.html_url || `https://github.com/${cfg.githubUser}/${repoName}`;
		const description =
			`${(r.description || repoName).slice(0, 180)} — ${website}. ` +
			`Creator rewards: 100% to github.com/${cfg.githubUser}.`;
		manifestRepos.push({
			repo: repoName,
			symbol,
			name,
			description,
			website,
			stars: r.stars ?? null,
			language: r.language ?? null,
			walletFile: walletFile.replace(ROOT + '/', ''),
			pubkey: kp.publicKey.toBase58(),
		});
		csvLines.push(
			[repoName, symbol, JSON.stringify(name), kp.publicKey.toBase58(), bs58.encode(kp.secretKey)].join(','),
		);
	}

	const cost = estimateCost(cfg, manifestRepos.length);
	const manifest = {
		github_user: cfg.githubUser,
		github_id: cfg.githubId,
		social_fee_pda: cfg.socialPda,
		network: cfg.network,
		dev_buy_sol: cfg.devBuySol,
		fund_per_wallet_sol: cfg.fundPerWalletSol,
		master_pubkey: master.publicKey.toBase58(),
		repo_count: manifestRepos.length,
		funding_total_sol: cost.fundingTotalSol,
		repos: manifestRepos,
	};
	saveJson(cfg.manifestPath, manifest);
	writeFileSync(join(cfg.walletDir, 'wallets.csv'), csvLines.join('\n') + '\n');
	writeReadme(cfg, manifest, cost);
	makeZip(cfg);
	return manifest;
}

function writeReadme(cfg, manifest, cost) {
	writeFileSync(
		join(cfg.walletDir, 'README.txt'),
		[
			`pump.fun launch wallets — ${manifest.repo_count} coins for github.com/${cfg.githubUser}`,
			``,
			`Creator rewards on EVERY coin: 100% → github.com/${cfg.githubUser}`,
			`  via pump.fun social-fee escrow PDA: ${cfg.socialPda}`,
			``,
			`MASTER WALLET (fund this one): ${manifest.master_pubkey}`,
			`  Fund it with ~${cost.fundingTotalSol.toFixed(4)} SOL (covers all ${manifest.repo_count} launches).`,
			``,
			`Files: master.json, repo-<name>.json (Solana CLI byte arrays),`,
			`       wallets.csv (base58 secrets for Phantom import), manifest.json.`,
			``,
			`NEVER commit this folder — it is gitignored. Keep the zip private.`,
		].join('\n') + '\n',
	);
}

export function makeZip(cfg) {
	const res = spawnSync('zip', ['-r', '-q', cfg.zipPath, '.pump-launch-wallets'], {
		cwd: ROOT,
		encoding: 'utf8',
	});
	return res.status === 0;
}

// ── Ownership verification ───────────────────────────────────────────────────
export function verifyOwnership(cfg) {
	const manifest = loadJson(cfg.manifestPath, null);
	if (!manifest) return { ok: 0, total: 0, mismatches: [], master: false };
	const mismatches = [];
	let ok = 0;
	for (const r of manifest.repos) {
		try {
			const derived = keypairFromFile(join(ROOT, r.walletFile)).publicKey.toBase58();
			if (derived === r.pubkey) ok++;
			else mismatches.push(r.repo);
		} catch {
			mismatches.push(r.repo);
		}
	}
	const master = existsSync(cfg.masterPath) && masterPubkey(cfg) === manifest.master_pubkey;
	return { ok, total: manifest.repos.length, mismatches, master };
}

// ── Social-fee escrow PDA init (once, master pays) ───────────────────────────
async function ensureSocialPda(cfg, connection, offline, master, progress) {
	if (progress.__socialPda?.created) return;
	const pda = new PublicKey(cfg.socialPda);
	const info = await connection.getAccountInfo(pda).catch(() => null);
	if (info) {
		progress.__socialPda = { created: true, note: 'already existed' };
		saveJson(cfg.progressPath, progress);
		return;
	}
	try {
		const ix = await offline.createSocialFeePda({
			payer: master.publicKey,
			userId: cfg.githubId,
			platform: cfg.platform,
		});
		const sig = await sendTx(connection, Array.isArray(ix) ? ix : [ix], master);
		progress.__socialPda = { created: true, sig };
	} catch (e) {
		progress.__socialPda = { created: false, error: e.message };
	}
	saveJson(cfg.progressPath, progress);
}

// ── Fund + launch (with progress callback) ───────────────────────────────────
export function loadState(cfg) {
	const manifest = loadJson(cfg.manifestPath, null);
	const progress = loadJson(cfg.progressPath, {});
	if (!manifest) return { manifest: null, progress, rows: [] };
	const rows = manifest.repos.map((r) => {
		const st = progress[r.repo] || {};
		return {
			repo: r.repo,
			symbol: r.symbol,
			pubkey: r.pubkey,
			funded: !!st.funded,
			mint: st.mint || null,
			launched: !!st.launchSig,
			feeShared: !!st.feeShareSig,
			launchSig: st.launchSig || null,
			feeShareSig: st.feeShareSig || null,
			error: st.error || null,
		};
	});
	return { manifest, progress, rows };
}

/**
 * Fund unfunded wallets then launch. `onEvent` receives structured progress:
 *   { type:'info'|'repo'|'done'|'error', repo, phase, status, sig, mint, index, total, message }
 * Filter by repo names via `repoNames` (null = all in manifest).
 */
export async function runLaunch(cfg, { repoNames = null, onEvent = () => {} } = {}) {
	const manifest = loadJson(cfg.manifestPath, null);
	if (!manifest) throw new Error('no manifest — generate first');
	const connection = makeConnection(cfg);
	const { offline, online } = makeSdk(connection);
	const master = keypairFromFile(cfg.masterPath);
	const progress = loadJson(cfg.progressPath, {});

	let repos = manifest.repos;
	if (repoNames) {
		const set = new Set(repoNames);
		repos = repos.filter((r) => set.has(r.repo));
	}
	const total = repos.length;

	// Preflight: master balance.
	const need = lamports(cfg.fundPerWalletSol) * repos.filter((r) => !progress[r.repo]?.funded).length;
	const bal = await connection.getBalance(master.publicKey);
	onEvent({ type: 'info', message: `master balance ${sol(bal).toFixed(4)} SOL, needs ${sol(need).toFixed(4)} SOL for funding` });
	if (bal < need) {
		onEvent({ type: 'error', message: `master underfunded: has ${sol(bal).toFixed(4)} SOL, needs ${sol(need).toFixed(4)} SOL` });
		throw new Error('master underfunded');
	}

	await ensureSocialPda(cfg, connection, offline, master, progress);

	let index = 0;
	for (const r of repos) {
		index++;
		const st = progress[r.repo] || {};
		const wallet = keypairFromFile(join(ROOT, r.walletFile));
		try {
			// 1. Fund
			if (!st.funded) {
				onEvent({ type: 'repo', repo: r.repo, phase: 'fund', status: 'start', index, total });
				const ix = SystemProgram.transfer({
					fromPubkey: master.publicKey,
					toPubkey: wallet.publicKey,
					lamports: lamports(cfg.fundPerWalletSol),
				});
				st.fundSig = await sendTx(connection, [ix], master);
				st.funded = true;
				progress[r.repo] = st;
				saveJson(cfg.progressPath, progress);
			}

			// 2. Create coin (+ optional dev buy)
			if (!st.launchSig) {
				onEvent({ type: 'repo', repo: r.repo, phase: 'launch', status: 'start', index, total });
				const uri = st.uri || (await uploadMetadata(cfg, r));
				st.uri = uri;
				const mint = st.mintSecret ? Keypair.fromSecretKey(Uint8Array.from(st.mintSecret)) : Keypair.generate();
				st.mint = mint.publicKey.toBase58();
				st.mintSecret = Array.from(mint.secretKey);
				progress[r.repo] = st;
				saveJson(cfg.progressPath, progress);
				const createIxs = await buildCreateIxs({
					cfg,
					offline,
					online,
					mint: mint.publicKey,
					creator: wallet.publicKey,
					uri,
					name: r.name,
					symbol: r.symbol,
				});
				st.launchSig = await sendTx(connection, createIxs, wallet, [mint]);
				progress[r.repo] = st;
				saveJson(cfg.progressPath, progress);
			}

			// 3. Fee-sharing config
			const mintPk = new PublicKey(st.mint);
			if (!st.feeCfgSig) {
				onEvent({ type: 'repo', repo: r.repo, phase: 'feeconfig', status: 'start', index, total });
				const pool = canonicalPumpPoolPda(mintPk);
				const ix = await offline.createFeeSharingConfig({ creator: wallet.publicKey, mint: mintPk, pool });
				st.feeCfgSig = await sendTx(connection, [ix], wallet);
				progress[r.repo] = st;
				saveJson(cfg.progressPath, progress);
			}

			// 4. Delegate 100% to the GitHub social-fee PDA
			if (!st.feeShareSig) {
				onEvent({ type: 'repo', repo: r.repo, phase: 'delegate', status: 'start', index, total });
				const ix = await offline.updateFeeShares({
					authority: wallet.publicKey,
					mint: mintPk,
					currentShareholders: [wallet.publicKey],
					newShareholders: [{ address: new PublicKey(cfg.socialPda), shareBps: 10000 }],
				});
				st.feeShareSig = await sendTx(connection, [ix], wallet);
				progress[r.repo] = st;
				saveJson(cfg.progressPath, progress);
			}

			delete st.error;
			progress[r.repo] = st;
			saveJson(cfg.progressPath, progress);
			onEvent({
				type: 'done',
				repo: r.repo,
				mint: st.mint,
				launchSig: st.launchSig,
				feeShareSig: st.feeShareSig,
				index,
				total,
			});
		} catch (e) {
			st.error = e.message;
			progress[r.repo] = st;
			saveJson(cfg.progressPath, progress);
			onEvent({ type: 'error', repo: r.repo, message: e.message, index, total });
		}
		await sleep(300);
	}
	onEvent({ type: 'complete', total });
}

export function explorerTx(cfg, sig) {
	return `https://solscan.io/tx/${sig}${cfg.network === 'devnet' ? '?cluster=devnet' : ''}`;
}
