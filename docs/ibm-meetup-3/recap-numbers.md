# Meetup #3: captured numbers

Every figure used in the recap pieces, where it came from, and the query that reproduces it. Captured on November 7, 2026 for the event window of Friday, November 6, 16:00 to 17:00 UTC (8:00 to 9:00 AM PT). GCP project `aerial-vehicle-466722-p5`, region `us-central1`.

## Used in the recap

| Figure | Value | Source |
|---|---|---|
| Orbit Crowns granted | 45 unique accounts, every grant between 16:00 and 17:00 UTC | `three-ws-multiplayer` log lines `souvenir orbit-crown-meetup-3 → <playerId>` |
| Peak concurrent players | 13, in room `uDEy1AoVX` at 16:30 UTC | the `(n=<count>)` suffix on `+join` lines in `three-ws-multiplayer` |
| Rooms used | 1 (every attendee was in `uDEy1AoVX`) | same `+join` lines |
| Signature wall | 3 signatures, all on Nov 6: kunturi 15:56:21 UTC, Falcolina ("falcolina was here") 15:56:34 UTC, guest-zh5l ("hi") 16:51:10 UTC | `GET https://three.ws/api/play/signature-wall` |
| Stayed late | Falcolina rejoined at 17:41 UTC (9:41 AM PT), Ozzxy at 18:02 UTC (10:02 AM PT), Jessica at 17:27 UTC. Leaves are not logged, so only rejoins are claimed | `+join` lines, 17:00 to 18:30 UTC |

Peak room population per 10 minutes (UTC): 15:30 5, 15:40 8, 15:50 9, 16:00 10, 16:10 12, 16:20 12, 16:30 13, 16:40 7, 16:50 6, 17:00 5.

## Captured but not claimed

- **Event leaderboard:** 0 runs (`/api/play/event-leaderboard`). Not mentioned.
- **Forge calls during the hour:** about 13 successful `POST /api/forge`, 9 `/api/gpt-forge` and 2 avatar reconstructs site-wide. They cannot be attributed to attendees, so the recap does not count them.
- **The 8:27 agent-pays-for-a-tool beat:** no log line confirms it ran live, so no recap piece says it happened. The agenda tables list it as scheduled.
- **August's 3,145:** there is no attendance record for the August meetup ([LIVE-OPS.md](../event-readiness/LIVE-OPS.md)), so no piece compares the two events.

## Problems seen during the hour

- The Plaza Stage logged `beat (cadence) failed: host http 404` 73 times.
- `/x402/forge` returned some 503s (fixed afterwards in commit `503ebf7d9`).
- 86 Colyseus encoder buffer warnings on `three-ws-multiplayer`.

## Queries

```bash
# Souvenir grants
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="three-ws-multiplayer" AND textPayload:"souvenir orbit-crown-meetup-3" AND timestamp>="2026-11-06T00:00:00Z" AND timestamp<"2026-11-08T00:00:00Z"' \
  --project aerial-vehicle-466722-p5 --format='value(timestamp,textPayload)' --limit=20000 > souvenir.log
grep -o '→ [^ ]*' souvenir.log | sort -u | wc -l

# Joins and room population (peak = largest n= per room)
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="three-ws-multiplayer" AND timestamp>="2026-11-06T15:30:00Z" AND timestamp<"2026-11-06T18:30:00Z"' \
  --project aerial-vehicle-466722-p5 --format='value(timestamp,textPayload)' --limit=200000 > mp.log
grep '+join' mp.log | grep -o 'n=[0-9]*' | sort -t= -k2 -n | tail -1

# API traffic during the hour
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="three-ws-api" AND logName:"requests" AND timestamp>="2026-11-06T15:45:00Z" AND timestamp<"2026-11-06T17:10:00Z"' \
  --project aerial-vehicle-466722-p5 --format='value(timestamp,httpRequest.requestMethod,httpRequest.status,httpRequest.requestUrl)' --limit=300000 > api.log

# Signature wall
curl -s https://three.ws/api/play/signature-wall
```
