# x-guest

Keyless X (Twitter) reader. Public profiles and user timelines through the guest-token GraphQL surface x.com's own web client uses for logged-out visitors. No API key, no account, read-only.

Adapted from XActions (Apache-2.0, see [NOTICE](NOTICE) and [LICENSE](LICENSE)). The parsers are copied; the client is a compact reimplementation (the upstream client is blocked from our network egress, a minimal one is not).

## API

```js
import { fetchGuestProfile, fetchGuestTimeline } from './index.js';

const profile = await fetchGuestProfile('jack');        // followers, joined date, avatar, bio
const { tweets } = await fetchGuestTimeline('jack', { limit: 20 });
```

## Failure model

Every error is an `XGuestError` with a `reason`: `rate_limited`, `stale_query_id`, `not_found`, `guest_token`, `upstream`. Callers fail soft to the previous rung and log the reason.

- A 429 opens a module-level cooldown until `x-rate-limit-reset`.
- A 403 re-activates the guest token once.
- A 404 (or a 400 naming the persisted query) means x.com rotated a query ID: the current IDs are read from the upstream XActions constants at runtime and the call retried once. If upstream has no fresh ID, the call fails with `stale_query_id`.
- Guest tokens are cached for 2.5 hours with single-flight activation.

## Callers

- [src/kol/x-profile.js](../../../src/kol/x-profile.js): rung 2 behind the X API v2 for admin-attached handles.
- [api/_lib/oracle/x-account.js](../oracle/x-account.js): the coin's own X account age and followers.
- [api/cron/oracle-social-ingest.js](../../cron/oracle-social-ingest.js): timelines fed to `/api/oracle/social`.

Tests: [tests/x-guest.test.js](../../../tests/x-guest.test.js).

Terms: this reads the same public data the logged-out web client reads, at low volume and with caching. Whether that fits X's terms for a commercial surface is an owner call; setting `TWITTER_BEARER_TOKEN` keeps rung 1 first.
