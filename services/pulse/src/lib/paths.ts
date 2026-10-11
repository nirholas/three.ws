// Locates files that ship beside the code: SQL migrations and the built
// dashboard. From source they live in the repo tree; from the npm bundle
// (dist/*.js) they sit next to the entry points.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function assetDir(bundled: string, source: string): string {
  for (const dir of [here, join(here, '..')]) {
    const next = join(dir, bundled);
    if (existsSync(next)) return next;
  }
  return resolve(here, '../..', source);
}
