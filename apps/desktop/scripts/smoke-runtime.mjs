// Headless smoke test for the local agent runtime. Starts the real runtime in a
// temp directory (no Electron), points a paper-mode strategy at the live
// pump.fun launch feed, runs one scheduler pass and prints what it did.
// Nothing is signed and no funds move. Exit 0 on pass, 1 on fail.
//
//   npm run smoke:runtime

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalRuntime } from '../src/runtime/index.js';

const dir = mkdtempSync(join(tmpdir(), 'three-ws-runtime-smoke-'));
const events = [];
const { runtime, keystore, log } = createLocalRuntime({ dir, safeStorage: null, onEvent: (e) => events.push(e.type) });
const failures = [];
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
	if (!ok) failures.push(name);
};

try {
	const agent = runtime.createAgent({
		name: 'smoke-paper',
		mode: 'paper',
		strategy: { mode: 'auto', entry: { max_age_minutes: 10080, require_socials: false }, sizing: { amount_sol: 0.05, max_slippage_bps: 1500 }, exits: { take_profit_pct: 50, stop_loss_pct: 30 }, risk: { max_concurrent_positions: 2, cooldown_minutes: 0 } },
	});
	check('agent created with a keychain-store address', Boolean(agent.address) && keystore.address(agent.id) === agent.address, agent.address);

	await runtime.tick();

	const after = runtime.getAgent(agent.id);
	const receipts = runtime.receipts({ agentId: agent.id });
	const positions = runtime.positions({ agentId: agent.id });
	check('scheduler pass finished without error', after.status === 'idle', after.status + (after.detail ? ` (${after.detail})` : ''));
	check('paper buy filled from live feed data', receipts.some((r) => r.kind === 'buy' && r.mode === 'paper' && r.tokens > 0 && r.signature === null), `${receipts.length} receipt(s)`);
	check('position opened', positions.some((p) => p.status === 'open'), `${positions.length} position(s)`);
	check('status events emitted', events.includes('status') && events.includes('receipt'));

	runtime.pause(agent.id);
	check('pause holds the agent', runtime.getAgent(agent.id).status === 'paused');
	runtime.kill(agent.id);
	check('kill is final', runtime.getAgent(agent.id).status === 'killed');

	const logText = existsSync(join(dir, 'runtime.log')) ? readFileSync(join(dir, 'runtime.log'), 'utf8') : '';
	const secret = JSON.stringify(Array.from({ length: 64 }, () => 1));
	log.info('probe', { secretKey: [...Array(64).keys()], note: secret });
	const logAfter = readFileSync(join(dir, 'runtime.log'), 'utf8');
	check('log carries no key material', !/"secretKey":\[/.test(logAfter) && !logAfter.includes('[0,1,2,3,4,5'), `${logText.length} bytes before probe`);
} catch (err) {
	console.log(`FAIL smoke threw: ${err.stack || err}`);
	failures.push('threw');
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
	console.log(`\nsmoke failed: ${failures.join(', ')}`);
	process.exit(1);
}
console.log('\nsmoke passed');
