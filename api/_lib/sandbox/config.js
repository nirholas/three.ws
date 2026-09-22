// Sandbox configuration, read from the environment at call time so a test or a
// self-hosted runtime can flip a backend on without a restart.
//
//   SANDBOX_BUCKET          GCS bucket holding every run's workspace (default three-ws-sandbox)
//   SANDBOX_STORE           gcs | fs. Defaults to gcs; fs keeps workspaces on local disk
//                           (self-hosters and the local runtime without GCP credentials)
//   SANDBOX_DATA_DIR        root for the fs store and for local job directories
//   SANDBOX_LOCAL           1 enables the local subprocess backend. Off in production:
//                           it would run untrusted code inside the API container.
//   SANDBOX_DOCKER          1 enables the docker backend (needs a docker CLI and daemon)
//   SANDBOX_DOCKER_IMAGE    image the docker backend runs (default three-ws-sandbox:latest)
//   SANDBOX_CLOUDRUN_JOB    job name prefix; the size suffix -s / -m / -l is appended
//   SANDBOX_CLOUDRUN_REGION region of the jobs (default us-central1)
//   SANDBOX_GCP_PROJECT     project of the jobs and the bucket
//   SANDBOX_BRIDGE_ORIGIN   origin the Cloud Run runner calls back to (default the app origin)
//   SANDBOX_BRIDGE_SECRET   HMAC key for bridge tokens (default: derived from JWT_SECRET)

import os from 'node:os';
import path from 'node:path';

const e = (name) => {
	const v = process.env[name];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
};

export const isProduction = () =>
	process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || Boolean(process.env.K_SERVICE);

export const sandboxConfig = {
	get bucket() {
		return e('SANDBOX_BUCKET') || 'three-ws-sandbox';
	},
	get store() {
		const s = e('SANDBOX_STORE');
		return s === 'fs' ? 'fs' : 'gcs';
	},
	get dataDir() {
		return e('SANDBOX_DATA_DIR') || path.join(os.tmpdir(), 'three-ws-sandbox');
	},
	get localEnabled() {
		return e('SANDBOX_LOCAL') === '1';
	},
	get dockerEnabled() {
		return e('SANDBOX_DOCKER') === '1';
	},
	get dockerImage() {
		return e('SANDBOX_DOCKER_IMAGE') || 'three-ws-sandbox:latest';
	},
	get cloudRunJob() {
		return e('SANDBOX_CLOUDRUN_JOB') || 'three-ws-sandbox';
	},
	get cloudRunRegion() {
		return e('SANDBOX_CLOUDRUN_REGION') || 'us-central1';
	},
	get gcpProject() {
		return e('SANDBOX_GCP_PROJECT') || e('GOOGLE_CLOUD_PROJECT') || e('GCP_PROJECT_ID') || 'aerial-vehicle-466722-p5';
	},
	get bridgeOrigin() {
		return (e('SANDBOX_BRIDGE_ORIGIN') || e('PUBLIC_APP_ORIGIN') || 'https://three.ws').replace(/\/+$/, '');
	},
	get publicOrigin() {
		return (e('PUBLIC_APP_ORIGIN') || 'https://three.ws').replace(/\/+$/, '');
	},
	get bridgeSecret() {
		return e('SANDBOX_BRIDGE_SECRET');
	},
};
