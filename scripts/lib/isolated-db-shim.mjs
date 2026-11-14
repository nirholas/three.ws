// What api/_lib/db.js resolves to once scripts/lib/isolated-db.mjs is in use:
// the real module's helpers, with `sql` swapped for the throwaway PGlite one.
// A local export shadows the same name from `export *`, so `sql` here wins.

export * from '../../api/_lib/db.js';

const isolated = globalThis.__threeWsIsolatedSql;
if (!isolated) throw new Error('isolated-db-shim loaded without useIsolatedDb(): refusing to fall through to the production database');

export const sql = isolated;
