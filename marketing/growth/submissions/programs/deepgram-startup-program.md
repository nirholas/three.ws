# Deepgram Startup Program (and Technology partner track)

Program: Deepgram Startup Program (credits) and, separately, the Technology Partner track at <https://deepgram.com/partners>.
Page last read: 2026-10-23 (<https://deepgram.com/startup-program>, <https://deepgram.com/partners>). `https://deepgram.com/startups` returned 404, so use the `startup-program` URL.
Tracker row: "Deepgram Startup Program" in `opportunities.csv` (status `owner_decision_required`, target 2026-10-09, overdue).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## Decision this application depends on

Deepgram is not in our code today (our speech recognition runs on NVIDIA Riva behind `api/asr.js`). The tracker row asks whether to add Deepgram as a second ASR rung. The honest application therefore says "plan to use". Judgment call: apply as a planned second rung behind Riva for failover and multilingual coverage; it costs nothing and credits are the only grant. If the owner decides no, record the no-go in the tracker instead and skip this file.

## What it grants and deadline

- "Up to $100,000 in credits" over 12 months, used within 12 months. Search results quoting Deepgram's terms say direct applicants start at USD 1,000 with upgrades as usage grows; the program page itself does not list tiers. Treat the USD 1,000 start as the realistic expectation.
- No deadline. Response typically within a week; credits within 24 to 48 hours of approval.

## Eligibility

| Criterion | Status |
|---|---|
| AI builder or early-stage startup (the terms cite under USD 10M raised) | Owner confirms funding |
| In production or launching within 6 months | Met |
| Commit to actively engage with the Deepgram community | Owner agrees |
| Free Deepgram console account and Project ID | Owner creates the account; the Project ID goes in the form |

## Form fields

The page lists a Deepgram console account and Project ID, and asks you to describe the startup and how you plan to use voice AI. Other fields: **not verified on 2026-10-23**.

| Field | Draft answer |
|---|---|
| Project ID | Owner input from console.deepgram.com |
| Company, website | three.ws, `https://three.ws` |
| Describe your startup | three.ws is an open-source platform for embodied AI agents: a text prompt or photo becomes a rigged 3D avatar that speaks, gestures and listens on any web page. October 2026 proof brief (31 days to 2026-09-30): 727 agents by 415 owners, 703 avatars, 7,111 finished 3D models, 412 signups, 13,898 MCP tool calls at 99.4% handler success. |
| How you plan to use voice AI | Speech-to-text for the avatar's listening loop: Nova streaming transcription as a second rung beside NVIDIA Riva in `api/asr.js`, selected per language and for failover; Aura text-to-speech as an additional voice option; and the Voice Agent API for a one-socket agent demo whose spoken output drives avatar lip-sync (viseme analysis in `src/lip-sync-analyser.js`). |
| Stage and funding | Owner input |
| Team | Owner input |

## Technology Partner track (optional second step)

Benefits listed: partner engineering support, "Powered by Deepgram" placement, co-marketing, embedded ISV pricing. No formal eligibility; the team reviews fit and schedules a scoping call. The form fields at `#apply-form` are not listed on the page (**not verified on 2026-10-23**). Apply only after the ASR rung ships, so the application can point at a live integration.

## Owner steps

1. Decide go or no-go on the ASR rung and log it in the tracker.
2. If go: create the Deepgram account, copy the Project ID, apply at <https://deepgram.com/startup-program>.
3. After credits land: store the key through the credential playbook (never in git), build the rung, then apply to the Technology track.
