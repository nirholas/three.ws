import { maxSeverity } from '@three-ws/glb-diff';

export const COMMENT_MARKER = '<!-- three-ws-glb-quality-gate -->';
export const SEVERITIES = ['none', 'cosmetic', 'minor', 'major', 'breaking'];

export function validateFailOn(value) {
	const normalized = String(value || '').trim().toLowerCase();
	if (!SEVERITIES.includes(normalized)) {
		throw new Error(`fail-on must be one of: ${SEVERITIES.join(', ')}`);
	}
	return normalized;
}

export function validateMaxFiles(value) {
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		throw new Error('max-files must be an integer from 1 to 100');
	}
	return parsed;
}

export function selectGlbChanges(files, maxFiles) {
	const changes = files
		.filter((file) => file.filename.toLowerCase().endsWith('.glb'))
		.map((file) => ({
			path: file.filename,
			basePath: file.status === 'renamed' ? file.previous_filename : file.filename,
			status: file.status,
		}));
	return { changes: changes.slice(0, maxFiles), omitted: Math.max(0, changes.length - maxFiles) };
}

export function severityForStatus(status) {
	if (status === 'removed') return 'breaking';
	if (status === 'added') return 'minor';
	return 'none';
}

export function aggregateSeverity(results) {
	return maxSeverity(results.map((result) => result.severity));
}

function safeCode(value) {
	return `\`${String(value).replaceAll('`', 'ˋ').replaceAll('|', '\\|')}\``;
}

function icon(severity) {
	return {
		none: '✅',
		cosmetic: '🟦',
		minor: '🟨',
		major: '🟧',
		breaking: '🛑',
	}[severity];
}

export function buildReport({ results, omitted = 0, failOn }) {
	const severity = aggregateSeverity(results);
	const summary = results.length
		? `Reviewed **${results.length}** changed GLB file${results.length === 1 ? '' : 's'}. Highest severity: **${severity}**.`
		: 'No changed GLB files were found in this pull request.';
	const rows = results.map(
		(result) => `| ${icon(result.severity)} ${safeCode(result.path)} | **${result.severity}** | ${result.outcome} |`,
	);
	const details = results
		.filter((result) => result.markdown)
		.map(
			(result) =>
				`<details>\n<summary>${icon(result.severity)} ${safeCode(result.path)} details</summary>\n\n${result.markdown}\n\n</details>`,
		)
		.join('\n\n');
	const omittedNote = omitted
		? `\n\n> ${omitted} additional GLB file${omitted === 1 ? ' was' : 's were'} omitted by the configured limit.`
		: '';

	return [
		COMMENT_MARKER,
		'## three.ws GLB Quality Gate',
		'',
		summary,
		'',
		'| File | Severity | Result |',
		'| --- | --- | --- |',
		...(rows.length ? rows : ['| No GLB changes | **none** | Nothing to review |']),
		omittedNote,
		details ? `\n${details}` : '',
		'',
		`Gate threshold: **${failOn}**. [Inspect models visually](https://three.ws/diff) or [use the CLI](https://www.npmjs.com/package/@three-ws/glb-diff).`,
	].join('\n');
}
