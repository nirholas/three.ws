# lodash.set (vendored)

Drop-in replacement for the unmaintained `lodash.set@4.3.2`, which has no
release fixing GHSA-p6mc-m468-83gw (prototype pollution). It re-exports
`lodash/set` from a maintained `lodash`, which has the same `set(object, path,
value)` signature and blocks `__proto__`, `constructor` and `prototype` keys.

Wired in through the root `package.json` `overrides` (`"lodash.set":
"file:vendor/lodash.set"`). The only consumer is `@bnb-chain/greenfield-js-sdk`.
