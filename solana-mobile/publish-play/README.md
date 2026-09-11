# `publish-play/`: three.ws on Google Play

Everything the owner types or uploads into Play Console, kept in git so the console never
drifts from what was reviewed. The Solana dApp Store worksheet is next door in
[`../publish/`](../publish/); this is the Play twin of it.

**One app, one package id, two channels.** `ws.three.app` is the same APK content on both
stores. Do not fork the package name, and do not let the two listings describe different
products.

## The one decision that sets the timeline

Everything else here is a checklist. This is a fork in the road, and it is worth ten minutes
before anything is created.

| | Personal account | Organization account |
| --- | --- | --- |
| Requires | Government ID | A D-U-N-S number and business documents |
| Closed testing before production | **12 testers opted in continuously for 14 days** | **Exempt** |
| Realistic time to live | About 4 weeks | About 2 weeks, if the D-U-N-S already exists |
| The catch | The 14-day clock cannot be shortened or bought | A new D-U-N-S is free but can take up to 30 days |

The 12-tester rule applies to personal accounts created after 13 November 2023, per
[Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465).
Invited testers who never install do not count, the same twelve people can cover every future
app, and once an app has production access its updates never need testers again.

**Do this first:** look up three.ws at <https://www.dnb.com/duns/get-a-duns.html>. If a D-U-N-S
already exists or is issued immediately, take the organization account and skip fourteen days
of waiting. If it would take weeks, take the personal account and start the tester clock the
same day, because that clock is the critical path and nothing else in this file is.

## Steps

1. **Create the account** ($25 one time) and complete identity or business verification. Set
   `developer.account_type` in `config.yaml` to whichever you chose.
1a. **Device verification: do NOT use the Seeker that holds funds.** New personal
   accounts must prove access to a real Android device by signing into the Play
   Console mobile app on it. Any non-rooted physical device running Android 10 or
   newer qualifies, an emulator does not, and the check takes under a minute.

   Use a cheap dedicated handset, not the cold-storage Seeker. The Seed Vault is
   a secure element, so a Google account on the device cannot read the seed and
   no installed app can extract it. That is not the risk. The risk is that a
   Google account on the device enables Find My Device, so a compromise of that
   Google account can remotely wipe the phone, and a wipe with no offline seed
   backup is a permanent loss that never touched the secure element. The same
   compromise can push apps to the device from the web Play Store, which is the
   setup for an overlay attack against a signing prompt the owner does approve.
   A test device is needed for closed testing anyway.

   Organization accounts appear to skip this step along with the 12-tester rule;
   confirm it in the live flow before buying hardware.

2. **Create the app** with the title in `listing/title.txt` and the default language in
   `config.yaml`.
3. **Fill the App content forms.** Every answer is written down already: `listing/data-safety.md`,
   `listing/content-rating.md`, `listing/financial-features.md`. Read the blocking issue at the
   top of the data safety file before starting; it needs a privacy policy change that only the
   owner can approve, and Google cross-checks the two.
4. **Build the bundle.** Play takes an AAB, not an APK, and `scripts/build-apk.sh` already
   produces `build/app-release-bundle.aab` beside the APK. Our release key is the *upload* key
   here.
5. **Upload to the closed testing track** and roll it out. On a personal account this starts
   the 14-day clock, so do it before the store listing is polished, not after.
6. **Add Google's signing certificate to Digital Asset Links. This step is not optional and it
   has no local symptom.** Play App Signing is mandatory for new apps, so Google re-signs the
   bundle with its own key and a Play install presents *that* certificate, not ours. Copy the
   SHA-256 from **Test and release > Setup > App integrity > App signing key certificate** into
   [`../twa/extra-fingerprints.json`](../twa/extra-fingerprints.json), rerun
   `scripts/update-assetlinks.sh`, and deploy three.ws so the new statement file is live.
   Skip it and every Play user gets three.ws with the Chrome address bar across the top,
   while the dApp Store build stays perfect and nothing in local QA looks wrong.
7. **Verify on a device installed from Play**, not from `adb install`. `adb shell pm get-app-links ws.three.app`
   must report state 1, and the app must open with no address bar.
8. **Apply for production access** (personal accounts only) once twelve testers have been opted
   in for fourteen continuous days. Google's review of that application is usually under a week.
9. **Promote to production.**

## Graphics

Play's sizes are not the dApp Store's, so `../publish/media/` cannot be reused as-is.

| Asset | Size | Required |
| --- | --- | --- |
| App icon | 512 x 512, 32-bit PNG, no transparency | yes |
| Feature graphic | 1024 x 500 | yes |
| Phone screenshots | 2 to 8, between 320 px and 3840 px on each side, 16:9 or 9:16 | yes |
| 10-inch tablet screenshots | up to 8, between 1080 px and 7680 px on each side | optional, and Play ranks listings that have them higher |
| 7-inch tablet screenshots | up to 8, between 320 px and 3840 px on each side | same |

The icon at `../publish/media/icon.png` is already 512 x 512 and can be copied. The feature
graphic must be regenerated at 1024 x 500 (the dApp Store one is the same size, so check it
before rebuilding).

**The feature graphic slot rejects transparency.** Play takes a JPEG or a 24-bit PNG with no
alpha channel there, so `media/feature-1024x500.png` is flat on purpose and is the file that
goes in the console. For the surfaces that do want the lockup over their own background, two
transparent variants sit beside it:

```bash
node solana-mobile/scripts/make-media.mjs --target=play
# media/feature-1024x500-alpha-on-dark.png    white type
# media/feature-1024x500-alpha-on-light.png   dark type
```

Two of them, because ink cannot be transparent: a white wordmark over nothing disappears the
moment it lands on a light ground, and nothing in the render warns you, since on a dark canvas
it looks right. Pick the variant that matches the ground you are compositing over. Their
tagline is read from `listing/short-description.txt`, so the artwork cannot claim something the
store listing does not say.

Every screenshot on this listing is generated, not hand-captured:

```bash
node solana-mobile/scripts/make-screenshots.mjs --target=play         # media/phone/screen-1..5.png at 1080x1920
node solana-mobile/scripts/make-screenshots.mjs --target=play-tablet  # media/tablet/{10-inch,7-inch}/screen-1..5.png
```

Both targets capture the live site, compose the five panels as one continuous strip, and slice
it, so the uploads read as one photograph of a shelf of devices rather than five unrelated
stills. Upload the sliced panels in numerical order; `carousel.png` beside them is the master
strip and is not an upload. The tablet run is not the phone run upscaled: it drives the browser
at a 768 px viewport with the mobile flag off, so the frames hold the layout three.ws actually
serves a tablet, and any headline that names the hardware carries a `tabletTitle` override in
the script. One 1440x2560 composition serves both tablet slots, downscaled to 1260x2240 for the
7-inch one.

Neither target needs a device or an emulator. Unlike the dApp Store, Play does not require a
Seeker, and the two Seeker-specific frames (Seed Vault sheet, mint confirmation) are not
appropriate for a Play listing that ships to every Android phone anyway.

## What Play will reject

Read [`listing/financial-features.md`](listing/financial-features.md) before building anything
that touches money on this channel. Short version: three.ws passes review because it is not a
wallet and not an exchange, and adding an in-app wallet, an in-app swap, or a fiat on-ramp
would move it into a category that needs a jurisdictional license. Adding a paid tier inside
the Android build would pull in Play Billing.
