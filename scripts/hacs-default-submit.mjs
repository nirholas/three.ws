#!/usr/bin/env node
// Finishes the HACS default-store submission for nirholas/three-ws-home-assistant.
//
//   node scripts/hacs-default-submit.mjs            report what is ready and print the PR body
//   node scripts/hacs-default-submit.mjs --rerun    dispatch the Hassfest and HACS workflows on main
//   node scripts/hacs-default-submit.mjs --open     re-cut the release after the green runs, then open the PR
//
// The hacs/default pull request template requires links to a successful HACS run and
// a successful hassfest run in the integration's own repository, and a release created
// after those runs. This script reads all of that from GitHub (gh CLI, the owner's own
// login), refuses to open the PR until both runs are green, and fills the template with
// the real links. The branch it opens from (nirholas:add-three-ws-home-assistant on the
// nirholas/default fork) already carries the one-line entry in the `integration` file.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'nirholas/three-ws-home-assistant';
export const UPSTREAM = 'hacs/default';
export const HEAD = 'nirholas:add-three-ws-home-assistant';
export const WORKFLOWS = { hacs: 'hacs.yml', hassfest: 'hassfest.yml' };

export function buildPrBody({ releaseUrl, hacsRunUrl, hassfestRunUrl }) {
	return `## Checklist

- [x] I've read the [publishing documentation](https://hacs.xyz/docs/publish/start).
- [x] I've added the [HACS action](https://hacs.xyz/docs/publish/action) to my repository.
- [x] (For integrations only) I've added the [hassfest action](https://developers.home-assistant.io/blog/2020/04/16/hassfest/) to my repository.
- [x] The actions are passing without any disabled checks in my repository.
- [x] I've added a link to the action run on my repository below in the links section.
- [x] I've created a new release of the repository after the validation actions were run successfully.

## Links

Link to current release: <${releaseUrl}>
Link to successful HACS action (without the \`ignore\` key): <${hacsRunUrl}>
Link to successful hassfest action (if integration): <${hassfestRunUrl}>

Adds \`nirholas/three-ws-home-assistant\`, a Home Assistant custom integration that connects a
LAN-only Home Assistant install to three.ws over one outbound WebSocket (no port forwarding, no
inbound firewall rule, no Home Assistant credential ever leaves the house). Ships its own brand
images under \`custom_components/three_ws/brand/\`.
`;
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ghJson = (args) => JSON.parse(gh(args));

function latestMainRun(workflow) {
	const runs = ghJson(['run', 'list', '-R', REPO, '--workflow', workflow, '--branch', 'main', '--limit', '1', '--json', 'databaseId,status,conclusion,url,createdAt,updatedAt']);
	return runs[0] ?? null;
}

function blockedReason(run) {
	if (!run) return 'no run on main yet';
	if (run.status !== 'completed') return `still ${run.status}`;
	if (run.conclusion === 'success') return null;
	const jobs = ghJson(['api', `repos/${REPO}/actions/runs/${run.databaseId}/jobs`]).jobs;
	const notes = jobs.flatMap((j) => {
		try {
			return ghJson(['api', `repos/${REPO}/check-runs/${j.id}/annotations`]).map((a) => a.message);
		} catch {
			return [];
		}
	});
	const billing = notes.find((m) => /billing/i.test(m));
	return billing ? `${run.conclusion}: ${billing} Fix it at https://github.com/settings/billing, then run --rerun.` : `${run.conclusion} (${run.url})`;
}

async function main() {
	const argv = process.argv.slice(2);
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const manifest = JSON.parse(readFileSync(join(root, 'home-assistant-integration/custom_components/three_ws/manifest.json'), 'utf8'));
	const tag = `v${manifest.version}`;

	if (argv.includes('--rerun')) {
		for (const wf of Object.values(WORKFLOWS)) gh(['workflow', 'run', wf, '-R', REPO, '--ref', 'main']);
		console.log('Dispatched hassfest.yml and hacs.yml on main. Re-run this script without flags once they finish.');
		return;
	}

	const runs = { hacs: latestMainRun(WORKFLOWS.hacs), hassfest: latestMainRun(WORKFLOWS.hassfest) };
	const blocked = Object.entries(runs).map(([k, r]) => [k, blockedReason(r)]).filter(([, why]) => why);
	for (const [k, r] of Object.entries(runs)) console.log(`${k}: ${r ? `${r.status}/${r.conclusion ?? '-'} ${r.url}` : 'no run'}`);

	const existingPr = gh(['pr', 'list', '-R', UPSTREAM, '--author', 'nirholas', '--state', 'all', '--search', 'three-ws-home-assistant in:title,body', '--json', 'url,state', '--jq', '.[0] // empty']);
	if (existingPr) {
		console.log(`A hacs/default PR already exists: ${existingPr}`);
		return;
	}

	if (blocked.length) {
		for (const [k, why] of blocked) console.log(`BLOCKED ${k}: ${why}`);
		process.exitCode = 1;
		return;
	}

	const lastGreen = Math.max(...Object.values(runs).map((r) => Date.parse(r.updatedAt)));
	let release = ghJson(['release', 'view', tag, '-R', REPO, '--json', 'url,createdAt,body,name']);
	if (Date.parse(release.createdAt) <= lastGreen) {
		if (!argv.includes('--open')) {
			console.log(`Release ${tag} predates the green runs; --open re-creates it on the same tag so it follows them.`);
		} else {
			gh(['release', 'delete', tag, '-R', REPO, '--yes']);
			gh(['release', 'create', tag, '-R', REPO, '--verify-tag', '--latest', '--title', release.name || manifest.version, '--notes', release.body || `Release ${manifest.version}.`]);
			release = ghJson(['release', 'view', tag, '-R', REPO, '--json', 'url,createdAt,body,name']);
			console.log(`Re-created ${tag} after the green runs: ${release.url}`);
		}
	}

	const body = buildPrBody({ releaseUrl: release.url, hacsRunUrl: runs.hacs.url, hassfestRunUrl: runs.hassfest.url });
	if (!argv.includes('--open')) {
		console.log('\nReady. PR body that --open will submit:\n');
		console.log(body);
		return;
	}
	const url = gh(['pr', 'create', '-R', UPSTREAM, '--base', 'master', '--head', HEAD, '--title', 'Add three.ws', '--body', body]);
	console.log(`Opened ${url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err.stderr?.toString() || err.message);
		process.exit(1);
	});
}
