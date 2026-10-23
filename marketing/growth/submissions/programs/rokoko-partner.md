# Rokoko integration listing inquiry

Program: no dedicated partner form found. The closest route is the general "Get in touch" form at <https://www.rokoko.com/get-in-touch>; the device SDK lives at sdk.rokoko.com.
Page last read: 2026-10-23 (the get-in-touch page). A partner or integrations application, and any partner terms: **not verified on 2026-10-23**. The page lists integrations (Blender, Unreal, Unity) but no way to apply to be listed.
Prospect context: score 12 in `docs/partners/prospects.md` ("250,000 users" is a vendor claim from the 2026-10-09 sweep).
Nothing has been sent. Shared facts and owner-only inputs: [README.md](./README.md).

## Form fields (verified today)

| Field | Draft |
|---|---|
| First Name | Owner input |
| Last Name | Owner input |
| Email | Owner input (three.ws address) |
| Your message | The message below |
| Email marketing consent checkbox | Owner's choice; leave unticked by default |

## The ask

A listing on Rokoko's integrations page, and an answer on how a web app can accept live or recorded mocap from Rokoko tools. Our side: Rokoko Studio exports (FBX/BVH) can be imported as clips and retargeted onto any humanoid avatar through the universal retargeter; a live path would use the device SDK. Before promising anything, confirm that import path in code (`src/animation-retarget.js`, importers) because this file does not claim it is finished.

## Drafted message

> Hello Rokoko team. three.ws is an open-source platform for embodied 3D AI agents, built on three.js and glTF. Any humanoid avatar on the platform can play clips through a universal retargeter, and we run open motion-generation workers. In the 31 days to 30 September 2026 people created 727 agents and 703 avatars. We would like to be listed on your integrations page for recorded Rokoko Studio takes played on web avatars, and to talk about live mocap into a browser agent through your device SDK. Who handles integration listings? Contact: support@three.ws.

## Owner steps

1. Confirm the recorded-take import path works with a real Rokoko export before sending (a Studio FBX or BVH). If it does not, send the message with only the live-mocap question.
2. Send through the form; add a tracker row (no Rokoko row exists today).
3. If Rokoko lists us, add the link to the integrations docs.
