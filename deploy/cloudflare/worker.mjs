import { DurableObject } from 'cloudflare:workers';
import { runtimeEnvironment } from './runtime-env.mjs';

const PORT = 8080;
const STARTUP_TIMEOUT_MS = 90_000;

export class ThreeWsContainer extends DurableObject {
	starting;

	constructor(ctx, env) {
		super(ctx, env);
		if (ctx.container?.running) {
			void ctx.blockConcurrencyWhile(() => ctx.container.setInactivityTimeout(this.sleepMs()));
		}
	}

	sleepMs() {
		const value = Number(this.env.THREE_WS_SLEEP_MS || 120_000);
		if (!Number.isFinite(value) || value < 1_000 || value > 21_600_000) {
			throw new Error('THREE_WS_SLEEP_MS must be between 1000 and 21600000');
		}
		return value;
	}

	async ensureReady(origin) {
		const container = this.ctx.container;
		if (!container.running) {
			container.start({
				image: container.images.base,
				instance: this.env.THREE_WS_INSTANCE || 'standard-3',
				enableInternet: true,
				env: runtimeEnvironment(this.env, origin),
			});
		}
		await container.setInactivityTimeout(this.sleepMs());
		const port = container.getTcpPort(PORT);
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		while (Date.now() < deadline) {
			try {
				// A local static request checks the listener without calling API health
				// probes that access external services. A missing favicon is acceptable.
				const response = await port.fetch('http://localhost:8080/favicon.ico', {
					signal: AbortSignal.timeout(2_000),
				});
				await response.body?.cancel();
				if (response.status < 500) return;
			} catch {
				// Connection refusals are expected while the server starts.
			}
			await scheduler.wait(250);
		}
		throw new Error('The main-site container did not become ready within 90 seconds');
	}

	async fetch(request) {
		const origin = new URL(request.url).origin;
		this.starting ??= this.ensureReady(origin).finally(() => {
			this.starting = undefined;
		});
		await this.starting;

		const url = new URL(request.url);
		const publicHost = url.host;
		url.protocol = 'http:';
		// Skip the main server's user-custom-domain lookup on preview URLs.
		// PUBLIC_APP_ORIGIN still uses the original HTTPS preview origin.
		if (url.hostname.endsWith('.workers.dev')) url.host = 'localhost';
		const forwarded = new Request(url, request);
		forwarded.headers.delete('host');
		forwarded.headers.set('x-forwarded-proto', 'https');
		forwarded.headers.set('x-forwarded-host', publicHost);
		forwarded.headers.delete('x-forwarded-for');
		const clientIp = request.headers.get('cf-connecting-ip');
		if (clientIp) forwarded.headers.set('x-forwarded-for', clientIp);
		return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
	}
}

export default {
	async fetch(request, env) {
		const path = new URL(request.url).pathname;
		// This staging deployment has no scheduler. Cron requests are refused so
		// it cannot duplicate production background jobs during the migration.
		if (path === '/api/cron' || path.startsWith('/api/cron/')) {
			return new Response('Scheduled jobs are disabled on this staging deployment.', { status: 403 });
		}
		try {
			return await env.THREE_WS.getByName('main-site').fetch(request);
		} catch {
			console.error('three.ws staging container request failed; inspect container startup logs.');
			return new Response('The site is starting or temporarily unavailable. Please retry shortly.', {
				status: 503,
				headers: { 'retry-after': '10', 'cache-control': 'no-store' },
			});
		}
	},
};
