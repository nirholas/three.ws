#!/usr/bin/env node
// coin-cli — lifecycle management for the lottery + reflection coin.
//
// Subcommands:
//   keygen [--out <path>]            generate a fresh Solana keypair (treasury / creator)
//   prepare <name> <symbol>          build pump.fun-compatible metadata JSON, pin to IPFS
//                                    via /api/pinning/pin (if a session cookie is provided
//                                    via THREEWS_SESSION_COOKIE) or fall back to writing
//                                    the JSON to disk for manual hosting
//   launch <metadata-url>            build + sign + submit a pump.fun create-v2 tx
//                                    using --wallet <keypair.json> as the buyer/fee-payer
//                                    and --creator <keypair.json> as the pump.fun creator
//                                    (the address whose pubkey is written to BondingCurve.creator).
//                                    Refuses to send unless --execute is also passed.
//   register <mint>                  insert a coin_launches row for an already-launched mint.
//                                    Requires DATABASE_URL. Defaults to is_live=false so the
//                                    cron runs in dry-run mode until you explicitly activate.
//   activate <mint> [--enable|--disable]
//                                    flip coin_launches.is_live for an existing row.
//
// Common flags:
//   --network mainnet|devnet         (default: mainnet)
//   --rpc <url>                      override SOLANA_RPC_URL for the launch step
//
// Each subcommand prints the resulting state at the end so the operator can
// copy/paste env vars into Vercel without re-running. No subcommand mutates
// remote state without the operator explicitly invoking that command.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { PumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import BN from 'bn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── env loader ──────────────────────────────────────────────────────────────

function loadDotenv() {
	for (const fname of ['.env.local', '.env', '.env.production']) {
		const p = path.join(REPO_ROOT, fname);
		if (!fs.existsSync(p)) continue;
		for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (!m) continue;
			if (process.env[m[1]] === undefined) {
				process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
			}
		}
	}
}
loadDotenv();

function rpcUrl(network) {
	if (process.env.SOLANA_RPC_URL && network !== 'devnet') return process.env.SOLANA_RPC_URL;
	if (network === 'devnet') {
		return process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
	}
	if (process.env.HELIUS_API_KEY) {
		return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
	}
	return 'https://api.mainnet-beta.solana.com';
}

// ── arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
	const [cmd, ...rest] = argv.slice(2);
	const positional = [];
	const opts = {};
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a.startsWith('--')) {
			const name = a.slice(2);
			const next = rest[i + 1];
			if (next === undefined || next.startsWith('--')) {
				opts[name] = true;
			} else {
				opts[name] = next;
				i++;
			}
		} else {
			positional.push(a);
		}
	}
	return { cmd, positional, opts };
}

// ── keypair helpers ─────────────────────────────────────────────────────────

function loadKeypair(p) {
	if (!fs.existsSync(p)) throw new Error(`keypair not found: ${p}`);
	const secret = JSON.parse(fs.readFileSync(p, 'utf8'));
	if (!Array.isArray(secret) || secret.length !== 64) {
		throw new Error(`expected 64-byte JSON array at ${p}`);
	}
	return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function writeKeypair(p, kp) {
	fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
}

// ── confirmation prompt ─────────────────────────────────────────────────────

async function confirm(prompt) {
	const rl = readline.createInterface({ input, output });
	const answer = (await rl.question(`${prompt} (type 'yes' to proceed) > `)).trim().toLowerCase();
	rl.close();
	return answer === 'yes';
}

// ── keygen ──────────────────────────────────────────────────────────────────

async function cmdKeygen(opts) {
	const kp = Keypair.generate();
	const outPath = opts.out || path.join(REPO_ROOT, `.coin-keypair-${kp.publicKey.toBase58().slice(0, 8)}.json`);
	writeKeypair(outPath, kp);
	const b64 = Buffer.from(kp.secretKey).toString('base64');
	console.log(JSON.stringify({
		brand: 'three.ws',
		address: kp.publicKey.toBase58(),
		keypair_file: outPath,
		secret_key_b64: b64,
		hint: {
			next_step: 'Set COIN_TREASURY_SECRET_KEY_B64 (or COIN_CREATOR_SECRET_KEY_B64_<MINT>) in your three.ws Vercel env to secret_key_b64.',
			gitignore: 'Add the keypair file path to .gitignore before committing anything.',
		},
	}, null, 2));
}

// ── prepare metadata ────────────────────────────────────────────────────────

async function cmdPrepare(positional, opts) {
	const [name, symbol] = positional;
	if (!name || !symbol) {
		throw new Error('Usage: prepare <name> <symbol> [--description "..."] [--image <url>] [--website https://three.ws] [--twitter https://x.com/trythreews]');
	}
	const website = opts.website || 'https://three.ws';
	const description =
		opts.description ||
		`A three.ws lottery + SOL reflection coin. Every holder is a ticket: hourly draws send the lottery pot to one random eligible wallet, and a passive SOL reflection drips to every holder between draws. Verifiable randomness end-to-end. Live dashboard: ${website}/coin`;
	const image = opts.image || null;
	const twitter = opts.twitter || process.env.THREEWS_TWITTER_URL || 'https://x.com/trythreews';

	const metadata = {
		name,
		symbol,
		description,
		...(image ? { image } : {}),
		showName: true,
		// pump.fun's metadata schema requires this field literally — it's how
		// their indexer recognizes valid coin metadata. The user-facing
		// "Website" link rendered on the coin page is `website` below.
		createdOn: 'https://pump.fun',
		website,
		external_url: `${website}/coin`,
		twitter,
		platform: 'three.ws',
	};

	const outPath = opts.out || path.join(REPO_ROOT, `.coin-metadata-${symbol.toLowerCase()}.json`);
	fs.writeFileSync(outPath, JSON.stringify(metadata, null, 2));

	// If THREEWS_SESSION_COOKIE is set, try uploading to R2 via the
	// /api/pump/build-metadata endpoint. Otherwise, the operator must host
	// the JSON themselves (Pinata, GitHub Pages, etc).
	const cookie = process.env.THREEWS_SESSION_COOKIE;
	const apiOrigin = process.env.THREEWS_API_ORIGIN || 'https://three.ws';

	let metadataUrl = null;
	if (cookie) {
		try {
			const body = { name, symbol, description };
			if (image && image.startsWith('data:')) body.image_data_url = image;
			const resp = await fetch(`${apiOrigin}/api/pump/build-metadata`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie },
				body: JSON.stringify(body),
			});
			if (resp.ok) {
				const data = await resp.json();
				metadataUrl = data.metadata_url;
			} else {
				console.error(`(build-metadata upload failed: ${resp.status}; falling back to local file)`);
			}
		} catch (err) {
			console.error(`(build-metadata upload errored: ${err.message}; falling back to local file)`);
		}
	}

	console.log(JSON.stringify({
		brand: 'three.ws',
		metadata,
		metadata_file: outPath,
		metadata_url: metadataUrl,
		next_step: metadataUrl
			? `Run: node scripts/coin-cli.mjs launch ${metadataUrl} --wallet <buyer.json> --creator <creator.json> --name "${name}" --symbol "${symbol}"`
			: `Host ${outPath} at a public HTTPS URL (or set THREEWS_SESSION_COOKIE to auto-pin to three.ws), then: node scripts/coin-cli.mjs launch <URL> --wallet <buyer.json> --creator <creator.json> --name "${name}" --symbol "${symbol}"`,
	}, null, 2));
}

// ── launch ──────────────────────────────────────────────────────────────────

async function cmdLaunch(positional, opts) {
	const [uri] = positional;
	if (!uri) throw new Error('Usage: launch <metadata-url> --wallet <buyer.json> --creator <creator.json> [--buy <sol>] [--name "..."] [--symbol "..."] [--execute]');
	if (!opts.wallet) throw new Error('--wallet <buyer.json> is required (fee payer + initial buyer)');
	if (!opts.creator) throw new Error('--creator <creator.json> is required (pump.fun creator address; receives creator fees)');
	if (!opts.name) throw new Error('--name "..." is required');
	if (!opts.symbol) throw new Error('--symbol "..." is required');

	const network = opts.network || 'mainnet';
	const rpc = opts.rpc || rpcUrl(network);
	const buySol = opts.buy ? parseFloat(opts.buy) : 0;
	if (Number.isNaN(buySol) || buySol < 0) throw new Error('Invalid --buy value');

	const buyer = loadKeypair(opts.wallet);
	const creator = loadKeypair(opts.creator);

	let mint;
	if (opts['mint-keypair']) {
		mint = loadKeypair(opts['mint-keypair']);
		console.error(`Using existing mint keypair: ${mint.publicKey.toBase58()}`);
	} else {
		mint = Keypair.generate();
	}

	const connection = new Connection(rpc, 'confirmed');

	console.error('');
	console.error('— three.ws coin launch parameters —');
	console.error('  network:    ', network);
	console.error('  RPC:        ', rpc.replace(/api-key=[^&]+/, 'api-key=***'));
	console.error('  buyer/payer:', buyer.publicKey.toBase58());
	console.error('  creator:    ', creator.publicKey.toBase58());
	console.error('  mint:       ', mint.publicKey.toBase58());
	console.error('  name:       ', opts.name);
	console.error('  symbol:     ', opts.symbol);
	console.error('  metadata:   ', uri);
	console.error('  buy-in:     ', buySol, 'SOL');
	console.error('');

	const balance = await connection.getBalance(buyer.publicKey);
	console.error(`  buyer balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
	const minNeeded = 0.025 + buySol;
	if (balance / LAMPORTS_PER_SOL < minNeeded) {
		throw new Error(`buyer needs at least ~${minNeeded.toFixed(3)} SOL (has ${(balance / LAMPORTS_PER_SOL).toFixed(4)})`);
	}

	const wallet = new Wallet(buyer);
	const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
	const sdk = new PumpSdk(provider);

	const instructions = [];
	const mayhemMode = false;
	if (buySol > 0) {
		const global = await sdk.fetchGlobal();
		const solAmount = new BN(Math.floor(buySol * LAMPORTS_PER_SOL));
		const tokenAmount = getBuyTokenAmountFromSolAmount({
			global,
			feeConfig: null,
			mintSupply: null,
			bondingCurve: null,
			amount: solAmount,
		});
		const ixs = await sdk.createV2AndBuyInstructions({
			global,
			mint: mint.publicKey,
			name: opts.name,
			symbol: opts.symbol,
			uri,
			creator: creator.publicKey,
			user: buyer.publicKey,
			solAmount,
			amount: tokenAmount,
			mayhemMode,
		});
		instructions.push(...(Array.isArray(ixs) ? ixs : [ixs]));
	} else {
		const ix = await sdk.createV2Instruction({
			mint: mint.publicKey,
			name: opts.name,
			symbol: opts.symbol,
			uri,
			creator: creator.publicKey,
			user: buyer.publicKey,
			mayhemMode,
		});
		instructions.push(ix);
	}

	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const msg = new TransactionMessage({
		payerKey: buyer.publicKey,
		recentBlockhash: blockhash,
		instructions,
	}).compileToV0Message();
	const tx = new VersionedTransaction(msg);

	// Sign with all three keys: buyer (fee payer + user), mint (new token authority),
	// creator (only if it differs from buyer — pump.fun's program treats creator as
	// an instruction argument, not a signer, so this is just defensive against future
	// program upgrades that may add a signer requirement).
	const signers = [buyer, mint];
	if (creator.publicKey.toBase58() !== buyer.publicKey.toBase58()) signers.push(creator);
	tx.sign(signers);

	console.error('— Simulating —');
	const sim = await connection.simulateTransaction(tx, { sigVerify: false });
	if (sim.value.err) {
		console.error('Simulation FAILED:', JSON.stringify(sim.value.err));
		for (const l of sim.value.logs || []) console.error('  ', l);
		throw new Error('aborting (simulation failed)');
	}
	console.error('  OK; compute units consumed:', sim.value.unitsConsumed);

	if (!opts.execute) {
		// Print the serialized tx so the operator can submit it manually if desired.
		const serialized = Buffer.from(tx.serialize()).toString('base64');
		console.error('');
		console.error('DRY RUN — re-run with --execute to submit on-chain.');
		console.log(JSON.stringify({
			dry_run: true,
			mint: mint.publicKey.toBase58(),
			creator: creator.publicKey.toBase58(),
			buyer: buyer.publicKey.toBase58(),
			tx_base64: serialized,
			next_step: 'Re-run with --execute, OR submit the tx_base64 yourself.',
		}, null, 2));
		return;
	}

	const proceed = await confirm(`About to launch ${opts.symbol} (${mint.publicKey.toBase58()}) on ${network} — proceed?`);
	if (!proceed) {
		console.error('aborted');
		process.exit(1);
	}

	console.error('— Submitting on three.ws —');
	const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
	console.error('  signature:    ', sig);
	console.error('  solana tx:    ', 'https://solscan.io/tx/' + sig);

	const conf = await connection.confirmTransaction(
		{ signature: sig, blockhash, lastValidBlockHeight },
		'confirmed',
	);
	if (conf.value.err) throw new Error('confirmation error: ' + JSON.stringify(conf.value.err));

	console.error('LAUNCHED on three.ws.');
	const dashboardOrigin = process.env.PUBLIC_APP_ORIGIN || 'https://three.ws';
	console.log(JSON.stringify({
		mint: mint.publicKey.toBase58(),
		creator_wallet: creator.publicKey.toBase58(),
		buyer_wallet: buyer.publicKey.toBase58(),
		tx_signature: sig,
		dashboard_url: `${dashboardOrigin}/coin/${mint.publicKey.toBase58()}`,
		solana_tx_url: `https://solscan.io/tx/${sig}`,
		pump_fun_url: `https://pump.fun/coin/${mint.publicKey.toBase58()}`,
		next_step: `Run: node scripts/coin-cli.mjs register ${mint.publicKey.toBase58()} --name "${opts.name}" --symbol "${opts.symbol}" --creator-wallet ${creator.publicKey.toBase58()} --creator-secret-b64 <base64>`,
	}, null, 2));
}

// ── register / activate (DB-only, uses Neon serverless driver) ──────────────

async function neonSql() {
	const [{ neon, neonConfig }, ws] = await Promise.all([
		import('@neondatabase/serverless'),
		import('ws'),
	]);
	neonConfig.webSocketConstructor = ws.default || ws;
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL not set — required for register/activate');
	return neon(url);
}

async function cmdRegister(positional, opts) {
	const [mint] = positional;
	if (!mint) throw new Error('Usage: register <mint> --name "..." --symbol "..." --creator-wallet <pubkey> [--creator-secret-b64 <b64>] [--lottery-bps 7000] [--reflection-bps 2500] [--ops-bps 500] [--draw-interval-seconds 3600] [--ops-wallet <pubkey>] [--network mainnet|devnet]');
	if (!opts.name) throw new Error('--name is required');
	if (!opts.symbol) throw new Error('--symbol is required');
	if (!opts['creator-wallet']) throw new Error('--creator-wallet is required (the pump.fun creator pubkey for this mint)');

	// Validate pubkey shape.
	new PublicKey(mint);
	new PublicKey(opts['creator-wallet']);
	if (opts['ops-wallet']) new PublicKey(opts['ops-wallet']);

	const lottery_bps = parseInt(opts['lottery-bps'] || '7000', 10);
	const reflection_bps = parseInt(opts['reflection-bps'] || '2500', 10);
	const ops_bps = parseInt(opts['ops-bps'] || '500', 10);
	if (lottery_bps + reflection_bps + ops_bps !== 10_000) {
		throw new Error('lottery_bps + reflection_bps + ops_bps must sum to 10000');
	}
	const draw_interval = parseInt(opts['draw-interval-seconds'] || '3600', 10);
	const reflection_interval = parseInt(opts['reflection-interval-seconds'] || String(draw_interval), 10);

	const metadata = {
		platform: 'three.ws',
		notes: opts.notes || null,
		treasury_is_creator: !!opts['treasury-is-creator'],
	};
	if (opts['creator-secret-b64']) {
		metadata.creator_secret_b64 = opts['creator-secret-b64'];
	}

	const sql = await neonSql();
	const rows = await sql`
		insert into coin_launches (
			mint, name, symbol, network, creator_wallet, ops_wallet,
			lottery_bps, reflection_bps, ops_bps,
			draw_interval_seconds, reflection_interval_seconds,
			metadata, is_live
		) values (
			${mint}, ${opts.name}, ${opts.symbol}, ${opts.network || 'mainnet'},
			${opts['creator-wallet']}, ${opts['ops-wallet'] || null},
			${lottery_bps}, ${reflection_bps}, ${ops_bps},
			${draw_interval}, ${reflection_interval},
			${JSON.stringify(metadata)}::jsonb, false
		)
		on conflict (mint) do update set
			name = excluded.name,
			symbol = excluded.symbol,
			creator_wallet = excluded.creator_wallet,
			ops_wallet = excluded.ops_wallet,
			lottery_bps = excluded.lottery_bps,
			reflection_bps = excluded.reflection_bps,
			ops_bps = excluded.ops_bps,
			draw_interval_seconds = excluded.draw_interval_seconds,
			reflection_interval_seconds = excluded.reflection_interval_seconds,
			metadata = excluded.metadata,
			updated_at = now()
		returning id, mint, is_live, is_active
	`;
	const row = rows[0];
	console.log(JSON.stringify({
		coin_id: row.id,
		mint: row.mint,
		is_live: row.is_live,
		is_active: row.is_active,
		dashboard: `${process.env.PUBLIC_APP_ORIGIN || 'https://three.ws'}/coin/${row.mint}`,
		next_step: opts['creator-secret-b64']
			? `Run: node scripts/coin-cli.mjs activate ${mint} --enable  (after verifying the dry-run cron output)`
			: `Set COIN_CREATOR_SECRET_KEY_B64_${mint} in Vercel env, then activate with --enable.`,
	}, null, 2));
}

async function cmdActivate(positional, opts) {
	const [mint] = positional;
	if (!mint) throw new Error('Usage: activate <mint> --enable|--disable');
	const enable = !!opts.enable;
	const disable = !!opts.disable;
	if (enable === disable) throw new Error('exactly one of --enable / --disable required');
	const sql = await neonSql();
	const rows = await sql`
		update coin_launches set is_live = ${enable}, updated_at = now()
		where mint = ${mint}
		returning id, mint, is_live, is_active
	`;
	if (rows.length === 0) throw new Error(`no coin_launches row for mint ${mint}`);
	console.log(JSON.stringify(rows[0], null, 2));
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
	const { cmd, positional, opts } = parseArgs(process.argv);
	if (!cmd || cmd === 'help' || cmd === '--help') {
		console.error('three.ws coin-cli — lottery + reflection coin lifecycle');
		console.error('');
		console.error('  keygen [--out <path>]');
		console.error('  prepare <name> <symbol> [--description "..."] [--image <url>] [--website https://three.ws]');
		console.error('  launch <metadata-url> --wallet <buyer.json> --creator <creator.json> --name "..." --symbol "..."');
		console.error('                          [--buy <sol>] [--mint-keypair <path>] [--network mainnet|devnet] [--rpc <url>] [--execute]');
		console.error('  register <mint> --name "..." --symbol "..." --creator-wallet <pubkey>');
		console.error('                          [--creator-secret-b64 <b64>] [--lottery-bps 7000] [--reflection-bps 2500] [--ops-bps 500]');
		console.error('                          [--draw-interval-seconds 3600] [--ops-wallet <pubkey>] [--network mainnet|devnet]');
		console.error('  activate <mint> --enable|--disable');
		process.exit(cmd ? 1 : 0);
	}
	if (cmd === 'keygen') await cmdKeygen(opts);
	else if (cmd === 'prepare') await cmdPrepare(positional, opts);
	else if (cmd === 'launch') await cmdLaunch(positional, opts);
	else if (cmd === 'register') await cmdRegister(positional, opts);
	else if (cmd === 'activate') await cmdActivate(positional, opts);
	else throw new Error(`unknown subcommand: ${cmd}`);
}

main().catch((err) => {
	console.error('ERROR:', err.message);
	if (err.logs) for (const l of err.logs) console.error('  ', l);
	process.exit(1);
});
