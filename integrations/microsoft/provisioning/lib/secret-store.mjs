// Local copy of the client secrets the provisioner creates. Lives outside the
// repository (default ~/.config/three-ws/microsoft-provision), directory mode
// 700, files mode 600. Two files:
//   secrets.json    { [ENV_NAME]: { value, keyId, appId, expires } }
//   cloud-run.env   the single --update-env-vars argument, so the printed
//                   gcloud command reads secrets from disk instead of argv
//                   text anyone can see in the terminal.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export function defaultSecretsDir(env = process.env) {
	const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
	return join(base, 'three-ws', 'microsoft-provision');
}

/** Refuse a secrets directory inside the repository, where a sweep could commit it. */
export function assertOutsideRepo(dir, repoRoot) {
	const d = resolve(dir) + sep;
	const r = resolve(repoRoot) + sep;
	if (d.startsWith(r)) throw new Error(`refusing to write secrets inside the repository (${dir}); pass --secrets-dir outside ${repoRoot}`);
}

export class SecretStore {
	constructor(dir, repoRoot) {
		assertOutsideRepo(dir, repoRoot);
		this.dir = dir;
		this.file = join(dir, 'secrets.json');
		this.envFile = join(dir, 'cloud-run.env');
	}

	read() {
		if (!existsSync(this.file)) return {};
		return JSON.parse(readFileSync(this.file, 'utf8'));
	}

	get(envName) {
		return this.read()[envName] || null;
	}

	#ensureDir() {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
		chmodSync(this.dir, 0o700);
	}

	#writePrivate(path, text) {
		this.#ensureDir();
		writeFileSync(path, text, { mode: 0o600 });
		chmodSync(path, 0o600);
	}

	put(envName, record) {
		const all = this.read();
		all[envName] = record;
		this.#writePrivate(this.file, `${JSON.stringify(all, null, 2)}\n`);
	}

	writeEnvArg(arg) {
		this.#writePrivate(this.envFile, arg);
		return this.envFile;
	}
}
