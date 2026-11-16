import { describe, it, expect } from 'vitest';
import {
	scanForSecrets,
	redactRunService,
	bindingsForMembers,
	adminMfaSummary,
	evidenceFolderName,
} from '../scripts/lib/m365-evidence.mjs';

describe('m365 evidence secret scan', () => {
	it('flags credential signatures', () => {
		expect(scanForSecrets('postgres://user:hunter2@host/db')).toContain('postgres-url-with-password');
		expect(scanForSecrets('-----BEGIN PRIVATE KEY-----')).toContain('private-key-block');
		expect(scanForSecrets('AKIAABCDEFGHIJKLMNOP')).toContain('aws-access-key');
		expect(scanForSecrets('ghp_' + 'a'.repeat(36))).toContain('github-token');
		expect(scanForSecrets('[' + Array(64).fill(7).join(',') + ']')).toContain('solana-secret-key-array');
	});
	it('passes ordinary evidence', () => {
		expect(scanForSecrets('{"roles":["roles/run.admin"],"retentionDays":90}')).toEqual([]);
		expect(scanForSecrets('postgres://host/db')).toEqual([]);
	});
});

describe('Cloud Run redaction', () => {
	const svc = {
		metadata: { name: 'svc', annotations: { 'run.googleapis.com/ingress': 'all' }, labels: {} },
		spec: {
			template: {
				metadata: { annotations: { 'autoscaling.knative.dev/minScale': '2' } },
				spec: {
					serviceAccountName: 'sa@p.iam.gserviceaccount.com',
					containers: [
						{
							image: 'img',
							env: [
								{ name: 'PLAIN', value: 'super-secret-value' },
								{ name: 'FROM_SECRET', valueFrom: { secretKeyRef: { name: 'database-url', key: 'latest' } } },
							],
						},
					],
				},
			},
		},
	};
	it('keeps names and secret references, never values', () => {
		const out = redactRunService(svc);
		expect(JSON.stringify(out)).not.toContain('super-secret-value');
		expect(out.containers[0].env).toEqual([
			{ name: 'PLAIN', source: 'plain-env' },
			{ name: 'FROM_SECRET', source: 'secret-manager', secret: 'database-url', version: 'latest' },
		]);
		expect(out.serviceAccount).toBe('sa@p.iam.gserviceaccount.com');
		expect(out.scaling.min).toBe('2');
	});
});

describe('IAM and admin summaries', () => {
	it('groups roles by matching member only', () => {
		const policy = {
			bindings: [
				{ role: 'roles/run.admin', members: ['serviceAccount:three-ws-build@p.iam.gserviceaccount.com', 'user:a@b.c'] },
				{ role: 'roles/logging.logWriter', members: ['serviceAccount:three-ws@p.iam.gserviceaccount.com'] },
				{ role: 'roles/aiplatform.user', members: ['serviceAccount:three-ws@p.iam.gserviceaccount.com'] },
			],
		};
		expect(bindingsForMembers(policy, ['serviceAccount:three-ws@', 'serviceAccount:three-ws-build@'])).toEqual({
			'serviceAccount:three-ws-build@p.iam.gserviceaccount.com': ['roles/run.admin'],
			'serviceAccount:three-ws@p.iam.gserviceaccount.com': ['roles/aiplatform.user', 'roles/logging.logWriter'],
		});
	});
	it('counts admins without two-step verification and drops other columns', () => {
		const out = adminMfaSummary([
			{ id: '1', mfa_enabled: true, created_at: 'x', email: 'leak@x' },
			{ id: '2', mfa_enabled: null, created_at: 'y' },
		]);
		expect(out.total).toBe(2);
		expect(out.withoutMfa).toBe(1);
		expect(JSON.stringify(out)).not.toContain('leak@x');
	});
	it('names the folder by UTC date', () => {
		expect(evidenceFolderName(new Date('2026-11-16T23:59:59Z'))).toBe('2026-11-16');
	});
});
