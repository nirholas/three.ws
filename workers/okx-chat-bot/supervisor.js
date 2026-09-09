// okx-chat-bot: keeps the XMTP daemon alive for the life of the container.
//
// `okx-a2a daemon start` delegates to an OS autostart unit (systemd/launchd).
// There is no systemd in a container, so that call installs a unit and silently
// leaves the daemon DOWN: the exact trap that made the local bot look staged
// but offline. The supported foreground entrypoint is `okx-a2a run`, so this
// supervisor owns that child directly and restarts it with capped exponential
// backoff when it dies.
//
// A crashed daemon also leaves a lock behind that blocks the next start
// ("stale pid=…" / "lockPid=…"), so the lock is cleared before every spawn.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { cliEnv } from './cli.js';
import { log } from './log.js';

export function createSupervisor(cfg, p) {
	let child = null;
	let stopping = false;
	// Set once, by stop(). A restart flips `stopping` on and off around its own
	// SIGTERM, so it needs a flag that a real shutdown cannot be confused with:
	// respawning a daemon after the shutdown path has begun would leave the final
	// snapshot copying a live sqlite file, which is exactly what the stop-then-
	// snapshot ordering exists to prevent.
	let terminated = false;
	let restarts = 0;
	let backoffMs = cfg.restartBaseMs;
	let timer = null;
	let startedAt = 0;

	function spawnDaemon() {
		if (stopping) return;
		rmSync(p.lock, { force: true, recursive: true });
		child = spawn(cfg.daemonBin, ['run'], {
			env: cliEnv(cfg),
			cwd: cfg.home,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		startedAt = Date.now();
		log.info('daemon spawned', { pid: child.pid, restarts });

		// The daemon's own output is the only window into XMTP delivery, so it is
		// forwarded rather than dropped. Prefixed so it is greppable in Cloud
		// Logging next to this worker's structured lines.
		const forward = (level) => (buf) => {
			for (const line of String(buf).split('\n')) {
				if (line.trim()) log[level]('daemon', { line: line.slice(0, 2000) });
			}
		};
		child.stdout?.on('data', forward('info'));
		child.stderr?.on('data', forward('warn'));

		// One spawn can raise both 'error' and 'exit' (a binary missing from PATH
		// does exactly that), and each must schedule at most one restart.
		let settled = false;
		const daemonDied = (detail) => {
			if (settled) return;
			settled = true;
			const aliveMs = Date.now() - startedAt;
			child = null;
			if (stopping) return;
			restarts++;
			// A daemon that ran healthily for a while and then died is a transient
			// fault: reset the backoff so it comes straight back. A daemon that dies
			// immediately is a config fault and must back off, or the restart loop
			// buries the real error under thousands of log lines.
			backoffMs = aliveMs > 60_000 ? cfg.restartBaseMs : Math.min(backoffMs * 2, cfg.restartMaxMs);
			log.error('daemon exited', { ...detail, aliveMs, restarts, restartInMs: backoffMs });
			timer = setTimeout(spawnDaemon, backoffMs);
			if (typeof timer.unref === 'function') timer.unref();
		};

		// Without this listener a spawn failure is an unhandled 'error' event, which
		// throws and takes the whole worker down. That turns "the daemon binary is
		// missing" into "the host is gone", losing the health verdict, the heartbeat
		// and the alert that would have named the real problem.
		child.on('error', (err) => daemonDied({ code: err?.code ?? null, signal: null, spawnError: err?.message }));
		child.on('exit', (code, signal) => daemonDied({ code, signal }));
	}

	async function stopChild(timeoutMs) {
		if (timer) clearTimeout(timer);
		const proc = child;
		if (!proc) return;
		await new Promise((resolve) => {
			const done = setTimeout(() => {
				proc.kill('SIGKILL');
				resolve(undefined);
			}, timeoutMs);
			proc.once('exit', () => {
				clearTimeout(done);
				resolve(undefined);
			});
			proc.kill('SIGTERM');
		});
	}

	return {
		start: spawnDaemon,
		/** Stop the child and wait for it, so state is quiesced before a snapshot. */
		async stop(timeoutMs = 10_000) {
			stopping = true;
			terminated = true;
			await stopChild(timeoutMs);
			log.info('daemon stopped', { restarts });
		},

		/**
		 * Replace the running daemon with one spawned from the current environment.
		 *
		 * The adapter hands the spawned AI subsession the daemon's own environment,
		 * fixed at spawn time, so a newly elected AI lane cannot reach the CLI any
		 * other way. Deliberately a full stop-then-start rather than a signal: the
		 * daemon holds a lock and a sqlite file, and only a clean exit quiesces both.
		 */
		async restart(reason, timeoutMs = 10_000) {
			if (stopping) return;
			log.info('daemon restart', { reason, restarts });
			// Suppress the exit handler's own restart for the duration: without this
			// the SIGTERM below schedules a respawn AND the explicit spawn runs, and
			// two daemons race for one lock and one XMTP identity.
			stopping = true;
			await stopChild(timeoutMs);
			child = null;
			if (terminated) return;
			stopping = false;
			backoffMs = cfg.restartBaseMs;
			spawnDaemon();
		},
		stats() {
			return { restarts, pid: child?.pid ?? null, uptimeMs: child ? Date.now() - startedAt : 0 };
		},
	};
}
