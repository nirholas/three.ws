# Seeker launch, video cut: the run of show

The app has been live on the Solana dApp Store since 2026-09-01. What was
missing was proof a stranger believes, and a phone-shot video of a real person
holding a real Seeker with the real listing on screen is that proof. It beats
the store screenshots, it beats a screen recording, and on every platform that
matters a native video outranks a link post.

This page is the plan for shipping it: what the edit has to contain, what goes
out where and in what order, and the copy for each surface, paste-ready.

The photo-first version of this announcement, written before the video existed,
is in [post.md](post.md). The long explainer copy there is still the best
description of the app we have, and the thread below reuses it deliberately.
Assumption baked into the copy: the footage shows the listing on a Seeker held
in someone's hand, in one continuous real-world take, and at least part of it is
another person showing the app rather than the founder demoing it. If a second
person is on camera, they get a credit only if they want one, and never a
surname or a handle they did not offer.

---

## 1. The edit

One source file, four masters. Drop the phone file in
`marketing/seeker-launch/.raw/` (git ignores that directory, so a 400 MB
original never enters the repo) and run:

```bash
node marketing/seeker-launch/make-cuts.mjs --in=.raw/seeker-irl.mov \
  --start=00:00:02.5 --end=00:00:34 --poster=00:00:06
```

| Output | Where it goes |
|---|---|
| `cuts/seeker-irl-x-16x9.mp4` | X, LinkedIn |
| `cuts/seeker-irl-vertical-9x16.mp4` | TikTok, Reels, Shorts |
| `cuts/seeker-irl-loop-1x1.mp4` | Telegram, and the `/seeker` page hero. Silent by design |
| `cuts/seeker-irl-poster.jpg` | The frame X and LinkedIn show before playback starts |

Vertical footage is fitted, never centre-cropped: the hand and the listing are
the subject and a 16:9 crop eats both. The bars fill with a blurred, darkened
copy of the frame, which reads as composed rather than letterboxed.

**The beats the edit has to hit, in this order:**

1. **The listing, legible, inside two seconds.** The three.ws icon, the name,
   and the Install button on the Solana dApp Store. Most people watching have
   never seen a phone that installs apps from a chain. That frame is the whole
   post.
2. **The tap.** Install, or open. One uninterrupted motion. Do not cut away
   mid-tap; the continuity is what makes it evidence.
3. **The app opening full screen.** No address bar. That absence is the point
   and nobody will notice it unless the shot holds a beat longer than feels
   necessary.
4. **One thing happening inside.** An agent turning in 3D, or the Seed Vault
   sheet appearing on the one-tap sign in. One. Not a tour.
5. **Out.** 20 to 35 seconds total for the X cut. The vertical can run to 60 if
   the hands and the voice carry it.

**Rules that are not negotiable:**

- **Captions on the vertical cut, burned in.** Feeds are muted by default. Add
  them in the platform's own caption editor if the words are unscripted, so the
  timing matches the speech, and read them back once before posting: auto
  captions turn "Seeker" into "seeker" and "three.ws" into "3ws" reliably.
- **Poster frame is the listing, not a face.** The first frame is the thumbnail
  everywhere, and a mid-blink face is a scroll.
- **Alt text on every upload.** X, LinkedIn and Telegram all take it:

  ```
  A hand holding a Solana Seeker phone, with the three.ws listing open on the Solana dApp Store. The app installs and opens full screen, showing a 3D agent.
  ```

- **Shoot the retake if the glare wins.** Tilt the top of the phone a few
  degrees away from the lens and expose for the screen. A listing you cannot
  read is not proof of anything.

---

## 2. The order of the day

Weekday. Post 1 lands between 09:30 and 11:00 ET, which is the window the
Solana desk audience is awake for on both coasts and still afternoon in Europe.

| When | Surface | What |
|---|---|---|
| T-1 day | The device | Cold install from the dApp Store on a phone that has never had the app. If that is not clean, nothing else on this list happens |
| T-1 day | The site | Publish the loop cut as the `/seeker` hero, so the destination the thread points at is showing the same footage |
| T0 | X, post 1 | The 16:9 cut, native upload, no link in the body |
| T0 + 2 min | X, reply 1 | What it is, and the install instruction. This reply carries the URL |
| T0 + 5 min | X, reply 2 | Seed Vault and MWA, the part that needed this phone. Tag `@solanamobile` here, never in post 1 |
| T0 + 30 min | Telegram, @three_ws | The loop cut and three lines. The community channel gets it as news, not as a repost ask |
| T0 + 2 h | LinkedIn | The 16:9 cut, native, with the founder-voice text below |
| T0 + 5 h | TikTok, Reels, Shorts | The vertical cut, captions burned in, posted to all three within the same hour |
| T+1 day | Farcaster, the X community, Solana Mobile's dev channels | Same video, shorter copy, no repost begging |
| T+2 to T+7 | X | The derivative posts: `marketing/seeker-video/seeker-feature-tour-device.mp4` is already rendered and covers the screens the IRL clip skipped |

Pin post 1 to the profile the moment it is up, and leave it pinned for a week.

**Why the link is not in post 1.** X demotes posts that send people away, and a
video post with a link gets the worst of both. The install instruction ("open
the dApp Store on your Seeker") is a call to action that needs no URL, and the
reply two minutes later carries the link for everyone who wants it.

**Do not ask anyone for a repost.** Tagging `@solanamobile` in the technical
reply is the whole outreach. Ecosystem accounts amplify real device footage
because it is scarce; asking them to converts a share into a favour.

---

## 3. The copy

### X, post 1 (attach the 16:9 cut)

Post 1 names the category, not one feature. An opener that says "take a selfie,
get an avatar" reads as the whole product to someone who has never seen it, and
the app does considerably more than that. Give the range in one breath (a
character from a photo, a prompt, or a model you already have; a mind and a
voice; ownership on-chain) and let the replies carry the detail.

Option A, video-led. The first line is a caption for what is on screen, so this
is the one to use if the footage opens on the dApp Store listing.

```
A phone that installs apps from a blockchain.

three.ws is live on the Solana dApp Store. Make a character from a photo, a prompt, or a model you own, give it a mind and a voice, talk to it in 3D, own it on-chain.

Search three.ws on your Seeker.
```

Option B, the studio. Widest of the three, and the one to use if the video is
close and technical rather than warm.

```
three.ws is live on the Solana dApp Store.

Your Seeker is now a 3D agent studio. Make a character from a photo, a prompt, or a model you own. Give it a personality, a voice, skills. Talk to it in 3D. Own it on-chain.

Search three.ws on your Seeker.
```

Option C, studio plus the hardware. Trades one creation detail for the Seed
Vault line, which is the claim no other app store listing can make.

```
three.ws is live on the Solana dApp Store.

A 3D agent studio on your phone. Make an agent, give it a mind and a voice, talk to it, own it on-chain, put it anywhere.

Signing never leaves the Seeker's secure element.

Search three.ws on your Seeker.
```

### X, reply 1 (the link)

```
Three ways in: a selfie, a text prompt, or a GLB you already have. The selfie comes back rigged and textured in about a minute.

Then a personality, a voice, skills. It answers you in 3D, in your language.

Creating, chatting and browsing are free.

three.ws/seeker
```

### X, reply 2 (the part that needed a Seeker)

```
Why this phone.

Every signature routes to Seed Vault through Mobile Wallet Adapter. Signing in is one tap, not connect-then-sign, and the private key never enters the app process. It stays in the secure element.

No extension. No seed phrase typed into a phone.

@solanamobile
```

### X, reply 3 (the ownership beat)

```
When an agent should be properly yours, you deploy it on-chain as a Metaplex Core asset your wallet holds. Open manifest, no lock-in, portable.

Everything you make on the phone is on the web app the moment you sign in there.

Open source: github.com/nirholas/three.ws
```

### X, reply 4 (optional, for Seeker owners)

Post this one only if the thread is moving. It is the beat Seeker owners quote.

```
Own a Seeker and you can prove it. The app reads your soulbound Genesis Token, never moves it, and puts a Seeker verified badge on every agent you own.

A read, never a transaction.
```

### Telegram, @three_ws

Attach the loop cut. The channel is the community, so this reads as news it
already half expected, not as an advertisement.

```
three.ws on a real Seeker, from the dApp Store.

Search three.ws in the dApp Store on your Seeker or Saga and install it. One tap signs you in through Seed Vault, a selfie becomes a rigged 3D agent in about a minute, and everything you make is waiting on the web app when you sign in there.

Creating, chatting and browsing are free.

https://three.ws/seeker
```

### LinkedIn

Native video upload, 16:9 cut. Longer, first person, and it explains the
category to people who have never held a crypto phone.

```
A phone that installs apps from a blockchain, running a 3D agent studio.

three.ws is live on the Solana dApp Store for Solana Seeker and Saga.

Point the camera at yourself and about a minute later you have a textured, rigged, animation-ready 3D character. Give it a personality, a voice and skills, then talk to it. Publish it, embed it in a site with one line, or deploy it on-chain so your wallet holds it outright.

The interesting engineering is underneath. Signing happens in the phone's secure element through Mobile Wallet Adapter, so signing in is a single tap and the private key never enters the app process. There is no browser extension and no seed phrase to write down. For anyone who has watched a normal person try to use a crypto app for the first time, that is the entire difference.

Free to create, free to chat, free to browse. Open source, all of it.

https://three.ws/seeker
```

### TikTok, Reels, Shorts

On-screen hook, first frame, four words maximum:

```
An app store on a blockchain
```

Caption:

```
three.ws is live on the Solana dApp Store. Selfie in, rigged 3D character out, and it signs with the phone's secure element instead of a seed phrase. Free to try on Seeker and Saga.
```

Hashtags, on those three platforms only, never on X:

```
#solana #solanamobile #seeker #3d #ai #crypto
```

### Farcaster

```
three.ws is live on the Solana dApp Store.

Selfie to rigged 3D agent on the phone, signed by Seed Vault, yours on-chain when you want it.

three.ws/seeker
```

### Counts

X's arithmetic, not a character count: a URL costs 23 characters however long it
is, a newline costs one, and an `@handle` costs its literal length. Every X
block above fits inside 280, so the whole thread posts from a free account with
no long-post feature and no threading fallback.

| Block | X characters |
|---|---|
| Post 1, option A | 276 |
| Post 1, option B | 280 |
| Post 1, option C | 279 |
| Reply 1 | 273 |
| Reply 2 | 277 |
| Reply 3 | 263 |
| Reply 4 | 181 |

Re-run the count after any edit:

```bash
node marketing/seeker-launch/count-x.mjs
```

---

## 4. What stays out

- **$THREE.** The audience that installs an app from a video is not the audience
  that wants a ticker in the first line. If it goes anywhere it is a standalone
  reply at the end of a thread that is already working, never post 1.
- **The 1.1 widget.** What is on the store is 1.0. Announcing a home screen
  widget nobody can install is how the second announcement gets spent early.
- **Version numbers, release IDs, build hashes.** Nobody installing an app needs
  them.
- **"We are excited to announce."** The video is the announcement.
- **Any apology.** No "sorry for the wait", no "it took longer than we hoped".
  The post is a product landing, not a status update.

---

## 5. What counts as it having worked

Likes are not the metric. Check these at T+24 h and T+7 d:

- **dApp Store installs** in the Publisher Portal dashboard. This is the number
  the whole day was for.
- **`/seeker` sessions** from mobile, which is the tell for people who watched,
  had no Seeker, and went looking anyway.
- **New agents created** in the 48 hours after, against the prior week's daily
  average.
- **Quote posts over likes.** A launch video that gets explained by other people
  is one that travelled; a launch video that gets liked is one that scrolled.

If post 1 stalls under 5k views in the first hour, do not delete and repost.
Post the vertical cut to the other three platforms early and let the thread keep
its replies.
