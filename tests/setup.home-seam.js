// Vitest setup: decide the home lane's local-instance seam BEFORE any test
// module, and therefore any route handler, is imported.
//
// `api/_lib/home-url-guard.js` is the lane's SSRF control, and it reads
// `HOME_ALLOW_LOCAL_INSTANCE` once into a module-level constant. That is a
// deliberate property of it, written down in the guard itself: a value that is
// read once at load cannot be turned on by a request. It also means the flag has
// to be in the environment before the guard's first import, and nothing inside a
// test file can guarantee that. `beforeAll` is far too late, and even an import
// of the harness helper is only early enough when it happens to sit above the
// import that pulls the guard in (`tests/home-runtime-live.test.js` imports
// `api/_lib/home/runtime.js` first, so for that file it does not).
//
// Getting it wrong does not look like a missing flag. Every house this lane's
// harness can build lives on 127.0.0.1, so the guard refuses the dial and every
// route that reaches the house answers `502 unreachable`, from the same handler
// and after the same auth, scope and role checks a working run passes. That has
// now been misread three times: as a broken plan journey, as a broken floorplan
// route, and most expensively as a 409-to-502 regression in the confirmation
// protocol, reproduced against two separate Home Assistant instances, when the
// confirmation gate was never reached at all. See the "guard's own failure mode"
// section of docs/home-security.md.
//
// This file is a no-op for the run `npm test` actually performs. It arms nothing
// unless the caller has already asked for a live house, and never for a public
// address or on a Cloud Run revision. It cannot make a security check pass that
// would fail in production either: check 7 of tests/home-security.test.js
// re-imports the guard with the seam forced off and `K_SERVICE` present, which
// is the shape the live service runs in, and the guard refuses to honour the
// seam on a Cloud Run revision whatever is set here.

import { armLocalInstanceSeam } from './_helpers/home-instance.js';

armLocalInstanceSeam();
