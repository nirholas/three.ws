# Review a 3D model together in a meeting (Live Share)

The three.ws review stage puts one 3D model on the shared stage of a Microsoft
Teams meeting, so everyone in the call looks at the same mesh at the same time.
It runs on Microsoft Live Share, which syncs state between the meeting's
participants through a Fluid container that Microsoft hosts for the meeting.

Page: `/microsoft/teams-stage` ([`pages/microsoft-teams-stage.html`](../pages/microsoft-teams-stage.html),
code in [`src/microsoft-teams-stage/`](../src/microsoft-teams-stage)).

## What it does

| Feature | How it behaves |
|---|---|
| Follow mode | Press **Present** and your camera drives everyone's view. Orbiting while you follow breaks away on your screen only; **Jump back to <name>** returns you to the presenter. Anyone can **Take control**, and **Stop presenting** frees everyone. Built on `LiveFollowMode`. |
| Presence | The initials of everyone viewing, in a colour per person, with a tooltip of their name; clicking someone's initials follows their view. Built on `LivePresence`. |
| Laser pointers | Moving the pointer over the mesh sends a model-space point (throttled to 10 per second); every other participant sees it as a coloured dot with the person's name, raycast onto the same spot of the same mesh even when their camera differs. |
| Comment pins | Press **C** (or the pin tool) and click the mesh: the pin is raycast onto the surface, numbered, and synced with its author and time. Pins list in the drawer, where **Copy as markdown** and **Download .md** export them. Stored in a Fluid `SharedMap`. |
| Animation sync | The clip, play state and playhead are shared (`LiveState`), so everyone sees the same frame. While someone presents, the presenter owns playback and the others' controls show who does. |
| Model picker | Three sources: your three.ws models (signed in), the public featured library, or a pasted three.ws or GLB link. Changing the model changes it for the whole meeting. |

Keyboard: **P** present or stop, **C** pin mode, **Esc** closes the picker,
composer or drawer. Every control has hover, active and focus-visible states.

### The three views

| View | Teams surface (`frameContext`) | Purpose |
|---|---|---|
| Stage | `meetingStage` (and `content`) | The full-bleed shared viewer described above. |
| Side panel | `sidePanel`, or `?view=panel` | Pick a model and press **Share to stage**, which calls `meeting.shareAppContentToStage` with the stage URL for that model. |
| Config | `settings`, or `?view=config` | The configurable tab's save page; it registers the stage as the tab's content URL. |

### Outside Teams

Opened in an ordinary browser tab, the stage runs in single-user mode: the same
viewer, picker, pins (kept in that browser's local storage) and export, with a
note that explains reviewing together needs a Teams meeting. The connection
badge reads "Single user". The Live Share chunk is never downloaded in this mode.

## Try it in a real meeting (sideload)

You need a Microsoft 365 tenant where custom app upload is allowed
([upload your app](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload)).

1. Build the package with the owner values set:
   `npm run package:microsoft-app` (see [microsoft.md](./microsoft.md); `-- --check` validates without them).
2. In Teams: **Apps** > **Manage your apps** > **Upload an app** > **Upload a custom app**, and pick the zip.
3. Schedule a meeting with a second account, join it from both, and open the meeting chat.
4. In the meeting: **Apps** (the `+` in the meeting toolbar) > search **three.ws 3D Studio** > **Add** > **Save** on the config page. The side panel opens.
5. In the side panel, pick a model and press **Share to stage**. Teams asks to share; accept, and the model appears on the stage for both accounts.
6. Check: both sets of initials show, **Present** drives the other account's camera, a pin placed on one screen appears on the other, and changing the clip or scrubbing moves both.

The manifest declares the meeting tab (`configurableTabs` with contexts
`meetingSidePanel`, `meetingStage` and `meetingChatTab`, surfaces `sidePanel`
and `stage`) and four delegated resource-specific consent permissions:
`MeetingStage.Write.Chat`, `ChannelMeetingStage.Write.Group`,
`LiveShareSession.ReadWrite.Chat` and `LiveShareSession.ReadWrite.Group`.
`npm run package:microsoft-app -- --check` fails if any of them is missing.

## Run it locally (two windows, no tenant)

Live Share's test host runs the same code against a local Fluid service:

```sh
PORT=7070 node node_modules/@fluidframework/azure-local-service/dist/index.js
npm run dev
```

Open `http://localhost:3000/microsoft/teams-stage?liveshare=local&fluid=http://localhost:7070&model=<avatar id>&name=Ada`.
The container id is written to the URL hash; open the same URL, hash
included, in a second browser window with `&name=Bo` to join the session.

The end-to-end test does exactly this with two separate browsers and asserts
that camera follow, presence, lasers, pins and animation sync travel both
ways, plus the single-user mode:

```sh
npx playwright test tests/e2e/microsoft-teams-stage.spec.js
```

Unit tests for the pure logic (pose packing, pins and markdown, playback time,
model parsing) are in [`tests/microsoft-teams-stage.test.js`](../tests/microsoft-teams-stage.test.js).

## Privacy

three.ws stores no meeting content. Camera poses, presence, laser points, pins
and playback state travel only through the meeting's Live Share session, which
Microsoft hosts on Azure Fluid Relay; Microsoft documents that this data "might
be accessible for up to 24 hours, though in most cases it's deleted within six
hours" ([Live Share FAQ](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/teams-live-share-faq)).
Pins leave the meeting only when someone exports them (copy or download), and
then only to that person's clipboard or disk. The stage reads models from
three.ws the same way the viewer does and reads the signed-in user's own model
list when they open the picker.

## Bundle size and licence

The Live Share session module ([`session.js`](../src/microsoft-teams-stage/session.js))
is a dynamic import that loads only when the stage runs inside a Teams meeting
or with `?liveshare=local`. Measured on 2026-11-11 by bundling it as the
production build does (esbuild, minified, browser ESM):

| Chunk | Minified | gzip | brotli |
|---|---|---|---|
| Live Share and the Fluid client (`@microsoft/live-share` 1.4.2, `fluid-framework` 1.4.0) | 1953 KiB | 509 KiB | 342 KiB |
| `@microsoft/teams-js` 2.59.0 | 203 KiB | 56 KiB | 48 KiB |

The largest parts are Fluid's container runtime and loader. About 300 KiB of
the minified total is `jsrsasign`, which Live Share's CommonJS build requires
for local-mode tokens; bundlers include it statically because the require sits
inside Live Share's own code.

`@microsoft/live-share` is not MIT licensed. It ships under the Microsoft Live
Share SDK license, whose use right "is specifically limited to developing
applications that interact solely within the Microsoft Teams Ecosystem". That
is why the chunk loads only inside a Teams meeting (and for local testing);
the single-user stage on the open web does not use it. `@microsoft/teams-js`,
`fluid-framework` and the local Fluid service are MIT.

## Microsoft documentation this follows

- [Live Share overview](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/teams-live-share-overview)
- [Live Share core capabilities](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/teams-live-share-capabilities)
- [Live Share FAQ](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/teams-live-share-faq)
- [Build apps for the meeting stage](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/build-apps-for-teams-meeting-stage)
- [Build tabs for meetings](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/build-tabs-for-meeting)
- [Resource-specific consent](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/rsc/resource-specific-consent)

Microsoft, Microsoft Teams, Microsoft 365, Azure and Live Share are trademarks
of the Microsoft group of companies.
