# X posts: Community Meetup #3 (Friday, November 6)

Copy for the @trythreews announcement of the Three.ws User Group's in-world meetup on Friday, November 6, 2026, 8:00 to 9:00 AM PT (16:00 to 17:00 UTC). Posting to X is owner-gated, so these are paste-ready drafts. Each post was checked with `node scripts/post-tweet.mjs --text "<post>" --dry-run` and fits the 100 to 179 weighted-character target from [three-world-session.md](../../marketing/growth/events/three-world-session.md).

Rules applied: no hashtags, no emoji, no dashes, no `@IBM` tag, no IBM logo on our channel. Every post with a link uses campaign `MKT-2026-11-IBM-MEETUP-3` ([campaigns.csv](../../marketing/growth/campaigns.csv)) and tags the beat in `utm_content`.

Image: attach [media/meetup-3-banner-x.png](../media/meetup-3-banner-x.png) (2400x1350, three.ws branding only) to the main post, the T-1 post and the live post. Use [media/meetup-3-ibm-listing-banner.png](../media/meetup-3-ibm-listing-banner.png) for the IBM Community listing.

## T-7: main post (post now, Friday, October 30)

Attach: media/meetup-3-banner-x.png. 178 weighted characters.

```
The Three.ws User Group meets inside the world again, hosted with IBM Community. Fri Nov 6, 8 AM PT, 16:00 UTC, in the $THREE home town. Free, no install. https://three.ws/event?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-ibm-meetup-3&utm_content=t7
```

### Reply 1 (the souvenir and the avatar)

170 weighted characters.

```
Everyone in the world that hour gets the Meetup Orbit Crown, a wearable granted once and never again. Build your avatar at three.ws/create first and it walks in with you.
```

### Reply 2 (run of show)

160 weighted characters.

```
The run of show: a sentence becomes a rigged agent, a phone clip becomes motion, /forge drops objects into the world, an agent pays for a tool. Then your demos.
```

### Reply 3 (IBM Community listing, after Jessica publishes)

The listing went live on October 30; the URL below is the event itself.

```
The event lives in the Three.ws User Group on IBM Community, with the announcement and the full technical write-up: https://community.ibm.com/community/user/events/event-description?CalendarEventKey=40070ea4-ea38-4513-8fac-01a18e7e6a7b&CommunityKey=e71510cc-d953-408f-9a1c-019f5c0a7016
```

## T-1: reminder (Thursday, November 5)

Attach: media/meetup-3-banner-x.png. 171 weighted characters.

```
Tomorrow, 8 AM PT, 16:00 UTC: the Three.ws User Group meets inside the $THREE home town. The countdown is already running. No download, no account. https://three.ws/event?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-ibm-meetup-3&utm_content=t1
```

## Live: doors open (Friday, November 6, 8:00 AM PT)

Attach a screenshot from inside the world at doors open (photo mode, P), or the banner if no capture is ready. 148 weighted characters.

```
Doors are open. Meetup #3 is live in the $THREE home town for the next hour, and everyone who walks in gets the Orbit Crown. https://three.ws/event?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-ibm-meetup-3&utm_content=live
```

## Recap (T+1)

Write it after the event from captured numbers only (peak players, demos shown), each stated with its capture time, per the measurement rules in [measurement.md](../../marketing/growth/measurement.md). Attach the group photo taken at 8:55. Use `utm_content=t1-recap`.

## Notes

- Personal accounts can quote the main post after it goes out. A repost by IBM's channels gets `utm_source` set to its venue and `utm_content=partner-repost`, and keeps the campaign ID.
- The Nov 24 session in `three-world-session.md` (campaign `MKT-2026-11-IBM-WORLD-2`) also runs on `/event`. Clear this meetup's config after Nov 6 (`npm run event:schedule -- --clear --apply`) before staging that one.
