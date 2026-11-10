import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	serviceNameFromCloudbuild,
	readmeClaim,
	indexServices,
	buildRows,
	checkExitCode,
	renderTable,
	renderMarkdown,
	shipCommand,
} from '../scripts/workers-fleet-status.mjs';

const cb = (w) => readFileSync(`workers/${w}/cloudbuild.yaml`, 'utf8');
const services = indexServices(JSON.parse(readFileSync('tests/fixtures/run-services-list.json', 'utf8')));
const worker = (over) => ({ dir: 'x', service: null, claim: null, hasDockerfile: true, hasCloudbuild: true, hasVerify: false, hasTests: false, ...over });

describe('serviceNameFromCloudbuild (real worker configs)', () => {
	it('reads the _SERVICE substitution', () => {
		expect(serviceNameFromCloudbuild(cb('rig'))).toBe('model-rig');
		expect(serviceNameFromCloudbuild(cb('rembg'))).toBe('rembg-service');
		expect(serviceNameFromCloudbuild(cb('cad-forge'))).toBe('cad-forge');
	});
	it('reads an inline run deploy / services update', () => {
		expect(serviceNameFromCloudbuild(cb('agent-sniper'))).toBe('agent-sniper');
		expect(serviceNameFromCloudbuild(cb('robinhood-feed'))).toBe('robinhood-feed');
		expect(serviceNameFromCloudbuild(cb('modly'))).toBe('model-modly');
	});
	it('returns null for empty input', () => {
		expect(serviceNameFromCloudbuild(null)).toBeNull();
		expect(serviceNameFromCloudbuild('steps: []')).toBeNull();
	});
});

describe('readmeClaim', () => {
	it('detects a bold not-deployed status', () => {
		expect(readmeClaim('**Not currently deployed.** No service.', 'agent-mm')).toBe('undeployed');
		expect(readmeClaim('**Status (2026-11-04): ship-ready, not deployed.**', 'agent-gateway')).toBe('undeployed');
	});
	it('detects a deployed status', () => {
		expect(readmeClaim('**Status: redeployed 2026-09-29.** Service okx-chat-bot', 'okx-chat-bot')).toBe('deployed');
	});
	it('ignores a sentence about another worker', () => {
		expect(readmeClaim('**Today that controller is not deployed**: there is no `avatar-pipeline-controller`', 'model-triposr')).toBeNull();
	});
	it('counts a plain sentence that names the worker', () => {
		expect(readmeClaim('robinhood-feed is not deployed yet.', 'robinhood-feed')).toBe('undeployed');
	});
});

describe('indexServices and buildRows (recorded gcloud JSON)', () => {
	it('extracts scale, gpu, url and readiness', () => {
		const t = services.get('model-trellis');
		expect(t.gpu).toBe('1x');
		expect(t.maxInstances).toBe('3');
		expect(t.url).toMatch(/^https:\/\/model-trellis-/);
		expect(t.ready).toBe(true);
	});
	it('marks a worker with a service live and one without built-only', () => {
		const rows = buildRows([worker({ dir: 'rig', service: 'model-rig' }), worker({ dir: 'texture', service: 'texture-service' })], services);
		expect(rows[0].state).toBe('live');
		expect(rows[1].state).toBe('built-only');
	});
	it('falls back to <dir>-service when cloudbuild names nothing', () => {
		const rows = buildRows([worker({ dir: 'rembg' })], services);
		expect(rows[0].state).toBe('live');
	});
	it('reports an exempt worker as n/a', () => {
		expect(buildRows([worker({ dir: 'agent-screen-worker', hasCloudbuild: false })], services)[0].state).toBe('n/a');
	});
});

describe('--check exit logic', () => {
	it('is 0 when claims match reality', () => {
		const rows = buildRows([worker({ dir: 'rig', service: 'model-rig', claim: 'deployed' }), worker({ dir: 'texture', service: 'texture-service', claim: 'undeployed' })], services);
		expect(checkExitCode(rows)).toBe(0);
	});
	it('is 1 when a README says not deployed but the service is live', () => {
		const rows = buildRows([worker({ dir: 'rig', service: 'model-rig', claim: 'undeployed' })], services);
		expect(checkExitCode(rows)).toBe(1);
		expect(rows[0].problem).toMatch(/service is live/);
	});
	it('is 1 when a README says deployed but no service exists', () => {
		const rows = buildRows([worker({ dir: 'texture', service: 'texture-service', claim: 'deployed' })], services);
		expect(checkExitCode(rows)).toBe(1);
	});
});

describe('rendering', () => {
	const rows = buildRows([worker({ dir: 'rig', service: 'model-rig' }), worker({ dir: 'texture', service: 'texture-service' })], services);
	it('renders an aligned table with one line per worker', () => {
		const lines = renderTable(rows).split('\n');
		expect(lines).toHaveLength(4);
		expect(lines[2]).toMatch(/^rig\s+model-rig\s+live/);
	});
	it('renders markdown with a ship command for built-only workers', () => {
		const md = renderMarkdown(rows, '2026-11-04');
		expect(md).toContain('## Built-only');
		expect(md).toContain('workers/texture/cloudbuild.yaml');
		expect(shipCommand(rows[1])).toContain('--project aerial-vehicle-466722-p5');
	});
});

describe('npm wiring', () => {
	it('keeps the workers:fleet script registered in package.json', () => {
		const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		expect(pkg.scripts['workers:fleet']).toBe('node scripts/workers-fleet-status.mjs');
	});
});
