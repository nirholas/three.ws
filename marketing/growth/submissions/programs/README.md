# Partner and startup program applications

One drafted application per program, for owner order 939. Every file lists the form fields with a drafted answer, eligibility, deadline, owner steps and the date its page was last read. Nothing here has been submitted; the owner submits (CLAUDE.md gate 2 and the rule against contacting third parties).

Every program page was re-read on **2026-11-14** (previous pass 2026-10-23). Where a page or its form could not be read, the file says "not verified on 2026-11-14" instead of guessing.

## Index, deadline first

| # | Program | File | Deadline | Page state on 2026-11-14 |
|---|---|---|---|---|
| 1 | Microsoft MCP server certification | [microsoft-copilot-mcp-certification.md](./microsoft-copilot-mcp-certification.md) | **Intake form now** (limited preview queue); legacy route open **through 2026-11-18** | Read in full. Intake form questions did not render: not verified. PKCE blocker found and fixed in code (commit `456a6385d`, deploy pending) |
| 2 | Composio Toolkit Partnership | [composio-toolkit.md](./composio-toolkit.md) | None on the page; tracker target 2026-10-30 passed | Form fields re-read in full, unchanged |
| 3 | LiveKit Startups | [livekit-startups.md](./livekit-startups.md) | None on the page; tracker target 2026-10-30 passed | Unchanged; form steps 2 to 4 not verified |
| 4 | ElevenLabs Startup Grant | [elevenlabs-startup-grant.md](./elevenlabs-startup-grant.md) | Rolling, tracker target 2026-09-24 overdue | Terms unchanged; question list behind sign-up |
| 5 | Cloudflare for Startups | [cloudflare-for-startups.md](./cloudflare-for-startups.md) | Rolling. Workers AI stops being covered for new members on December 1 | **Changed:** Workers AI and AI Gateway excluded; form returned 403 |
| 6 | Deepgram Startup Program | [deepgram-startup-program.md](./deepgram-startup-program.md) | Rolling; needs the ASR go or no-go first | USD 1,000 starting grant now stated on the page; fields not listed |
| 7 | Meshy Partner Program | [meshy-partner.md](./meshy-partner.md) | Rolling; weak fit (enterprise resale, Europe first) | Form fields re-read in full, unchanged |
| 8 | GitHub Technology Partner | [github-technology-partner.md](./github-technology-partner.md) | Rolling | Form fields re-read in full; registry gap still open (790 servers, none ours) |
| 9 | Discord verification and Activity Discovery | [discord-app-verification.md](./discord-app-verification.md) | Rolling; blocked on app creation | Discovery rules read via Discord's developer help center; verification form fields not verified |
| 10 | Shopify Partner and App Store review | [shopify-partner-app-store.md](./shopify-partner-app-store.md) | Rolling; blocked on app creation | Submission steps and limits now read |
| 11 | VRoid Hub app approval | [vroid-hub-approval.md](./vroid-hub-approval.md) | Rolling; blocked on app registration | Site returned 403 again; approval form not verified |
| 12 | JetBrains AI partner route | [jetbrains-ai-partner.md](./jetbrains-ai-partner.md) | None; no AI partner form exists, plugin first | Startup program read in full |
| 13 | Uthana | [uthana-partner.md](./uthana-partner.md) | None; email only | Home page read; API rates and an Uthana MCP server now published |
| 14 | Rokoko | [rokoko-partner.md](./rokoko-partner.md) | None; contact form | Contact form read, unchanged |
| 15 | Avaturn | [avaturn-partner.md](./avaturn-partner.md) | None; contact form | Docs returned only a title: not verified |
| 16 | Microsoft Power Platform certified connector | [microsoft-power-platform-certification.md](./microsoft-power-platform-certification.md) | Rolling; ready to submit (owner steps listed in the file) | Repository PR template and validation schemas read 2026-11-11; Partner Center form behind sign-in: not verified |

Files 9 to 11 add only the application layer; the build record, setup and verification packets stay in [`../discord-activity.md`](../discord-activity.md), [`../vroid-hub-app.md`](../vroid-hub-app.md) and [`../shopify-app.md`](../shopify-app.md). The LiveKit plugin pull request is [`../livekit-avatar-plugin.md`](../livekit-avatar-plugin.md).

## Shared verified facts (reuse; refresh on the submission day)

Source: [`docs/partners/proof-brief-2026-10.md`](../../../../docs/partners/proof-brief-2026-10.md), window 2026-08-31 to 2026-09-30, pulled 2026-09-30 from production. Regenerate with `npm run partners:proof -- --from 2026-08-31 --to 2026-09-30`. People-only counts exclude seeded avatars and machine accounts.

| Fact | Value |
|---|---|
| Product | Open-source platform where an AI agent has a 3D body: text or photo to a rigged avatar, one web component to embed |
| Site, repo, support | `https://three.ws`, `github.com/nirholas/three.ws` (219 stars, 52 forks), `support@three.ws` |
| 3D requests and finished models | 12,373 requests, 7,111 finished models |
| Completion | 90.2% in normal operation, 87.0% over Sep 26 to 30, 57.5% whole month (two worker incidents, documented in the brief). Never quote 90% as the monthly figure |
| Makers | 7,613 browsers from 1,988 network origins; 215 signed in |
| Agents and avatars made by people | 727 agents by 415 owners (725 with a 3D body); 703 avatars (154 selfie reconstruction) |
| Signups | 412 |
| MCP | 13,898 tool calls, 99.4% handler success, handler p50 143 ms; 13 OAuth client names; 80 servers in the official MCP registry under io.github.nirholas (counted 2026-11-14) |
| npm | 25,312 downloads across 106 `@three-ws` packages |
| Avoid | Embeds (weak), paid usage (almost all receipts are the platform's own wallets), the Granite and watsonx tools (down at the time of the brief) |

Relationship wording: three.ws is an IBM Business Partner and a member of NVIDIA Inception (never "NVIDIA partner"). Claim no relationship with any program in this folder until it confirms one.

## Owner-only inputs needed by most forms

These are not recorded anywhere in the repo, so the drafts leave them as "Owner input": legal entity name and country of incorporation, headcount, total funding raised and source, founder names, roles and LinkedIn URLs, the business email to use, phone, and confirmation of any prior enterprise contract with a vendor.

## After submitting

Every program now has a row in [`marketing/growth/opportunities.csv`](../../opportunities.csv) that points at its draft here (added or refreshed 2026-11-14). After submitting, set that row's status to `submitted` with the date, record the outcome in the program file, and when credits or listings land, wire them per the file's last section.
