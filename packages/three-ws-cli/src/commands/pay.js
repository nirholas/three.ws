// `three-ws pay <url>`: settle an x402 or MPP challenge from a locally held
// Solana key, inside the limits of ~/.config/three-ws/pay-permissions.json.
//   pay <url> [--max <amount>] [--network <net>] [--dry-run] [--yes] [--json]
//   pay init          write a conservative permissions file
//   pay permissions   show the active policy and where it lives
//   pay mcp           stdio MCP server exposing pay_fetch and pay_quote

import * as p from '@clack/prompts';
import { c, errorLine, line, printJson, rows, sym, tildify } from '../ui.js';
import { createKeystore } from '../pay/keystore.js';
import { EXIT, PayError } from '../pay/errors.js';
import { pay, quote } from '../pay/engine.js';
import { describeOffer, initPermissions, loadPermissions, permissionsPath } from '../pay/permissions.js';
import { answer } from './common.js';
import { isNonInteractive } from '../automation.js';

const interactive = (ctx) => Boolean(process.stdin.isTTY && process.stderr.isTTY && !ctx.flags.json && !isNonInteractive(ctx.flags, ctx.env));

export function keystoreFor(ctx) {
	return createKeystore({
		env: ctx.env,
		askPassphrase: interactive(ctx) ? async (question) => answer(await p.password({ message: question })) : undefined,
	});
}

function requestFrom(flags) {
	const headers = {};
	for (const h of flags.header ?? []) {
		const i = h.indexOf(':');
		if (i < 1) throw new PayError(EXIT.USAGE, 'invalid_header', `--header "${h}" must look like "Name: value".`);
		headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
	}
	return { method: flags.method?.toUpperCase(), body: flags.data, headers };
}

function offerRows(offer, extra = []) {
	rows([
		['protocol', offer.protocol === 'x402' ? 'x402' : 'MPP'],
		['network', offer.network],
		['amount', `${offer.amount} (${offer.amountAtomic} atomic)`],
		['asset', offer.asset],
		['payee', offer.payTo],
		...extra,
	]);
}

async function dryRun(ctx, url) {
	const q = await quote({ url, env: ctx.env, request: requestFrom(ctx.flags), maxFlag: ctx.flags.max, networkFlag: ctx.flags.network });
	if (q.free) {
		if (ctx.flags.json) printJson({ dryRun: true, paymentRequired: false, status: q.response.status, url });
		else line(`${c.dim(sym.dot)} ${url} did not ask for payment (HTTP ${q.response.status}). Nothing would be paid.`);
		return EXIT.OK;
	}
	const chosen = describeOffer(q.decision.offer);
	if (ctx.flags.json) {
		printJson({ dryRun: true, paymentRequired: true, url, decision: 'allowed', needsConfirmation: q.decision.confirm, chosen, offers: q.offers, skipped: q.decision.skipped });
		return EXIT.OK;
	}
	line(`${c.bold('Dry run')}: nothing was signed or sent.`);
	offerRows(chosen, [['decision', q.decision.confirm ? 'allowed, asks for confirmation (above confirmAbove)' : 'allowed by pay-permissions.json']]);
	for (const s of q.decision.skipped) line(`${c.dim(sym.dot)} skipped ${s.offer.protocol} ${s.offer.network}: ${s.message}`);
	return EXIT.OK;
}

async function settle(ctx, url) {
	const confirm = interactive(ctx)
		? async (s) => answer(await p.confirm({ message: `Pay ${s.amount} to ${s.payTo} on ${s.network} for ${s.url}?` }))
		: undefined;
	const result = await pay({
		url,
		env: ctx.env,
		request: requestFrom(ctx.flags),
		maxFlag: ctx.flags.max,
		networkFlag: ctx.flags.network,
		assumeYes: Boolean(ctx.flags.yes),
		confirm,
		keystore: keystoreFor(ctx),
	});
	if (ctx.flags.json) {
		const isText = /^(text\/|application\/(json|xml)|[\w.+-]*\/[\w.+-]*\+(json|xml))/i.test(result.contentType);
		printJson({
			paid: result.paid,
			status: result.status,
			protocol: result.protocol,
			payer: result.payer,
			offer: result.offer,
			receipt: result.receipt,
			contentType: result.contentType,
			...(isText ? { body: result.bytes.toString('utf8') } : { bodyBase64: result.bytes.toString('base64') }),
		});
	} else {
		if (result.paid) {
			const tx = result.receipt?.transaction ?? result.receipt?.reference;
			process.stderr.write(`${c.green(sym.ok)} paid ${result.offer.amount} to ${result.offer.payTo} (${result.protocol}, ${result.offer.network})${tx ? ` tx ${tx}` : ''}\n`);
		} else {
			process.stderr.write(`${c.dim(sym.dot)} no payment requested (HTTP ${result.status})\n`);
		}
		process.stdout.write(result.bytes);
		if (result.bytes.length && result.bytes[result.bytes.length - 1] !== 0x0a && process.stdout.isTTY) process.stdout.write('\n');
	}
	return result.status >= 400 ? EXIT.ERROR : EXIT.OK;
}

function showPermissions(ctx) {
	const file = permissionsPath(ctx.env);
	const perms = loadPermissions(ctx.env);
	if (ctx.flags.json) printJson({ path: file, permissions: perms });
	else {
		line(`${c.bold('Permissions')} ${c.dim(tildify(file))}`);
		line(JSON.stringify(perms, null, 2));
	}
	return EXIT.OK;
}

function initFile(ctx) {
	const file = initPermissions(ctx.env);
	if (ctx.flags.json) printJson({ path: permissionsPath(ctx.env), created: Boolean(file) });
	else if (file) line(`${c.green(sym.ok)} Wrote ${tildify(file)}: https://three.ws only, Solana mainnet USDC, 0.10 per call, 1.00 per day, confirm above 0.05. Edit it to widen or narrow.`);
	else line(`${c.dim(sym.dot)} ${tildify(permissionsPath(ctx.env))} already exists; left unchanged.`);
	return EXIT.OK;
}

export async function payCommand(ctx) {
	const [first, ...rest] = ctx.positionals;
	if (!first) {
		errorLine('usage: three-ws pay <url> [--max <amount>] [--network <net>] [--dry-run]   |   pay init   |   pay permissions   |   pay mcp');
		return EXIT.USAGE;
	}
	if (first === 'init') return initFile(ctx);
	if (first === 'permissions') return showPermissions(ctx);
	if (first === 'mcp') {
		const { runPayMcp } = await import('../pay/mcp-server.js');
		await runPayMcp({ env: ctx.env, keystore: keystoreFor({ ...ctx, flags: { ...ctx.flags, json: true } }) });
		return EXIT.OK;
	}
	if (rest.length) {
		errorLine(`unexpected argument "${rest[0]}". Quote URLs that contain & or ?.`);
		return EXIT.USAGE;
	}
	return ctx.flags['dry-run'] ? dryRun(ctx, first) : settle(ctx, first);
}
