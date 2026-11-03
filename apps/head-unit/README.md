# three.ws head unit

An open head unit for the car: a real CarPlay or Android Auto session, projected by a
Carlinkit CPC200 USB dongle, on the driver's side of the screen, with the three.ws
`/drive` agent standing beside it at full size. It runs on a Raspberry Pi 4 or 5, or any
Linux box with a touch screen and Chromium.

This is lane D in [docs/carplay.md](../../docs/carplay.md). Apple gives a conversational
CarPlay app no drawing surface, so the agent as the face of the car is only possible on a
display we own. Here the phone projects into our page instead of the car owning the
screen, and the two halves share it.

**Hardware status:** everything up to the USB boundary is built and tested. No dongle
has touched this code yet. The owner's [first connection checklist](#first-connection-checklist)
is the remaining step.

## How it fits together

```
 phone  ──USB or Wi-Fi──▶  CPC200 dongle  ──USB──▶  src/dongle.js  (node-carplay DongleDriver)
                                                        │ onVideo / onAudio / onPhone
                                                        ▼
                                                  src/session.js   disconnected / probing / connected / error
                                                        │
                                                        ▼
                                                  src/server.js    127.0.0.1:7300, HTTP + /ws
                                                        │ H.264 + PCM (binary), state (JSON)
                                                        ▼
 Chromium kiosk  ◀──  public/index.html  ──  WebCodecs canvas  │  iframe: three.ws/drive?surface=headunit
```

- **`src/dongle.js`** is the only file that touches USB. It wraps node-carplay's
  `DongleDriver` behind one interface: `open()`, `close()`, `onVideo`, `onAudio`,
  `onPhone`, `onFailure`, `sendTouch(x, y, action)`, `sendKey(name)`. With no dongle on
  the bus, `open()` throws `DongleAbsentError`.
- **`src/session.js`** is the connection state machine. `disconnected` re-probes every
  3 s; `probing` is the dongle's reset and handshake; `connected` carries the phone (or
  `null` until one plugs in); `error` backs off 2, 4, 8, up to 30 s and accepts a manual
  retry. Errors explain themselves: `LIBUSB_ERROR_ACCESS` names the udev rule,
  `LIBUSB_ERROR_BUSY` names the process holding the dongle.
- **`src/server.js`** binds to loopback only. It serves `public/`, `GET /api/state`,
  `POST /api/retry`, and a WebSocket at `/ws`. Video and PCM go out as binary frames
  (`public/wire.js`); state, phone and audio-command events go out as JSON. A client
  that falls more than 4 MB behind skips video frames instead of growing a queue.
- **`public/`** is the page. The projection decodes Annex B H.264 with WebCodecs (the
  codec string comes from the stream's own SPS, `public/h264.js`), plays each audio
  stream through its own Web Audio gain so the phone's volume ducking works, and
  forwards pointer input as normalised touches. The agent half is an iframe of
  `/drive?surface=headunit`. Every state has its own panel: the "Connect a CarPlay dongle"
  empty state with the USB ids it is looking for, opening, error with retry, dongle
  ready without a phone, waiting for the first picture, browser cannot decode, service
  not running, and agent offline.

The phone screen sits on the driver's side: left for a left-hand-drive car, right for
right-hand drive (`HAND_DRIVE=rhd`). **Swap sides** flips it and remembers the choice.

## node-carplay

Pinned to exactly `node-carplay@4.1.0` (with `usb@2.19.1` underneath), from
[rhysmorgan134/node-CarPlay](https://github.com/rhysmorgan134/node-CarPlay). Its LICENSE
file, read before adoption:

> MIT License
>
> Copyright (c) 2022 Rhys Morgan
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

GPL projects (OpenAuto, aasdk) are deliberately not used. Fixes we need in node-carplay
go upstream as pull requests.

### Where the API differs from the plan

The plan assumed a single high-level object. node-carplay's `CarplayNode` class is that
object, but it cannot back an honest state machine: it runs its own reconnect loop,
reports no "dongle absent" or "error" state, and decodes nothing itself. So the adapter
drives the lower-level `DongleDriver` directly, the same sequence `CarplayNode` uses:

1. Find the dongle by its ids (`DongleDriver.knownDevices`); none means `DongleAbsentError`.
2. Open it and `reset()` it, then wait 3 s while it re-enumerates. The dongle needs this
   reset every time; skipping it is the usual cause of a silent session.
3. Find and open it again, `initialise()`, then `start(settings)` with the projection
   size, fps, dpi, hand-drive side, night mode and box name.
4. After 15 s, send `wifiPair` so a phone that pairs over Bluetooth joins over Wi-Fi.
5. For a CarPlay phone, request a `frame` on an interval so a new viewer gets a keyframe.

The phone's microphone path (Siri, calls) uses node-carplay's `NodeMicrophone`
(`arecord`), created only when the phone starts a Siri or call session.

## Configuration

Every setting is an environment variable, validated at boot. A bad value refuses to start
with a message that names it.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback: the page drives the car's phone. |
| `PORT` | `7300` | HTTP and WebSocket port. |
| `DRIVE_URL` | `https://three.ws/drive?surface=headunit` | The agent half. Must be https, or a loopback dev server. `surface=headunit` is added if missing. |
| `HAND_DRIVE` | `lhd` | `lhd` puts the phone on the left, `rhd` on the right. Also sent to the phone. |
| `PROJECTION_WIDTH` / `PROJECTION_HEIGHT` | `800` / `600` | The screen size the phone is told it is drawing for. |
| `PROJECTION_FPS` | `30` | Requested frame rate. |
| `PROJECTION_DPI` | `160` | Requested density. Higher makes CarPlay's own UI smaller. |
| `NIGHT_MODE` | off | `1` or `true` asks the phone for its dark theme. |
| `BOX_NAME` | `three.ws` | The Bluetooth name the phone pairs with. |
| `MICROPHONE` | on | `off` disables the box microphone for Siri and calls. |

## Run it

```sh
cd apps/head-unit
npm install
npm start            # http://127.0.0.1:7300/
npm test             # node:test, no hardware needed
```

With no dongle plugged in, the page shows "Connect a CarPlay dongle" with the ids
`1314:1520` and `1314:1521` and re-checks every 3 s. That is the real behavior without
hardware, not a demo mode.

To work on the agent half locally, run the repo's dev server and point at it:

```sh
npx vite --port 5391 --strictPort                       # from the repo root
DRIVE_URL=http://localhost:5391/drive npm start          # from apps/head-unit
```

`node scripts/verify-head-unit-page.mjs http://127.0.0.1:7300/ <dir>` (from the repo
root) opens the page in Chromium at desktop and phone widths, checks the empty state and
the console, and saves screenshots.

**Framing the production agent:** `/drive` sends `frame-ancestors` that allow
`http://localhost:*` and `http://127.0.0.1:*` (see `vercel.json`, tested in
`tests/drive-head-unit-framing.test.js`). Until that change is deployed, the default
`DRIVE_URL` shows the agent pane blank in the iframe; point `DRIVE_URL` at a local dev
server in the meantime.

### Tests

- `tests/session.test.js`: the state machine end to end against a recorded dongle
  session: absent, probing, connected with phone, video, PCM, volume and command
  messages, touch and key bytes sent back, failure with backoff, permission errors,
  reconnect after replug.
- `tests/h264.test.js`: NAL parsing, the SPS codec string and keyframe detection on real
  libx264 output (`tests/fixtures/testsrc-baseline.h264`), and the wire format.
- `tests/server.test.js`: the real HTTP server and WebSocket with an empty USB bus,
  control-message validation, and config validation.

The dongle fixture (`tests/fixtures/dongle-session.json`) is built by
`scripts/record-fixture.mjs` from the message values in node-carplay's own test suite
(commit `670f19e`), serialised with node-carplay's own `MessageHeader`, so the bytes are
the dongle protocol, not invented ones. Only the USB transport is replaced, at the
`webusb` boundary.

## Raspberry Pi runbook

Status: written against Raspberry Pi OS conventions and not yet run on a Pi. `kiosk.sh`
passes `sh -n`; the udev rule and the systemd unit have not been loaded anywhere.
Target: Raspberry Pi OS (Bookworm, desktop) on a Pi 4 or 5, official 7" touch display or
any HDMI touch screen, the CPC200 on a USB port (a powered hub if the Pi browns out).

1. **Base packages.**
   ```sh
   sudo apt update
   sudo apt install -y git curl chromium-browser alsa-utils
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. **Code.**
   ```sh
   git clone https://github.com/nirholas/three.ws ~/three.ws
   cd ~/three.ws/apps/head-unit && npm install --omit=dev
   ```
3. **USB access without root.** The udev rule grants the desktop user and the `plugdev`
   group access to both CPC200 ids.
   ```sh
   sudo cp deploy/99-carlinkit.rules /etc/udev/rules.d/
   sudo udevadm control --reload && sudo udevadm trigger
   sudo usermod -aG plugdev,audio "$USER"     # then log out and back in
   ```
4. **Settings (optional).** `~/.config/three-ws/head-unit.env`, one `KEY=value` per line,
   for example `HAND_DRIVE=rhd` or `PROJECTION_WIDTH=1024`.
5. **Auto-start the service.**
   ```sh
   mkdir -p ~/.config/systemd/user
   cp deploy/three-ws-head-unit.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now three-ws-head-unit
   sudo loginctl enable-linger "$USER"
   journalctl --user -u three-ws-head-unit -f    # state changes are logged here
   ```
6. **Kiosk browser on login.** `deploy/kiosk.sh` waits for the service, then opens
   Chromium full screen with autoplay allowed (projected audio needs it) and the
   microphone prompt pre-answered (a touch kiosk cannot click it).
   ```sh
   mkdir -p ~/.config/autostart
   cp deploy/three-ws-kiosk.desktop ~/.config/autostart/
   ```
   Enable desktop auto-login in `sudo raspi-config` (System, Boot / Auto Login), then reboot.

To leave the kiosk, press Alt+F4 on a keyboard, or `pkill chromium` over SSH.

## First connection checklist

For the owner, with the hardware in hand. Nothing below has been verified; each line is
the first time it is tried.

- [ ] `lsusb` lists `1314:1520` or `1314:1521` with the CPC200 plugged in. Another id
      means a different dongle model: add it to `DongleDriver.knownDevices` upstream.
- [ ] The page moves from "Connect a CarPlay dongle" to "Opening the dongle" to "Dongle
      ready. Connect your phone." within about 10 s. If it lands on the error panel
      with a permission message, the udev rule is not applied (step 3).
- [ ] An iPhone on the dongle's cable shows CarPlay on the left pane within about 15 s;
      the status pill reads CarPlay.
- [ ] Taps land where you touch: open Maps, scroll a list, press and hold an icon.
- [ ] **Home** in the top bar returns to the CarPlay home screen.
- [ ] Music plays through the box's speakers; a navigation prompt ducks it and it comes
      back.
- [ ] "Hey Siri" (or a long press on the CarPlay home button) answers through the box
      microphone. If not, check `arecord -l` lists a capture device.
- [ ] Unplug the phone: the pane returns to "Connect your phone". Unplug the dongle: it
      returns to "Connect a CarPlay dongle", then reconnects when plugged back in.
- [ ] Wireless: pair the phone over Bluetooth with "three.ws" (or your `BOX_NAME`); after
      pairing it joins over Wi-Fi and the pill reads "CarPlay (Wi-Fi)".
- [ ] An Android phone with Android Auto shows Android Auto the same way.
- [ ] The agent pane beside it loads `/drive`, listens, and answers while CarPlay keeps
      running.
- [ ] Note the Pi model, display, dongle firmware (the service logs it on connect) and
      anything that failed, and send it back so the next pass can fix it.
