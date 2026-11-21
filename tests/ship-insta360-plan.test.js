import { describe, expect, it } from 'vitest';
import {
	ALL_SERVICE_KEYS,
	GPU_SERVICES,
	PROJECT,
	RUNTIME_SA,
	apiEnvArgs,
	apiEnvDiff,
	chooseGpuRegion,
	gpuDeployArgs,
	heldGpus,
	isRouteMissing,
	judgePoll,
	laneChecks,
	parseImagesFile,
	video2motionUpdateArgs,
} from '../scripts/lib/insta360-ship-plan.mjs';

const D = `sha256:${'0123456789abcdef'.repeat(4)}`;
const ref = (region, repo) => `${region}-docker.pkg.dev/${PROJECT}/${repo}/server@${D}`;
const goodImages = {
	pano2splat: { image: ref('us-central1', 'model-pano2splat') },
	panodepth: { image: ref('europe-west4', 'model-panodepth') },
	video2motion: { image: ref('us-central1', 'model-video2motion') },
};
const spec = (key) => GPU_SERVICES.find((s) => s.key === key);

describe('parseImagesFile', () => {
	it('accepts digest-pinned refs from each service repo in a supported region', () => {
		const { images, missing } = parseImagesFile(JSON.stringify(goodImages));
		expect(missing).toEqual([]);
		expect(Object.keys(images).sort()).toEqual([...ALL_SERVICE_KEYS].sort());
	});

	it('lists services with no verified image instead of inventing one', () => {
		const { images, missing } = parseImagesFile({ $comment: 'x', pano2splat: goodImages.pano2splat });
		expect(images).toEqual({ pano2splat: goodImages.pano2splat.image });
		expect(missing).toEqual(['panodepth', 'video2motion']);
	});

	it('rejects a moving tag, a foreign repo and an unsupported region', () => {
		const tag = `us-central1-docker.pkg.dev/${PROJECT}/model-pano2splat/server:latest`;
		expect(() => parseImagesFile({ ...goodImages, pano2splat: { image: tag } })).toThrow(/pano2splat must be/);
		expect(() => parseImagesFile({ ...goodImages, panodepth: { image: ref('us-central1', 'model-pano2splat') } })).toThrow(/panodepth must be/);
		expect(() => parseImagesFile({ ...goodImages, pano2splat: { image: ref('asia-east1', 'model-pano2splat') } })).toThrow(/pano2splat must be/);
	});
});

describe('GPU region choice', () => {
	it('counts only warm GPU pins of other services', () => {
		const services = [
			{ name: 'granite-guardian', gpu: true, minScale: 1 },
			{ name: 'model-trellis', gpu: true, minScale: 2 },
			{ name: 'three-ws-api', gpu: false, minScale: 3 },
			{ name: 'model-pano2splat', gpu: true, minScale: 1 },
		];
		expect(heldGpus(services, ['model-pano2splat'])).toBe(3);
	});

	it('prefers europe-west4 and falls back when its headroom is gone', () => {
		expect(chooseGpuRegion({ quotas: { 'europe-west4': 8, 'us-central1': 3 }, held: { 'europe-west4': 1, 'us-central1': 0 } }).region).toBe('europe-west4');
		expect(chooseGpuRegion({ quotas: { 'europe-west4': 8, 'us-central1': 3 }, held: { 'europe-west4': 7, 'us-central1': 0 } }).region).toBe('us-central1');
	});

	it('fails with the numbers when no region has room for both GPU workers', () => {
		expect(() => chooseGpuRegion({ quotas: { 'europe-west4': 8, 'us-central1': 3 }, held: { 'europe-west4': 7, 'us-central1': 4 } })).toThrow(
			/europe-west4: limit 8, warm 7, free 1; us-central1: limit 3, warm 4, free -1/,
		);
	});

	it('honours --region and rejects an unsupported one', () => {
		expect(chooseGpuRegion({ quotas: { 'us-central1': 3 }, held: {}, override: 'us-central1' }).region).toBe('us-central1');
		expect(() => chooseGpuRegion({ quotas: {}, held: {}, override: 'asia-east1' })).toThrow(/not a supported GPU region/);
	});
});

describe('gcloud argument lists', () => {
	it('deploys each GPU worker on one L4 with scale-to-zero, one instance and the runtime SA', () => {
		for (const s of GPU_SERVICES) {
			const args = gpuDeployArgs(s, { region: 'europe-west4', image: goodImages[s.key].image });
			expect(args.slice(0, 3)).toEqual(['run', 'deploy', s.name]);
			for (const flag of ['--gpu=1', '--gpu-type=nvidia-l4', '--min-instances=0', '--max-instances=1', '--region=europe-west4', `--service-account=${RUNTIME_SA}`, '--update-secrets=API_KEY=avatar-reconstruction-key:latest']) {
				expect(args).toContain(flag);
			}
			expect(args.some((a) => a.startsWith('--set-env-vars') || a.startsWith('--set-secrets'))).toBe(false);
			expect(args.some((a) => a.startsWith('--add-volume'))).toBe(false);
		}
	});

	it('keeps pano2splat results in the capture bucket and allows a long training request', () => {
		const args = gpuDeployArgs(spec('pano2splat'), { region: 'us-central1', image: goodImages.pano2splat.image });
		expect(args).toContain('--update-env-vars=RESULT_BUCKET=three-ws-pano-captures,MAX_QUEUE=8');
		expect(args).toContain('--timeout=3600');
	});

	it('refuses to deploy without an image', () => {
		expect(() => gpuDeployArgs(spec('panodepth'), { region: 'us-central1' })).toThrow(/no image/);
		expect(() => video2motionUpdateArgs('')).toThrow(/no image/);
	});

	it('rolls video2motion by image only, leaving its env and scaling alone', () => {
		const args = video2motionUpdateArgs(goodImages.video2motion.image);
		expect(args.slice(0, 4)).toEqual(['run', 'services', 'update', 'model-video2motion']);
		expect(args.filter((a) => a.startsWith('--') && !['--quiet'].includes(a)).map((a) => a.split('=')[0]).sort()).toEqual(['--image', '--project', '--region']);
	});

	it('wires three-ws-api with --update-env-vars and trims trailing slashes', () => {
		const args = apiEnvArgs({ pano2splat: 'https://model-pano2splat-x.a.run.app/', panodepth: 'https://model-panodepth-x.a.run.app' });
		expect(args).toContain('--update-env-vars=GCP_PANO2SPLAT_URL=https://model-pano2splat-x.a.run.app,GCP_PANODEPTH_URL=https://model-panodepth-x.a.run.app');
		expect(args.join(' ')).not.toMatch(/--set-env-vars/);
		expect(() => apiEnvArgs({ pano2splat: 'http://insecure', panodepth: 'https://ok' })).toThrow(/no https URL for model-pano2splat/);
	});

	it('reports which API env vars change', () => {
		const diff = apiEnvDiff({ GCP_PANO2SPLAT_URL: 'https://a' }, { pano2splat: 'https://a/', panodepth: 'https://b' });
		expect(diff).toEqual([
			{ name: 'GCP_PANO2SPLAT_URL', prev: 'https://a', next: 'https://a', changed: false },
			{ name: 'GCP_PANODEPTH_URL', prev: null, next: 'https://b', changed: true },
		]);
	});
});

describe('production lane checks', () => {
	const checks = Object.fromEntries(laneChecks('https://three.ws').map((c) => [c.key, c]));

	it('submits a preview job per lane on a public fixture', () => {
		expect(checks.pano2splat.submit).toMatchObject({ url: 'https://three.ws/api/pano-capture', body: { source_kind: 'equirect_video', quality: 'preview' } });
		expect(checks.panodepth.submit).toMatchObject({ url: 'https://three.ws/api/pano-scene', body: { source_kind: 'equirect_image' } });
		expect(checks.video2motion.submit.body).toMatchObject({ projection: 'equirect', subject: { yaw_deg: 34.5, pitch_deg: -28.1 } });
		for (const c of Object.values(checks)) expect(Object.values(c.submit.body).find((v) => String(v).startsWith('https://upload.wikimedia.org/'))).toBeTruthy();
		expect(checks.pano2splat.poll('a b')).toBe('https://three.ws/api/pano-capture?job=a%20b');
	});

	it('judges nested pano results and flat motion-swap results', () => {
		const url = (n) => `https://storage.googleapis.com/three-ws-pano-captures/t/${n}?X-Goog-Signature=s`;
		const pano = { status: 'succeeded', result: { ply_url: url('scene.ply'), spz_url: url('scene.spz'), preview_url: url('preview.mp4'), poster_url: url('poster.jpg') } };
		expect(judgePoll(checks.pano2splat, pano).state).toBe('passed');
		expect(judgePoll(checks.video2motion, { status: 'completed', clip_url: url('c.json'), reframe_url: url('r.mp4') }).state).toBe('passed');
	});

	it('fails a success without every artifact, and surfaces worker errors', () => {
		expect(judgePoll(checks.panodepth, { status: 'succeeded', result: { glb_url: 'https://x/a.glb' } })).toMatchObject({ state: 'failed', detail: 'succeeded but missing ply_url' });
		expect(judgePoll(checks.pano2splat, { status: 'failed', error: { code: 'sfm_failed', message: 'COLMAP registered 3 of 120 frames' } })).toMatchObject({
			state: 'failed',
			detail: 'failed: COLMAP registered 3 of 120 frames',
		});
		expect(judgePoll(checks.pano2splat, { status: 'running', stage: 'sfm' })).toEqual({ state: 'running', detail: 'running / sfm' });
	});

	it('tells a route the API has not deployed from an ordinary 404', () => {
		expect(isRouteMissing(404, { error: 'not_found', message: 'No API route matches /api/pano-scene' })).toBe(true);
		expect(isRouteMissing(404, { error: 'not_found', message: 'job not found' })).toBe(false);
		expect(isRouteMissing(400, 'No API route matches')).toBe(false);
	});
});
