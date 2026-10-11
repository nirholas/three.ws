import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'pulse-db-'));

describe('embedded pglite', () => {
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('creates missing parent directories so a fresh clone starts with zero setup', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('PGLITE_DIR', join(root, 'not', 'yet', 'there', 'pglite'));
    vi.resetModules();
    const { db } = await import('../src/db/client.ts');
    const d = await db();
    expect(d.kind).toBe('pglite');
    expect(await d.query('select 1 as one')).toEqual([{ one: 1 }]);
    await d.close();
  });
});
