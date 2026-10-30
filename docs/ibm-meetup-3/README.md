# Community Meetup #3 kit: Back in the World (Friday, November 6, 2026)

The Three.ws User Group on IBM Community meets inside the `$THREE` home town at [three.ws/play](https://three.ws/play) again, hosted with IBM Community (IBM sponsors and co-markets; Jessica Swanson publishes the article and thread in the group). Same format as the August 7 meetup.

| | |
|---|---|
| When | Friday, November 6, 2026, 8:00 to 9:00 AM PT, 16:00 to 17:00 UTC. Early doors 7:45 AM PT. |
| Your time | 11 AM New York, 4 PM London, 5 PM Berlin, 9:30 PM Mumbai, midnight Singapore and Hong Kong (into Saturday), 1 AM Saturday Tokyo. US daylight saving ends November 1, so Europe and Asia land an hour later than in August. |
| Event config | [public/event.json](../../public/event.json): `three-community-meetup-3`, eight agenda beats, souvenir `orbit-crown-meetup-3` |
| Campaign | `MKT-2026-11-IBM-MEETUP-3` in [campaigns.csv](../../marketing/growth/campaigns.csv) |

## Files

| File | Who uses it | What it is |
|---|---|---|
| [event-listing.html](./event-listing.html) | Owner, IBM Community event form | The August listing duplicated and updated. The two comments at the top hold the form fields (title, time, image, contact) and the Login Instructions; paste the rest into the description editor in HTML mode. |
| [jessica-article.md](./jessica-article.md), [jessica-article.html](./jessica-article.html) | Jessica | The blog post she publishes in the group, in her voice. The HTML twin pastes straight into the IBM Community editor; the comment at its top is the header-image note, not post content. |
| [thread.md](./thread.md), [thread.html](./thread.html) | Jessica or the team account | The pinned discussion thread: event table, join steps, run of show, what changed since August, the venue and platform for newcomers, the stack, what is next. |
| [x-posts.md](./x-posts.md) | Owner, @trythreews | T-7 main post with three replies, a T-1 reminder, the live post and recap guidance. Every post was dry-run through `scripts/post-tweet.mjs`. |
| [../media/meetup-3-banner-x.png](../media/meetup-3-banner-x.png) | X | 2400x1350, three.ws branding plus the Orbit Crown |
| [../media/meetup-3-ibm-listing-banner.png](../media/meetup-3-ibm-listing-banner.png) | IBM Community listing and article header | 2400x1200, same design, no IBM logo |
| [/blog/ibm-user-group-meetup-3](../../blog/ibm-user-group-meetup-3.html) | three.ws website | The announcement post with Event structured data, its OG card [public/meetup-3-og.png](../../public/meetup-3-og.png), the blog index card, the RSS item and the changelog entry |

## Owner steps, in order

1. **Deploy the frontend** (`npm run deploy:gcp:full`). Production serves an empty `/event.json` today, and the blog post, OG card and crown asset return 404 until this ships.
2. **Repair the multiplayer dependencies, then deploy the multiplayer service** (`cd multiplayer && ./deploy-cloudrun.sh`). The live revision `three-ws-multiplayer-00011-qjv` was built on 2026-08-17; it has neither the Orbit Crown catalog entry nor the sweep that grants players already standing in the plaza when the window opens. Without this deploy nobody receives the souvenir, which is exactly how the August Laurel was lost ([event-souvenirs.md](../event-souvenirs.md)). Confirm afterwards with the `gcloud run services describe` check in that doc.

   **The deploy fails as the tree stands (checked 2026-10-30).** Between Oct 22 and Oct 30, Dependabot moved the server's Colyseus packages to 0.18 and `@colyseus/schema` to 5 through the root workspace. It updated `multiplayer/package.json` and the root lock but never `multiplayer/package-lock.json`, which is what the Dockerfile's `npm ci` installs from, so the build stops with "lock file's @colyseus/core@0.16.24 does not satisfy @colyseus/core@0.18.23". Regenerating the lock for 0.18 is not the answer: the browser client is `colyseus.js` 0.16.22, which decodes with schema 3, so a 0.18 server would build and then drop every player. The fix:
   - In `multiplayer/package.json`, set `@colyseus/core` `^0.16.24`, `@colyseus/monitor` `^0.16.7`, `@colyseus/ws-transport` `^0.16.5`, `@colyseus/redis-driver` `^0.16.0`, `@colyseus/redis-presence` `^0.16.0` and `@colyseus/schema` `3.0.76` (the set the August image ran). Keep `@upstash/redis` `^1.40.0`.
   - Regenerate the standalone lock with the image's own npm, outside the workspace: copy both files to an empty directory, run `docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:22-slim npm install --package-lock-only --ignore-scripts` there, and copy the lock back. Only the Colyseus set and `@upstash/redis` change version (plus three Babel patches); the rest of the diff is peer dependencies the lock had been missing since before Oct 22.
   - Prove it with `docker build -t three-ws-multiplayer:check multiplayer`, then deploy. The same change also clears the root `nanoid` override problem in the known issue below, because that override pins the nanoid Colyseus 0.16 uses.
   - Add a Dependabot `ignore` for `@colyseus/*` above 0.16 and `@colyseus/schema` above 3 until server and client move together.
3. **Create the IBM Community event** from [event-listing.html](./event-listing.html): Fri Nov 6, 08:00 to 09:00 AM PT, banner `docs/media/meetup-3-ibm-listing-banner.png`.
4. **Send Jessica** the article and the thread (the `.html` twins paste cleanly). Ask her to link the event once it exists.
5. **Post on X** from [x-posts.md](./x-posts.md): the T-7 post today with the banner, reply 3 once the listing URL exists, the T-1 post on Thursday, the live post at doors.
6. **Agenda beat at 8:27 (an agent pays for a tool).** It settles a real micropayment on Solana. Approve the number of rounds before the session; nothing on stream spends without that.
7. **After the event** (Nov 7): `npm run event:schedule -- --clear --apply`, then deploy, so `/event` returns to its no-event state before the Nov 24 session (`MKT-2026-11-IBM-WORLD-2`, [three-world-session.md](../../marketing/growth/events/three-world-session.md)) is staged. Write the recap from captured numbers only.

## Judgment calls

- **One hour, not nine.** August's description said 8 to 9 AM but the form said 8 AM to 5 PM, and the world stayed open all day. This listing is one programmed hour, so the form and the description both say 9:00 AM. The world stays open afterwards anyway.
- **"Back in the world," not "third meetup."** The October IBM event ([ibm-event-two.md](../../marketing/growth/events/ibm-event-two.md)) never got a date, and the September Star Shades config has no record of running, so the copy treats August 7 as the group's last in-world meeting. The `#3` in the event name matches the souvenir series.
- **No token thesis or contract address in the IBM thread.** The SEO plan keeps crypto-cluster content off IBM Community ([seo-keyword-plan.md](../ops/seo-keyword-plan.md)). The venue is still called the `$THREE` home town, as in August.
- **No IBM logo on new assets, no `@IBM` tag.** Per [badge-usage.md](../../marketing/ibm-partner-plus/badge-usage.md); if IBM wants a co-branded header it supplies its own mark. Every piece carries the independence line.
- **No live Granite claims.** Production watsonx is not configured, so the copy describes the IBM MCP servers as running on the member's own IBM Cloud account.
- **Other crypto projects named nowhere.** The site manifest in the listing omits those pages, and copy says "Solana token" and "dollar stablecoin".

## Known issue for the engineer who picks this up

The root `package.json` carries an override pinning `@colyseus/core`'s `nanoid` to `2.1.11`, which the Dependabot-installed `@colyseus/core` 0.18 cannot import, so the root vitest run cannot load `WalkRoom` (`tests/walkroom-*.test.js`, `tests/walk-room.test.js`, `tests/play-*.test.js`). Production is unaffected because the multiplayer image installs from its own lockfile. The sweep tests were run with an alias to nanoid 3 and pass (27 files, 277 tests); removing that override is the real fix.
