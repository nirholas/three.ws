// The one place browser code imports zod from. Import `z` from here, never
// from 'zod' directly.
//
// zod v4 decides, when each object schema is constructed, whether it may
// JIT-compile a fast parser with `new Function`. To find out it calls
// `Function("")` once. The site CSP has no 'unsafe-eval' outside /scene, so
// that probe is blocked: zod falls back to its interpreted parser, but the
// browser still files a script-src violation report on every page load.
// Turning the JIT off here, before any schema exists, means the probe never
// runs. ES modules evaluate dependencies first, so any module that imports `z`
// from this file builds its schemas after the config below has been applied.
// The setting lives on globalThis.__zod_globalConfig, so it also covers zod
// copies bundled inside dependencies.
import { z } from 'zod';

z.config({ jitless: true });

export { z };
