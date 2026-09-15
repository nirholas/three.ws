import * as core from '@actions/core';
import * as github from '@actions/github';
import { atLeast, diffModels, formatMarkdown } from '@three-ws/glb-diff';
import {
	COMMENT_MARKER,
	aggregateSeverity,
	buildReport,
	selectGlbChanges,
	severityForStatus,
	validateFailOn,
	validateMaxFiles,
} from './report.js';

function requirePullRequest() {
	const pull = github.context.payload.pull_request;
	if (!pull) throw new Error('three.ws GLB Quality Gate runs on pull_request events');
	return pull;
}

function encodedPath(path) {
	return path.split('/').map(encodeURIComponent).join('/');
}

async function fetchFile({ owner, repo, path, ref, token }) {
	const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(ref)}`;
	const response = await fetch(url, {
		headers: {
			accept: 'application/vnd.github.raw',
			authorization: `Bearer ${token}`,
			'user-agent': 'three-ws-glb-quality-gate',
			'x-github-api-version': '2022-11-28',
		},
	});
	if (!response.ok) throw new Error(`GitHub could not read ${path} at ${ref.slice(0, 8)} (${response.status})`);
	return new Uint8Array(await response.arrayBuffer());
}

async function inspectChange(change, context) {
	if (change.status === 'added') {
		return { ...change, severity: severityForStatus(change.status), outcome: 'New model added', markdown: '' };
	}
	if (change.status === 'removed') {
		return { ...change, severity: severityForStatus(change.status), outcome: 'Model removed', markdown: '' };
	}

	const [before, after] = await Promise.all([
		fetchFile({ ...context, path: change.basePath, ref: context.baseRef }),
		fetchFile({ ...context, path: change.path, ref: context.headRef }),
	]);
	const changes = await diffModels(before, after, { nameA: change.basePath, nameB: change.path });
	return {
		...change,
		severity: changes.severity,
		outcome: changes.identical ? 'Structurally identical' : `${changes.summary.changed} structural changes`,
		markdown: formatMarkdown(changes),
	};
}

async function writeOrUpdateComment(octokit, owner, repo, issueNumber, body) {
	try {
		const comments = await octokit.paginate(octokit.rest.issues.listComments, {
			owner,
			repo,
			issue_number: issueNumber,
			per_page: 100,
		});
		const previous = comments.find(
			(comment) => comment.user?.type === 'Bot' && String(comment.body).includes(COMMENT_MARKER),
		);
		if (previous) {
			await octokit.rest.issues.updateComment({ owner, repo, comment_id: previous.id, body });
		} else {
			await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
		}
	} catch (error) {
		core.warning(`The report could not be written as a pull request comment: ${error.message}`);
	}
}

async function run() {
	const pull = requirePullRequest();
	const token = core.getInput('github-token', { required: true });
	const failOn = validateFailOn(core.getInput('fail-on'));
	const maxFiles = validateMaxFiles(core.getInput('max-files'));
	const { owner, repo } = github.context.repo;
	const octokit = github.getOctokit(token);
	const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
		owner,
		repo,
		pull_number: pull.number,
		per_page: 100,
	});
	const selected = selectGlbChanges(files, maxFiles);
	const context = { owner, repo, token, baseRef: pull.base.sha, headRef: pull.head.sha };
	const results = [];
	for (const change of selected.changes) results.push(await inspectChange(change, context));

	const severity = aggregateSeverity(results);
	const report = buildReport({ results, omitted: selected.omitted, failOn });
	core.setOutput('severity', severity);
	core.setOutput('files-checked', results.length);
	await core.summary.addRaw(report).write();
	await writeOrUpdateComment(octokit, owner, repo, pull.number, report);

	if (results.length && atLeast(severity, failOn)) {
		core.setFailed(`GLB changes reached ${severity}, which meets the ${failOn} failure threshold`);
	}
}

run().catch((error) => core.setFailed(error instanceof Error ? error.message : String(error)));
