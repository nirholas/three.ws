# zod-v3 (compat shim)

Re-exports `zod/v3`, the frozen zod 3 implementation that zod 4 ships, so packages written against the zod 3 API keep working on a zod release that includes the fix for GHSA-mrhx-c7xc-m3w5.

hood-api installs the packed tarball (`vendor/zod-v3-3.25.76-compat.1.tgz`) through the `package.json` override `"zod@^3": "file:vendor/zod-v3-3.25.76-compat.1.tgz"` (npm cannot override to a directory link without erroring). Rebuild it after editing this directory with `npm pack --pack-destination ..` from here, then reinstall. Consumers are `x402`, `x402-hono`, `x402-fetch` and `@coinbase/cdp-sdk`, which all pin `zod ^3` and use zod 3 only APIs (single-argument `z.record`, `errorMap`, `required_error`).

Remove this directory and the override once x402 and the CDP SDK move to zod 4.
