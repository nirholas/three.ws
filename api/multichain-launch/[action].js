/**
 * Multichain launchpad: launch a coin off a 3D agent, an avatar, an animation,
 * or all three linked, on Solana (pump.fun), BNB Chain (four.meme, flap.sh),
 * Base (flap.sh) or Robinhood Chain (flap.sh), signed by one of the creator's
 * agent wallets or by their own wallet.
 *
 * Routes (vercel.json rewrites /api/multichain-launch/:action):
 *   GET  venues          chains and venues this launchpad supports (public)
 *   POST subject         create a launch subject; returns its /l/:id showcase
 *   GET  subject?id=     one subject's public view (public)
 *   GET  mine            the caller's launches
 *   GET  logo?subject=   the subject's default logo bytes, same-origin, so the
 *                        browser can hand them to four.meme's uploader
 *   POST quote           every fee, policy and funding check; signs nothing
 *   POST launch          agent-signed EVM launch (Idempotency-Key; follow
 *                        GET /api/launches/:id)
 *   POST prepare         wallet-signed EVM launch: verify wallet ownership and
 *                        return the transaction for the wallet to send
 *   POST confirm         wallet-signed EVM launch: verify the mined receipt and
 *                        list the coin
 *   POST four-meme-sign  sign four.meme's sign-in message with an agent key
 *   POST solana-link     link a pump.fun coin this account launched to a subject
 *
 * Solana launches themselves go through the existing pump.fun endpoints
 * (/api/pump/launch-prep, launch-confirm, launch-agent); this API links the
 * resulting mint to its subject. See docs/multichain-launchpad.md.
 */

import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer, isSameSiteOrigin, assertBearerMaySpend } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error, rateLimited, serverError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { EVM_LEG_CHAINS, EvmLegError, explorerAddress, explorerTx } from '../_lib/evm-leg/chains.js';
import { PairedMarketError } from '../_lib/paired-markets.js';
import { getLaunchRecord, readIdempotencyKey, runLaunch, publicRecord, settleLaunch } from '../_lib/evm-launch-records.js';
import { settlers } from '../_lib/evm-launch-settlers.js';
import { LIMITS } from '../_lib/evm-leg/paired-launch.js';
import { FLAP_TAX_OPTIONS_BPS } from '../_lib/evm-leg/flap-config.js';
import { FOUR_MEME_API, FOUR_MEME_LABELS } from '../_lib/evm-leg/four-meme-config.js';
import {
	VENUES, confirmWalletVenueLaunch, launchVenueCustodial, loadImageBytes, prepareWalletVenueLaunch, quoteVenueLaunch, quoteWalletVenueLaunch,
	resolveVenue, signFourMemeLogin, venueCoinUrl, verifyWalletOwnership, walletOwnershipMessage,
} from '../_lib/evm-leg/venue-launch.js';
import {
	SUBJECT_KINDS, SubjectError, createSubject, curatedAnimations, getOwnedSubject, getSubjectRow, linkSubjectRecord, listOwnedSubjects,
	markSubjectFailed, markSubjectLive, publicSubject, stageSubject, subjectImage,
} from '../_lib/launch-subjects.js';

/**
 * The public subject plus the links its showcase renders: the venue's coin
 * page and the explorer pages for the token and the launch transaction.
 */
async function subjectView(row) {
	const view = await publicSubject(row);
	if (!view) return view;
	const links = {};
	if (view.chain === 'solana') {
		if (view.token) {
			links.venue = `https://pump.fun/coin/${view.token}`;
			links.explorer_token = `https://solscan.io/token/${view.token}`;
		}
		if (view.tx_hash) links.explorer_tx = `https://solscan.io/tx/${view.tx_hash}`;
	} else if (EVM_LEG_CHAINS[view.chain]) {
		const chain = EVM_LEG_CHAINS[view.chain];
		if (view.token && view.venue && VENUES[view.venue]) links.venue = venueCoinUrl(view.venue, view.chain, view.token);
		if (view.token) links.explorer_token = explorerAddress(chain, view.token);
		if (view.tx_hash) links.explorer_tx = explorerTx(chain, view.tx_hash);
	}
	return { ...view, links };
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) {
		// launch and four-meme-sign sign with a platform-held key, so a cross-site
		// POST riding the session cookie must never reach them.
		if (req.method !== 'GET' && !isSameSiteOrigin(req)) {
			throw Object.assign(new Error('cross-site request blocked'), { status: 403, code: 'forbidden' });
		}
		return { userId: session.id };
	}
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req, { kind: 'trade' });
	if (bearer) return { userId: bearer.userId };
	return null;
}

const link = z.string().trim().max(LIMITS.link).optional();
const evmAddress = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, 'wallet must be a 0x address');
const venueId = z.enum(Object.keys(VENUES));
const chainSlug = z.enum(['bsc', 'base', 'robinhood']);

const coinSchema = z.object({
	subject_id: z.string().trim().min(6).max(16),
	venue: venueId,
	chain: chainSlug,
	name: z.string().trim().min(1).max(LIMITS.name),
	symbol: z.string().trim().min(1).max(LIMITS.symbol),
	description: z.string().trim().max(LIMITS.description).optional(),
	image_url: z.string().trim().max(LIMITS.image).optional(),
	socials: z.object({ website: link, twitter: link, telegram: link }).optional(),
	// Optional first buy off the curve, in the chain's gas coin (BNB or ETH).
	opening_buy: z.string().trim().max(24).optional(),
	// flap only: buy and sell tax in basis points.
	tax_bps: z.number().int().optional(),
	// four.meme only: category label, plus the signed launch four.meme returned.
	label: z.enum(FOUR_MEME_LABELS).optional(),
	four_meme: z.object({ create_arg: z.string().max(20_000), signature: z.string().max(1_000) }).optional(),
});

const agentCoinSchema = coinSchema.extend({ agent_id: z.string().uuid() });
const walletQuoteSchema = coinSchema.extend({ wallet: evmAddress });
const walletPrepareSchema = coinSchema.extend({ wallet: evmAddress, ownership_signature: z.string().trim().regex(/^0x[0-9a-fA-F]+$/).max(4_000) });
const quoteSchema = z.union([agentCoinSchema, walletQuoteSchema]);

const subjectSchema = z.object({
	kind: z.enum(SUBJECT_KINDS),
	agent_id: z.string().uuid().optional(),
	avatar_id: z.string().uuid().optional(),
	animation: z.string().trim().max(120).optional(),
});

const confirmSchema = z.object({ subject_id: z.string().trim().min(6).max(16), tx_hash: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/) });
const signSchema = z.object({ agent_id: z.string().uuid(), message: z.string().max(200) });
const solanaLinkSchema = z.object({
	subject_id: z.string().trim().min(6).max(16),
	mint: z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'mint must be a Solana address'),
	signer: z.enum(['agent', 'wallet']),
});

function failure(res, err) {
	if (err instanceof PairedMarketError || err instanceof EvmLegError || err instanceof SubjectError || (err?.status && err?.code && err.status < 500) || err?.expose) {
		return error(res, err.status || 400, err.code || 'bad_request', err.message, err.detail ? { detail: err.detail } : {});
	}
	return serverError(res, 500, 'internal', err);
}

async function parse(schema, req) {
	try {
		return schema.parse(await readJson(req));
	} catch (e) {
		throw Object.assign(new Error(e.errors?.[0]?.message || 'invalid body'), { status: 400, code: 'validation_error' });
	}
}

/** 201 for a new finished launch, 200 for a replayed one, 202 while it is still in flight. */
function respondLaunch(res, { record, replayed }) {
	if (replayed) res.setHeader('idempotent-replay', 'true');
	res.setHeader('location', `/api/launches/${record.id}`);
	const launch = publicRecord(record);
	if (record.status === 'failed') {
		return error(res, 409, record.error?.code || 'launch_failed', record.error?.message || 'the launch failed', { launch });
	}
	if (record.status !== 'finalized') return json(res, 202, { data: { launch_id: record.id, status: record.status, launch } });
	return json(res, replayed ? 200 : 201, { data: { ...record.result, launch_id: record.id, launch } });
}

function venuesView() {
	return {
		chains: [
			{
				id: 'solana', name: 'Solana', home: true, gas: 'SOL',
				venues: [{ id: 'pump', label: 'pump.fun', signers: ['agent', 'wallet'], url: 'https://pump.fun' }],
			},
			...['bsc', 'base', 'robinhood'].map((slug) => {
				const c = EVM_LEG_CHAINS[slug];
				return {
					id: slug, name: c.name, chain_id: c.chainId, gas: c.viemChain.nativeCurrency.symbol,
					wallet_params: {
						chainName: c.viemChain.name,
						nativeCurrency: c.viemChain.nativeCurrency,
						rpcUrls: c.viemChain.rpcUrls.default.http.slice(0, 1),
						blockExplorerUrls: c.viemChain.blockExplorers?.default?.url ? [c.viemChain.blockExplorers.default.url] : [],
					},
					venues: Object.values(VENUES).filter((v) => v.chains.includes(slug)).map((v) => ({
						id: v.id, label: v.label, signers: ['agent', 'wallet'],
						...(v.id === 'flap' ? { tax_options_bps: FLAP_TAX_OPTIONS_BPS } : { labels: FOUR_MEME_LABELS, api: FOUR_MEME_API }),
					})),
					...(slug === 'base' ? { also: [{ id: 'uniswap', label: 'Uniswap V3 pool', href: '/launch/uniswap' }] } : {}),
					...(slug === 'robinhood' || slug === 'base' ? { paired: { label: 'Paired market', href: '/launch' } } : {}),
				};
			}),
		],
		subject_kinds: SUBJECT_KINDS,
	};
}

async function ownedSubjectFor(body, userId) {
	const subject = await getOwnedSubject(body.subject_id, userId);
	if (subject.status === 'live') throw new SubjectError('subject_launched', 'This launch already went out. Start a new one for another coin.', 409);
	return subject;
}

async function handlePost(req, res, action, auth) {
	const { userId } = auth;
	if (action === 'subject') {
		const body = await parse(subjectSchema, req);
		const row = await createSubject({ userId, input: body });
		return json(res, 201, { data: await subjectView(row) });
	}

	if (action === 'quote') {
		const body = await parse(quoteSchema, req);
		const subject = await ownedSubjectFor(body, userId);
		const data = body.agent_id
			? await quoteVenueLaunch({ agentId: body.agent_id, userId, input: body, subject })
			: await quoteWalletVenueLaunch({ input: body, wallet: body.wallet, subject });
		if (!body.agent_id) data.ownership_message = walletOwnershipMessage({ subjectId: subject.id, address: body.wallet, chain: body.chain });
		return json(res, 200, { data });
	}

	if (action === 'launch') {
		const body = await parse(agentCoinSchema, req);
		const subject = await ownedSubjectFor(body, userId);
		resolveVenue(body.venue, body.chain);
		if (!(await requireRealFundsAgreement(req, res, { userId, network: 'mainnet', context: 'multichain-launch' }))) return;
		const key = readIdempotencyKey(req);
		await stageSubject(subject.id, {
			chain: body.chain, venue: body.venue, signer: 'agent', signerAgentId: body.agent_id,
			name: body.name, symbol: body.symbol, imageUrl: body.image_url || null, description: body.description || null,
		});
		try {
			const run = await runLaunch({
				lane: body.venue,
				chain: body.chain,
				userId,
				agentId: body.agent_id,
				key,
				body,
				execute: async ({ record, stage }) => {
					await linkSubjectRecord(subject.id, record.id);
					return launchVenueCustodial({ agentId: body.agent_id, userId, input: body, subject, req, stage });
				},
			});
			if (run.record.status === 'failed') await markSubjectFailed(subject.id);
			return respondLaunch(res, run);
		} catch (err) {
			if (!err?.launchId || err?.code === 'launch_blocked' || err?.code === 'send_failed' || err?.code === 'launch_reverted') await markSubjectFailed(subject.id);
			throw err;
		}
	}

	if (action === 'prepare') {
		const body = await parse(walletPrepareSchema, req);
		const subject = await ownedSubjectFor(body, userId);
		resolveVenue(body.venue, body.chain);
		const owns = await verifyWalletOwnership({ subjectId: subject.id, address: body.wallet, chain: body.chain, signature: body.ownership_signature });
		if (!owns) return error(res, 401, 'wallet_unverified', 'The wallet signature does not match. Sign the three.ws launch message with the wallet you launch from.');
		const data = await prepareWalletVenueLaunch({ input: body, wallet: body.wallet, subject });
		await stageSubject(subject.id, {
			chain: body.chain, venue: body.venue, signer: 'wallet', creatorAddress: data.wallet.address,
			name: data.coin.name, symbol: data.coin.symbol, imageUrl: data.coin.image_url, description: data.coin.description,
			prepared: data.prepared,
		});
		return json(res, 200, { data });
	}

	if (action === 'confirm') {
		const body = await parse(confirmSchema, req);
		const subject = await getOwnedSubject(body.subject_id, userId);
		const data = await confirmWalletVenueLaunch({ subject, txHash: body.tx_hash, userId });
		return json(res, data.already ? 200 : 201, { data });
	}

	if (action === 'four-meme-sign') {
		const body = await parse(signSchema, req);
		return json(res, 200, { data: await signFourMemeLogin({ agentId: body.agent_id, userId, message: body.message }) });
	}

	if (action === 'solana-link') {
		const body = await parse(solanaLinkSchema, req);
		const subject = await getOwnedSubject(body.subject_id, userId);
		const [mint] = await sql`
			SELECT agent_id, name, symbol, mint, metadata_uri FROM pump_agent_mints
			WHERE mint = ${body.mint} AND network = 'mainnet' AND user_id = ${userId} LIMIT 1
		`;
		if (!mint) return error(res, 404, 'mint_not_found', 'That pump.fun coin was not launched from this account.');
		if (subject.status === 'live' && subject.token !== body.mint) return error(res, 409, 'subject_launched', 'This launch is already linked to another coin.');
		if (subject.status !== 'live') {
			await stageSubject(subject.id, {
				chain: 'solana', venue: 'pump', signer: body.signer, signerAgentId: mint.agent_id,
				name: mint.name, symbol: mint.symbol, imageUrl: await subjectImage(subject), status: 'submitted',
			});
		}
		const row = await markSubjectLive(subject.id, { token: body.mint, txHash: null });
		return json(res, 200, { data: await subjectView(row) });
	}

	return error(res, 404, 'not_found', 'unknown launchpad action');
}

async function handleGet(req, res, action) {
	const url = new URL(req.url, 'http://x');
	if (action === 'venues') {
		res.setHeader('cache-control', 'public, max-age=300');
		const clips = await curatedAnimations();
		return json(res, 200, { data: { ...venuesView(), animations: [...clips.values()].map((c) => ({ id: c.id, label: c.label, icon: c.icon })) } });
	}
	if (action === 'subject') {
		let row = await getSubjectRow(url.searchParams.get('id') || '');
		if (!row) return error(res, 404, 'subject_not_found', 'That launch does not exist.');
		// An agent-signed launch goes live when its record settles. The creator
		// may have closed the launchpad, so the showcase settles it too.
		if (row.status === 'submitted' && row.launch_record_id) {
			const record = await getLaunchRecord(row.launch_record_id, row.user_id);
			if (record) {
				await settleLaunch(record, settlers);
				row = (await getSubjectRow(row.id)) || row;
			}
		}
		res.setHeader('cache-control', row.status === 'live' ? 'public, max-age=60' : 'no-store');
		return json(res, 200, { data: await subjectView(row) });
	}
	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or send an API key');
	if (action === 'mine') {
		const rows = await listOwnedSubjects(auth.userId, { limit: url.searchParams.get('limit') });
		return json(res, 200, { data: await Promise.all(rows.map(subjectView)) });
	}
	if (action === 'logo') {
		const subject = await getOwnedSubject(url.searchParams.get('subject') || '', auth.userId);
		const custom = url.searchParams.get('url');
		const source = custom && /^https:\/\//.test(custom) ? custom : await subjectImage(subject);
		const img = await loadImageBytes(source);
		res.setHeader('content-type', img.contentType);
		res.setHeader('cache-control', 'private, max-age=300');
		res.statusCode = 200;
		res.end(img.bytes);
		return;
	}
	return error(res, 404, 'not_found', 'unknown launchpad action');
}

const ACTIONS = new Set(['venues', 'subject', 'mine', 'logo', 'quote', 'launch', 'prepare', 'confirm', 'four-meme-sign', 'solana-link']);

export default wrap(async (req, res) => {
	const action = req.query?.action;
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!ACTIONS.has(action)) return error(res, 404, 'not_found', 'unknown launchpad action');
	if (!method(req, res, ['GET', 'POST'])) return;
	const rl = req.method === 'GET' ? await limits.authedReadIp(clientIp(req)) : await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	try {
		if (req.method === 'GET') return await handleGet(req, res, action);
		const auth = await resolveAuth(req);
		if (!auth) return error(res, 401, 'unauthorized', 'sign in or send an API key');
		return await handlePost(req, res, action, auth);
	} catch (err) {
		if (!(err instanceof PairedMarketError) && !(err instanceof EvmLegError) && !(err instanceof SubjectError) && !(err?.status < 500)) {
			console.error(`[multichain-launch/${action}]`, err);
		}
		if (err?.launchId) res.setHeader('location', `/api/launches/${err.launchId}`);
		return failure(res, err);
	}
});

