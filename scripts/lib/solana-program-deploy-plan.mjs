// Pure planning logic for scripts/deploy-solana-programs.mjs. No I/O besides the
// injected readers, so tests/solana-program-deploy-plan.test.js covers every gate
// without a toolchain, a keypair or a network.

export const PROGRAMS = [
	{ name: 'skill_license', dir: 'contracts/skill-license' },
	{ name: 'agent_invocation', dir: 'contracts/agent-invocation' },
	{ name: 'knock_escrow', dir: 'contracts/knock-escrow' },
	{ name: 'event_markets_stake', dir: 'contracts/event-markets-stake' },
];

export const CLUSTERS = {
	devnet: { url: 'https://api.devnet.solana.com', mainnet: false },
	'mainnet-beta': { url: 'https://api.mainnet-beta.solana.com', mainnet: true },
};

const BPF_LOADER_UPGRADEABLE_HEADER = 45;
const LAMPORTS_PER_BYTE_YEAR = 3480;
const ACCOUNT_STORAGE_OVERHEAD = 128;
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Rent-exempt minimum for an account holding `bytes` of data. */
export function rentExempt(bytes) {
	return (bytes + ACCOUNT_STORAGE_OVERHEAD) * LAMPORTS_PER_BYTE_YEAR * 2;
}

/** SOL locked by deploying an upgradeable program with `maxLen` bytes of room:
 *  the ProgramData account plus the 36 byte Program account. */
export function deployCostLamports(maxLen) {
	return rentExempt(BPF_LOADER_UPGRADEABLE_HEADER + maxLen) + rentExempt(36);
}

export function parseDeclaredId(librs) {
	const m = /declare_id!\(\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"\s*\)/.exec(librs);
	return m ? m[1] : null;
}

export function parseArgs(argv) {
	const out = { cluster: 'devnet', yes: false, confirmMainnet: false, only: null, keypair: null, newAuthority: null, command: 'deploy', maxLenFactor: 2 };
	const rest = [...argv];
	if (rest[0] && !rest[0].startsWith('--')) out.command = rest.shift();
	while (rest.length) {
		const a = rest.shift();
		const val = () => {
			const v = rest.shift();
			if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
			return v;
		};
		if (a === '--cluster') out.cluster = val();
		else if (a === '--yes') out.yes = true;
		else if (a === '--confirm-mainnet') out.confirmMainnet = true;
		else if (a === '--only') out.only = val().split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--keypair') out.keypair = val();
		else if (a === '--new-authority') out.newAuthority = val();
		else if (a === '--max-len-factor') out.maxLenFactor = Number(val());
		else throw new Error(`unknown argument ${a}`);
	}
	return out;
}

/**
 * Validate the request and build the per-program rows. Throws on anything that
 * must not proceed. `read` supplies the filesystem and keytool facts:
 *   declaredId(dir) -> string|null, keypairPubkey(dir, name) -> string|null,
 *   soSize(dir, name) -> number|null
 */
export function buildPlan(args, read) {
	if (!['deploy', 'set-upgrade-authority'].includes(args.command)) throw new Error(`unknown command ${args.command}`);
	const cluster = CLUSTERS[args.cluster];
	if (!cluster) throw new Error(`unknown cluster ${args.cluster}; use devnet or mainnet-beta`);
	if (!(args.maxLenFactor >= 1 && args.maxLenFactor <= 4)) throw new Error('--max-len-factor must be between 1 and 4');
	if (args.command === 'set-upgrade-authority' && !args.newAuthority) throw new Error('set-upgrade-authority needs --new-authority <pubkey>');
	if (cluster.mainnet && !args.keypair) throw new Error('mainnet needs an explicit --keypair for the fee payer and upgrade authority');

	const wanted = args.only ? PROGRAMS.filter((p) => args.only.includes(p.name)) : PROGRAMS;
	if (args.only) {
		const unknown = args.only.filter((n) => !PROGRAMS.some((p) => p.name === n));
		if (unknown.length) throw new Error(`unknown program ${unknown.join(', ')}`);
	}

	const rows = wanted.map((p) => {
		const declared = read.declaredId(p.dir);
		if (!declared) throw new Error(`${p.name}: no declare_id! in ${p.dir}/src/lib.rs`);
		const kp = read.keypairPubkey(p.dir, p.name);
		if (args.command === 'deploy') {
			if (!kp) throw new Error(`${p.name}: program keypair missing in ${p.dir}/.deploy`);
			if (kp !== declared) throw new Error(`${p.name}: keypair ${kp} does not match declare_id! ${declared}; regenerate and update every reference`);
		}
		const size = read.soSize(p.dir, p.name);
		if (args.command === 'deploy' && !size) throw new Error(`${p.name}: ${p.dir}/target/deploy/${p.name}.so missing; run cargo-build-sbf`);
		const maxLen = size ? Math.ceil(size * args.maxLenFactor) : 0;
		return { ...p, id: declared, soBytes: size || 0, maxLen, lamports: size ? deployCostLamports(maxLen) : 0 };
	});
	const totalLamports = rows.reduce((s, r) => s + r.lamports, 0);
	return { cluster: args.cluster, url: cluster.url, mainnet: cluster.mainnet, command: args.command, rows, totalLamports };
}

/** Decide whether the plan may execute. */
export function gate(plan, args) {
	if (!args.yes) return { run: false, reason: 'dry run: pass --yes to execute' };
	if (plan.mainnet && !args.confirmMainnet) return { run: false, reason: 'mainnet also needs --confirm-mainnet' };
	return { run: true, reason: '' };
}

export function renderTable(plan) {
	const sol = (l) => (l / LAMPORTS_PER_SOL).toFixed(4);
	const lines = [`cluster: ${plan.cluster} (${plan.url})`, `action:  ${plan.command}`, ''];
	lines.push(['program'.padEnd(22), 'program id'.padEnd(46), 'so bytes'.padStart(9), 'rent SOL'.padStart(9)].join(' '));
	for (const r of plan.rows) {
		lines.push([r.name.padEnd(22), r.id.padEnd(46), String(r.soBytes).padStart(9), sol(r.lamports).padStart(9)].join(' '));
	}
	if (plan.command === 'deploy') lines.push('', `total rent locked: ${sol(plan.totalLamports)} SOL (recoverable by closing the program)`);
	return lines.join('\n');
}
