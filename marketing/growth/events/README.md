# Community event kits

Turnkey kits for the next three community events in the
[marketing command center](../README.md). Each kit is paste-ready: copy, dates, emails, posts
for every beat, a minute-by-minute run of show on verified product surfaces, the event config,
and the owner's steps in order. The owner books a date and presses send; nothing here posts,
emails, or creates anything by itself.

| Event | Kit | Campaign | Date | State |
|---|---|---|---|---|
| Community Meetup #3: Back in the World, hosted with IBM Community | [docs/ibm-meetup-3/](../../../docs/ibm-meetup-3/README.md) | `MKT-2026-11-IBM-MEETUP-3` | Friday, November 6, 2026, 16:00 to 17:00 UTC | Kit ready; event config committed; awaiting both deploys, the IBM listing, and the X posts |
| IBM Community event two: Give an Agent a Body, Live | [ibm-event-two.md](./ibm-event-two.md) | `MKT-2026-09-IBM-EVENT` | Three October Thursdays offered; October 15 recommended | Kit ready; awaiting date, IBM speaker, and the two emails |
| Three World Session, November: An Agent Pays for Its Own Tool | [three-world-session.md](./three-world-session.md) (Part 2) | `MKT-2026-11-IBM-WORLD-2` | Tuesday, November 24, 2026 (November 17 as the fallback) | Kit ready; follows event two |
| GitHub Open Source Friday | [open-source-friday-menu.md](./open-source-friday-menu.md) and the [stream plan](../../../docs/open-source-friday-plan.md) | `MKT-2026-09-OSF` | Any bookable Friday from October 2, 2026 | Approved; booking reply and seven issue bodies ready |

## How the kits fit together

- **The package** is the T-21 to T+7 table in the command center
  ([the community becomes the stage](../README.md#3-the-community-becomes-the-stage)). Every kit
  implements it beat for beat.
- **The template** for any future monthly session is Part 1 of
  [three-world-session.md](./three-world-session.md): nine slots to decide, a fixed timeline, a
  fixed run-of-show frame, and the rules every kit follows.
- **One event at a time.** `public/event.json` holds a single window, so a session's config is
  written at its T-14 and cleared at its T+1 (`npm run event:schedule -- --clear --apply`) before
  the next one is written. `npm run check:event` fails the gate on an expired window.
- **Links and numbers** follow [measurement.md](../measurement.md): campaign IDs in every UTM,
  and no count in any post unless it was captured with its time.
- **IBM-facing wording** follows [badge-usage.md](../../ibm-partner-plus/badge-usage.md) and
  [docs/ibm.md](../../../docs/ibm.md).

## Files

| Path | What it is |
|---|---|
| [ibm-event-two.md](./ibm-event-two.md) | Event page copy, the IBM relationship email, the Agent Connect `APP_ID` email, posts for X, LinkedIn, Telegram, and IBM Community at T-14, T-7, T-1, live, T+1, and T+7, run of show, event config, pre-flight, measurement, feature verification |
| [three-world-session.md](./three-world-session.md) | The reusable monthly template and the filled-in November session |
| [open-source-friday-menu.md](./open-source-friday-menu.md) | Seven verified first issues, one `gh issue create` command each, and the booking reply for issue #254 |
| [osf-issues/](./osf-issues) | The seven issue bodies, used with `gh issue create --body-file` |
