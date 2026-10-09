# App Store listing copy

Every field App Store Connect asks for, filled in, so the submission is a copy
and paste rather than a writing session. Character limits are Apple's and are
enforced by the form.

## Name (30 characters max)

```
three.ws: 3D AI Agents
```

## Subtitle (30 characters max)

```
Give your AI a body
```

## Promotional text (170 characters, editable without a new build)

```
Describe a character, get a rigged 3D avatar in under a minute, then stand it up in your actual room in AR. Your agents, animated, anywhere.
```

## Description (4000 characters max)

```
three.ws turns a sentence into a 3D character you can animate, talk to, and place in the real world.

CREATE
Describe what you want and get a textured 3D model back. Add a face from a selfie. Every humanoid comes rigged and animation-ready, so it walks, idles and gestures from the moment it exists. No modelling, no rigging, no software to learn.

SEE IT IN YOUR ROOM
Point your camera at the floor and put your agent there. Place as many as you like, move them, resize them, walk around them. Real lighting from your room, real occlusion behind real furniture. Capture a photo and share it.

PIN IT TO A PLACE
Leave an agent at a real location and let other people find it there. A character at your favourite bench, a guide at the entrance to a building, a companion where you left it.

TALK TO IT
Give an agent a voice and a personality and have a conversation out loud. It looks at you while you speak.

SHARE A PHOTO, GET AN AVATAR
Pick three.ws in the share sheet from Photos or any other app and the photo is waiting in Create, ready to become a 3D avatar of you. Share a GLB model from Files and it goes straight into your library.

NEVER MISS A SALE
Turn on notifications and hear the moment someone buys from your agent, follows you or remixes your work. The icon shows what you have not read yet, and a tap takes you right to it.

BRING IT ANYWHERE
Everything you make exports as a standard GLB and embeds in any website with one line of code. Your work is not trapped in an app.

BROWSE WHAT OTHERS MADE
A live feed of what the community is creating, full creator profiles, and a marketplace of agents you can use.

three.ws is the 3D layer for the agentic web. Everything you create is yours, in open formats, on open standards.
```

## Keywords (100 characters, comma separated, no spaces)

```
3d,avatar,ai,agent,ar,augmented,reality,character,animation,glb,creator,generator,rig,model,studio
```

## Support URL

```
https://three.ws/docs
```

## Marketing URL

```
https://three.ws
```

## Privacy policy URL

```
https://three.ws/legal/privacy
```

Not `/privacy`, which is a 404. A dead privacy URL is an automatic rejection;
`curl -sI https://three.ws/legal/privacy` must answer `200`.

## Category

- Primary: **Graphics & Design**
- Secondary: **Photo & Video**

`Graphics & Design` over `Entertainment` because the product is a creation tool
and the App Store ranks it against tools rather than games.

## Age rating

Expect 12+. The honest answers to the questionnaire are: user-generated content
is present, so the UGC questions apply; no gambling, no realistic violence, no
sexual content. Answer the questionnaire from the product, not from this note.

## App Privacy (data collection disclosure)

These answers must match the privacy manifest compiled into the app,
[`../native/App/App/PrivacyInfo.xcprivacy`](../native/App/App/PrivacyInfo.xcprivacy).
App Store Connect compares the two, and a mismatch is a rejection. Change both
together.

**Tracking: No.** three.ws does not link app data with third-party data for
advertising and does not share it with data brokers. No tracking domains.

| App Store Connect category | Data type | Linked to the user | Purposes |
|---|---|---|---|
| Contact Info | Email Address | Yes | App Functionality |
| Identifiers | User ID | Yes | App Functionality, Analytics |
| User Content | Photos or Videos | Yes | App Functionality |
| User Content | Audio Data | Yes | App Functionality |
| User Content | Other User Content (prompts, models, agent settings) | Yes | App Functionality |
| Location | Precise Location | Yes | App Functionality |
| Purchases | Purchase History | Yes | App Functionality |
| Usage Data | Product Interaction | Yes | Analytics, Product Personalization |
| Diagnostics | Other Diagnostic Data | Yes | App Functionality, Analytics |

Why each row is there: email is the account; photos come from the camera,
selfie and share sheet flows and are stored with the generation; audio is talk
mode and `/drive`; precise location is IRL pins, which place an agent at a real
spot; purchase history is the record of credits, skills and subscriptions
bought on three.ws (in Safari) that the app displays; product interaction and
diagnostics are first-party usage and error events.

## Notes for the reviewer

```
three.ws is a 3D content creation tool. A reviewer can exercise the whole core product without an account: open Create, type a prompt, and a 3D model is generated and rendered. Placing a model in AR needs camera access on a physical device.

Demo account: supplied in the Sign-In Information fields of this submission.

Things only the app does, worth a look:
- Share sheet: in Photos, share any photo and pick three.ws. It opens in Create, ready to become a 3D avatar. A .glb file shared from Files goes into the library.
- Home screen widget: long-press the home screen, add the three.ws widget, and your agent appears.
- Quick actions: long-press the app icon.
- Notifications: sales, follows and remixes arrive as push notifications and badge the icon.

On blockchain functionality: three.ws is published by an organization account. The app shows 3D characters that creators may have registered on a public blockchain, and lets a signed-in user view their wallet, deposit to it, withdraw from it and claim from it. Nothing is bought, sold, traded or launched inside the app. Buying credits, skills or a subscription, launching a coin, trading and paying for services all open in Safari: the app explains this in a sheet, and Safari continues signed in on the same page.

Account deletion: Settings, Danger Zone, Delete my account.
```

Keep that last paragraph true. If the app ships with in-app transactional
surfaces, rewrite it and read [`../docs/REVIEW-RISK.md`](../docs/REVIEW-RISK.md)
again first.
