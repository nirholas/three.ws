// Pure helpers behind scripts/compliance-m365-evidence.mjs: reducing raw
// provider output to evidence that carries no secret values, and the scan that
// proves an evidence folder is clean. Tested in tests/m365-evidence.test.js.

/**
 * Patterns that must never appear in an evidence file. Each entry is a
 * conservative signature of a credential, not a heuristic on entropy, so a
 * match is always worth a human look.
 */
export const SECRET_PATTERNS = [
	{ name: 'postgres-url-with-password', re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i },
	{ name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
	{ name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
	{ name: 'google-oauth-token', re: /ya29\.[0-9A-Za-z_-]{20,}/ },
	{ name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
	{ name: 'github-token', re: /gh[pousr]_[0-9A-Za-z]{30,}/ },
	{ name: 'openai-style-key', re: /sk-[0-9A-Za-z_-]{32,}/ },
	{ name: 'bearer-token', re: /bearer\s+[0-9A-Za-z._~+/-]{30,}/i },
	{ name: 'jwt', re: /eyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/ },
	{ name: 'solana-secret-key-array', re: /\[(?:\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/ },
];

/** Names of the patterns that match `text` (empty when clean). */
export function scanForSecrets(text) {
	return SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

/**
 * Cloud Run service description reduced to configuration facts. Environment
 * variables keep their NAMES and whether they come from Secret Manager, never
 * their values; secret references keep the secret name and version selector.
 */
export function redactRunService(svc) {
	const tpl = svc?.spec?.template ?? {};
	const spec = tpl.spec ?? {};
	const annotations = tpl.metadata?.annotations ?? {};
	return {
		name: svc?.metadata?.name,
		region: svc?.metadata?.labels?.['cloud.googleapis.com/location'],
		latestReadyRevision: svc?.status?.latestReadyRevisionName,
		serviceAccount: spec.serviceAccountName,
		ingress: svc?.metadata?.annotations?.['run.googleapis.com/ingress'],
		scaling: {
			min: annotations['autoscaling.knative.dev/minScale'],
			max: annotations['autoscaling.knative.dev/maxScale'],
		},
		vpcConnector: annotations['run.googleapis.com/vpc-access-connector'],
		vpcEgress: annotations['run.googleapis.com/vpc-access-egress'],
		timeoutSeconds: spec.timeoutSeconds,
		containerConcurrency: spec.containerConcurrency,
		containers: (spec.containers ?? []).map((c) => ({
			image: c.image,
			resources: c.resources,
			ports: c.ports,
			env: (c.env ?? []).map((e) =>
				e.valueFrom?.secretKeyRef
					? { name: e.name, source: 'secret-manager', secret: e.valueFrom.secretKeyRef.name, version: e.valueFrom.secretKeyRef.key }
					: { name: e.name, source: 'plain-env' },
			),
		})),
	};
}

/**
 * Project IAM policy reduced to the bindings that name `memberPrefixes`
 * (the runtime and build service accounts), grouped by member.
 */
export function bindingsForMembers(policy, memberPrefixes) {
	const byMember = {};
	for (const b of policy?.bindings ?? []) {
		for (const member of b.members ?? []) {
			if (!memberPrefixes.some((p) => member.startsWith(p))) continue;
			(byMember[member] ??= []).push(b.role);
		}
	}
	for (const roles of Object.values(byMember)) roles.sort();
	return byMember;
}

/** Share of admin users with a second factor enrolled. */
export function adminMfaSummary(rows) {
	const admins = rows.map((r) => ({ id: r.id, mfa_enabled: Boolean(r.mfa_enabled), created_at: r.created_at }));
	const without = admins.filter((a) => !a.mfa_enabled).length;
	return { admins, total: admins.length, withoutMfa: without };
}

/** Today's date as the evidence folder name (UTC). */
export function evidenceFolderName(now = new Date()) {
	return now.toISOString().slice(0, 10);
}
