# Community Meetup #3 kit: Back in the World (Friday, November 6, 2026)

The Three.ws User Group on IBM Community meets inside the `$THREE` home town at [three.ws/play](https://three.ws/play) again, hosted with IBM Community (IBM sponsors and co-markets; Jessica Swanson publishes the article and thread in the group). Same format as the August 7 meetup.

| | |
|---|---|
| When | Friday, November 6, 2026, 8:00 to 9:00 AM PT, 16:00 to 17:00 UTC. Early doors 7:45 AM PT. |
| Your time | 11 AM New York, 4 PM London, 5 PM Berlin, 9:30 PM Mumbai, midnight Singapore and Hong Kong (into Saturday), 1 AM Saturday Tokyo. US daylight saving ends November 1, so Europe and Asia land an hour later than in August. |
| IBM listing | Live since October 30: [Community Meetup #3 on IBM Community](https://community.ibm.com/community/user/events/event-description?CalendarEventKey=40070ea4-ea38-4513-8fac-01a18e7e6a7b&CommunityKey=e71510cc-d953-408f-9a1c-019f5c0a7016) |
| Event config | [public/event.json](../../public/event.json): `three-community-meetup-3`, eight agenda beats, souvenir `orbit-crown-meetup-3` |
| Campaign | `MKT-2026-11-IBM-MEETUP-3` in [campaigns.csv](../../marketing/growth/campaigns.csv) |

## Files

| File | Who uses it | What it is |
|---|---|---|
| [event-form.md](./event-form.md) | Jessica, IBM Community "Add Event" form | Every form field in the order the form shows it: title, type, time zone, contact, invitations, image and joining instructions. |
| [event-listing.html](./event-listing.html), [event-listing-short.html](./event-listing-short.html) | Jessica, the form's Description field | The August listing kept whole (every section, FAQ entry and link it had) and extended: the Microsoft partnership and Marketplace listing, the full partner roster with a link per partner, the directory and token listings, what shipped since August, and the site index regenerated from today's manifest (1,002 pages). Pasted in HTML mode. The short version drops the page-by-page site index in case the editor rejects the full one for length. |
| [jessica-article.md](./jessica-article.md), [jessica-article.html](./jessica-article.html) | Jessica | The blog post she publishes in the group, in her voice: her August post ([Join the Three.ws User Group's First In-World Meetup](https://community.ibm.com/community/user/blogs/jessica-swanson/2026/08/04/join-the-threews-user-groups-first-in-world-meetup)) section by section, with the date, agenda, August's numbers and the event listing updated. The HTML twin pastes straight into the IBM Community editor; the comment at its top is the header-image note, not post content. |
| [thread.md](./thread.md), [thread.html](./thread.html) | Jessica or the team account | The pinned discussion thread: event table, join steps, run of show, what changed since August, the venue and platform for newcomers, the stack, what is next. |
| [x-posts.md](./x-posts.md) | Owner, @trythreews | T-7 main post with three replies, a T-1 reminder, the live post and recap guidance. Every post was dry-run through `scripts/post-tweet.mjs`. |
| [../media/meetup-3-banner-x.png](../media/meetup-3-banner-x.png) | X | 2400x1350, three.ws branding plus the Orbit Crown |
| [../media/meetup-3-ibm-community-banner.png](../media/meetup-3-ibm-community-banner.png) | IBM Community event listing and Jessica's post (featured image) | 2400x1200, the August listing banner with the new title and date. The IBM logo, cube and lockup are the August pixels, not a redraw |
| [../media/meetup-3-ibm-listing-banner.png](../media/meetup-3-ibm-listing-banner.png) | IBM Community, if IBM prefers no logo | 2400x1200, same design as the X banner, no IBM logo |
| [/blog/ibm-user-group-meetup-3](../../blog/ibm-user-group-meetup-3.html) | three.ws website | The announcement post with Event structured data, its OG card [public/meetup-3-og.png](../../public/meetup-3-og.png), the blog index card, the RSS item and the changelog entry |

## Owner steps, in order

1. **Deploy the frontend** (`npm run deploy:gcp:full`). Production serves an empty `/event.json` today, and the blog post, OG card and crown asset return 404 until this ships.
2. **Repair the multiplayer dependencies, then deploy the multiplayer service** (`cd multiplayer && ./deploy-cloudrun.sh`). The live revision `three-ws-multiplayer-00011-qjv` was built on 2026-08-17; it has neither the Orbit Crown catalog entry nor the sweep that grants players already standing in the plaza when the window opens. Without this deploy nobody receives the souvenir, which is exactly how the August Laurel was lost ([event-souvenirs.md](../event-souvenirs.md)). Confirm afterwards with the `gcloud run services describe` check in that doc.

   **The deploy fails as the tree stands (checked 2026-10-30).** Between Oct 22 and Oct 30, Dependabot moved the server's Colyseus packages to 0.18 and `@colyseus/schema` to 5 through the root workspace. It updated `multiplayer/package.json` and the root lock but never `multiplayer/package-lock.json`, which is what the Dockerfile's `npm ci` installs from, so the build stops with "lock file's @colyseus/core@0.16.24 does not satisfy @colyseus/core@0.18.23". Regenerating the lock for 0.18 is not the answer: the browser client is `colyseus.js` 0.16.22, which decodes with schema 3, so a 0.18 server would build and then drop every player. The fix:
   - In `multiplayer/package.json`, set `@colyseus/core` `^0.16.24`, `@colyseus/monitor` `^0.16.7`, `@colyseus/ws-transport` `^0.16.5`, `@colyseus/redis-driver` `^0.16.0`, `@colyseus/redis-presence` `^0.16.0` and `@colyseus/schema` `3.0.76` (the set the August image ran). Keep `@upstash/redis` `^1.40.0`.
   - Regenerate the standalone lock with the image's own npm, outside the workspace: copy both files to an empty directory, run `docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:22-slim npm install --package-lock-only --ignore-scripts` there, and copy the lock back. Only the Colyseus set and `@upstash/redis` change version (plus three Babel patches); the rest of the diff is peer dependencies the lock had been missing since before Oct 22.
   - Prove it with `docker build -t three-ws-multiplayer:check multiplayer`, then deploy. The same change also clears the root `nanoid` override problem in the known issue below, because that override pins the nanoid Colyseus 0.16 uses.
   - Add a Dependabot `ignore` for `@colyseus/*` above 0.16 and `@colyseus/schema` above 3 until server and client move together.
3. **Done, October 30:** IBM Community event created (Jessica) from [event-form.md](./event-form.md): Fri Nov 6, 08:00 to 09:00 AM Pacific, description from [event-listing.html](./event-listing.html).
4. **Send Jessica** the article and the thread (the `.html` twins paste cleanly). Both already link the live event listing.
5. **Post on X** from [x-posts.md](./x-posts.md): the T-7 post today with the banner, reply 3 (the listing is live, so it can go with the others), the T-1 post on Thursday, the live post at doors.
6. **Agenda beat at 8:27 (an agent pays for a tool).** It settles a real micropayment on Solana. Approve the number of rounds before the session; nothing on stream spends without that.
7. **After the event** (Nov 7): `npm run event:schedule -- --clear --apply`, then deploy, so `/event` returns to its no-event state before the Nov 24 session (`MKT-2026-11-IBM-WORLD-2`, [three-world-session.md](../../marketing/growth/events/three-world-session.md)) is staged. Write the recap from captured numbers only.

## Judgment calls

- **One hour, not nine.** August's description said 8 to 9 AM but the form said 8 AM to 5 PM, and the world stayed open all day. This listing is one programmed hour, so the form and the description both say 9:00 AM. The world stays open afterwards anyway.
- **Third meetup, second in the world.** The group has met twice: the in-world meetup on August 7 ("three.ws Community Meetup: Live on the $THREE Server") and the online session "Live build: text prompt to embedded 3D agent in 30 minutes". The copy names both and calls this the third meetup and the second in-world one. The October plan in [ibm-event-two.md](../../marketing/growth/events/ibm-event-two.md) never ran. The listing title mirrors the first one: "three.ws Community Meetup #3: Back on the $THREE Server | three.ws/play".
- **No token thesis or contract address in the IBM thread.** The SEO plan keeps crypto-cluster content off IBM Community ([seo-keyword-plan.md](../ops/seo-keyword-plan.md)). The venue is still called the `$THREE` home town, as in August.
- **The IBM logo appears only on the IBM Community listing banner, and is never redrawn; no `@IBM` tag.** Per [badge-usage.md](../../marketing/ibm-partner-plus/badge-usage.md). The listing banner reuses the August image IBM's listing already carried, with only the title and date replaced; the X banner, article header and site assets carry no IBM mark. Every piece carries the independence line.
- **No live Granite claims.** Production watsonx is not configured, so the copy describes the IBM MCP servers as running on the member's own IBM Cloud account.
- **The listing names other crypto projects; the thread and article do not.** The owner asked for the August listing with nothing removed, and the August listing named pump.fun, USDC and the full site index, so the listing does too, plus the directory listings (Coinbase x402 Bazaar, BNB Chain Dappbay, CoinMarketCap, the $THREE exchange listings). The thread and article still say "Solana token" and "dollar stablecoin".

## Known issue for the engineer who picks this up

The root `package.json` carries an override pinning `@colyseus/core`'s `nanoid` to `2.1.11`, which the Dependabot-installed `@colyseus/core` 0.18 cannot import, so the root vitest run cannot load `WalkRoom` (`tests/walkroom-*.test.js`, `tests/walk-room.test.js`, `tests/play-*.test.js`). Production is unaffected because the multiplayer image installs from its own lockfile. The sweep tests were run with an alias to nanoid 3 and pass (27 files, 277 tests); removing that override is the real fix.
