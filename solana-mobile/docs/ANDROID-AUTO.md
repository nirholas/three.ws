# three.ws Drive on Android Auto

The Android half of [`/drive`](../../docs/carplay.md). Read that document first: it explains
why the agent's 3D face is not on the car screen, and why the same page serves every lane.

This file covers the Android side only: what is in the overlay, why the category is what it
is, and how to run it.

## The one-paragraph version

Android has no conversational app category, and no drawing surface outside navigation. What
it does have is `androidx.car.app.category.IOT`, for apps that let people "take relevant
actions on connected devices from within the car", and that is exactly what a three.ws agent
does: the home tools wired into `/api/chat` reach a real house, with a safety gate that
freezes anything physical until a person approves it. So the car screen is four rows rendered
by Android Auto's template host, the conversation runs in a web view inside a foreground
service, and `DriveLink` is the wire between them.

## What is in the tree

Everything lives in [`../android-overlay/`](../android-overlay/README.md), which is laid over
the Bubblewrap-generated project on every build. File and resource names start with `drive`,
which is what keeps the overlay from ever colliding with a generated file.

| File | Role |
|---|---|
| `app/src/main/java/ws/three/app/drive/DriveCarAppService.java` | The `CarAppService`. Declares the IOT category and the production host allowlist. |
| `.../DriveSession.java` | One connection to the car; opens the screen. |
| `.../DriveScreen.java` | The four controls as a `ListTemplate`, plus the microphone-permission screen. |
| `.../DriveLink.java` | The channel: page state in, template presses out, everything marshalled to the main looper. |
| `.../DriveWebService.java` | The foreground service that hosts the web view running `/drive?surface=androidauto`. |
| `app/src/main/res/xml/drive_automotive_app_desc.xml` | `<uses name="template" />`, which is how Android Auto discovers the car app at all. |
| `app/src/main/res/values/drive.xml` | Every string on the car screen and in the notification. |
| `AndroidManifest.permissions.xml` | Appended: `RECORD_AUDIO`, the typed foreground-service permissions, `POST_NOTIFICATIONS`. |
| `AndroidManifest.application.xml` | Appended: `minCarApiLevel`, the automotive app descriptor, both services. |
| `build.gradle.fragment` | Appended: `androidx.car.app:app` and `app-projected`. |
| `../../src/drive/bridge.js` | The web half of the same protocol. Change one side, change both. |

## Why a foreground service with a web view

During a drive the phone screen belongs to Android Auto, so this app is a background process
by definition, and a background process may not hold the microphone. A typed foreground
service (`microphone|mediaPlayback`) is the only way to run the loop at all, and the
notification it requires is the honest price: the driver can see the agent is listening and
stop it in one tap.

The web view is never attached to a window, which has one consequence worth stating: no
window means no animation frames. `?surface=androidauto` tells the page so, and
[`src/drive/surface.js`](../../src/drive/surface.js) turns off the 3D stage for that surface
(`renders3d: false`). Audio, `fetch` and timers all keep running, and that is the whole
conversation. The mouth target is safe unattached, so the identical `TalkController` runs on
both surfaces with no branch inside it.

The same flag turns off the confirmation card (`canConfirm: false`). A person who cannot see
what they are approving is a recognizer being trusted with a lock, which the home safety
doctrine refuses outright, so a guarded action from Android Auto is spoken back as "approve
it on your phone" rather than taken.

## The protocol

Identical to CarPlay's, version 1. The page posts to the `ThreeWsDriveNative` JavaScript
interface; commands go back through `evaluateJavascript`. The table is in
[`ios/docs/CARPLAY.md`](../../ios/docs/CARPLAY.md) and both native sides implement it.

## Permissions and the first run

`RECORD_AUDIO` is a runtime permission and Android will only ever show its prompt on the
phone. `DriveScreen` checks it before starting anything; when it is missing the car screen is
a `MessageTemplate` with one action that calls `CarContext.requestPermissions`, which puts
the prompt on the phone and tells the driver to look at it. That is the documented path and
the only one that works from a car screen.

## Building and running it

```bash
cd solana-mobile/build
npx --no-install @bubblewrap/cli update --skipVersionUpgrade
node ../scripts/apply-overlay.mjs --project . --overlay ../android-overlay
JAVA_HOME=~/.bubblewrap/jdk/jdk-17.0.20.1+1 ./gradlew assembleDebug
```

To see it on a car screen, install the debug APK and run Google's **Desktop Head Unit**
(`$ANDROID_HOME/extras/google/auto/desktop-head-unit`) against the connected phone with
developer mode enabled in the Android Auto app. Unknown sources must be allowed there, or a
debug build never appears.

The web half alone needs no Android at all: `npm run dev`, then open
`http://localhost:3000/drive?surface=androidauto`. The 3D stage stays off, the loop runs, and
`window.threeWsDrive.command({ type: 'talk-start' })` in the console does exactly what a row
press does.

## Play Store posture

Distribution of a car app is gated on Google's [car app
quality](https://developer.android.com/docs/quality-guidelines/car-app-quality) review for
the declared category, on top of the normal listing. Two things follow:

- **The IOT claim has to stay true.** It is true today because the home lane is built and
  wired into `/api/chat` ([docs/smart-home.md](../../docs/smart-home.md)). If that lane were
  ever removed, the category would have to change with it.

## Android Automotive OS

AAOS runs the app on the head unit itself, so it ships as its own artifact: the `automotive`
product flavor. It reuses `DriveCarAppService`, `DriveSession`, `DriveScreen`, `DriveLink` and
`DriveWebService` unchanged; only packaging differs.

| Piece | What it does |
| --- | --- |
| `app/src/automotive/AndroidManifest.xml` | Merged over the main manifest for this flavor only. Requires `android.hardware.type.automotive` and the templates host, relaxes portrait, landscape, Wi-Fi and camera, swaps the Android Auto descriptor for `com.android.automotive`, declares `androidx.car.app.activity.CarAppActivity` as the one launcher (the only place `distractionOptimized` is set), and removes the phone entry points (TWA launcher, site settings launcher, home widget). |
| `app/src/automotive/res/xml/drive_aaos_app_desc.xml` | `<uses name="template" />`, which is how AAOS discovers a templated app. |
| `build.gradle.fragment` | Declares the flavor and `androidx.car.app:app-automotive:1.4.0` only when a task name mentions `automotive` or `-Pthreews.automotive=true` is passed, so the phone build output and APK path stay exactly as they were. The head unit build excludes `app-projected`, which collides with `app-automotive` on a manifest key. |

The page protocol is unchanged. The conversation runs in `DriveWebService`'s windowless web
view, which exposes `ThreeWsDriveNative`, so `src/drive/surface.js` already resolves the
surface to `androidauto` there: the 3D stage stays off and the confirmation card is refused.
No new `?surface=` value was needed.

Build (after `bubblewrap update`, then the overlay, with an absolute `--project` path):

```
node solana-mobile/scripts/apply-overlay.mjs --project /abs/path/to/generated --overlay solana-mobile/android-overlay
cd /abs/path/to/generated && ./gradlew :app:assembleAutomotiveDebug
./gradlew :app:assembleDebug   # the phone build, unchanged
```

Verified 2026-11-04 on a freshly generated Bubblewrap project (JDK 17, Gradle 8.11.1): both
`:app:assembleAutomotiveDebug` and `:app:assembleDebug` end in `BUILD SUCCESSFUL`. Not
verified: running on an Automotive emulator image or a real head unit. To do that, create an
"Automotive" AVD with the SDK manager, install the automotive APK, and launch the app from the
car launcher. Play distribution of an AAOS artifact needs a separate listing and Google's car
app quality review, which is an owner action.
