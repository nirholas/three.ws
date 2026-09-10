# Sonar: acoustic gesture control

Every laptop already ships a motion sensor. It is the speaker and the microphone.

Play a tone above human hearing, and a hand moving in front of the machine reflects it back **frequency-shifted**: higher as the hand closes in, lower as it pulls away. That is the Doppler effect, the same thing that drops the pitch of a passing siren, and it is enough to read a sweep, a push and a lift with no camera, no permissions beyond the microphone, and no model weights.

Try it at **[three.ws/sonar](https://three.ws/sonar)**, where the three gestures drive a real 3D agent. This page is the developer reference: the two modules, their surface, and what they will and will not do.

- The live page: [/sonar](https://three.ws/sonar)
- The gestures a sweep steps through: [/gestures](https://three.ws/gestures)
- Putting an agent on your own site: [Embedding](embedding.md)

---

## Where this comes from

The technique is [SoundWave](https://www.microsoft.com/en-us/research/project/soundwave-using-the-doppler-effect-to-sense-gestures/) (Gupta, Morris, Patel and Tan, CHI 2012). The analysis and the three detectors here are ported from [Sonar](https://github.com/nirholas/sonar.cool), Emanuel Perez's MIT-licensed macOS implementation of that paper, with [Daniel Rapp's Doppler](https://github.com/DanielRapp/doppler) as the prior art for doing it in a browser at all.

The port is deliberate about staying close: the transform size, the analysis window, the calibration period and every detector threshold are reproduced exactly, because each one is a tuning result rather than a taste. `tests/sonar-gestures.test.js` drives the detectors with the same synthetic frames the Swift suite uses, so a future edit that "cleans up" a constant fails there.

---

## The two modules

Neither module touches the DOM or three.js. They are usable anywhere in the browser.

### `src/sonar/doppler.js`: the sensor

```js
import { DopplerSensor, DIRECTION, isSupported } from '/src/sonar/doppler.js';

if (!isSupported()) throw new Error('No Web Audio microphone input here.');

const sensor = new DopplerSensor({
  onReading: (r) => {
    if (r.direction === DIRECTION.approaching) console.log('hand closing in');
  },
});

await sensor.start(); // prompts for the microphone
// later
sensor.stop();
```

| Option | Default | Meaning |
| --- | --- | --- |
| `tone` | `20000` | Carrier in Hz. |
| `amplitude` | `0.08` | Speaker level for the carrier, 0 to 1. |
| `autoTone` | `true` | Measure every candidate in `TONE_CANDIDATES` against this machine's own hardware on start and keep the one that comes back loudest. |
| `onReading` | none | Called once per analysis frame with a `Reading`. |
| `onStatus` | none | Called with `{state, message}` at `starting`, `tuning`, `calibrating`, `stopped`. |

Methods: `start()`, `stop()`, `setTone(hz)`, `setAmplitude(0..1)`, `recalibrate()`.

Why `autoTone` exists: laptop speakers roll off hard near the top of their range, and every model rolls off somewhere different. A carrier the speakers cannot actually project reads exactly like a room with nothing moving in it, which is indistinguishable from a broken sensor. Measuring first turns a mystery into a number.

### The `Reading`

One per frame, at the same 2048-sample hop the desktop app uses.

| Field | Meaning |
| --- | --- |
| `direction` | One of the `DIRECTION` values: `approaching`, `away`, `mixed`, `still`, `listening`, `calibrating`, `weak-tone`. |
| `strength` | Sideband energy that was not in the still room, over the carrier. Above `0.0003` is motion. |
| `snr` | Carrier minus noise floor, in dB. Below 15 the tone is not usable and every detector stands down. |
| `waveBands` | Eight log-compressed bands across the analysis window. The lower four are recession, the upper four approach; their balance is what makes a sweep readable. |
| `spectrumDb` / `baselineDb` | The window and the still-room reference, both in dB. Draw them to see the shift with your own eyes. |
| `calibrationRemaining` | Seconds left of the 2.5 s baseline measurement, then `null`. |
| `carrierDb`, `binWidth`, `firstFrequency`, `sampleRate`, `tone`, `opposedStrength` | Enough to label an axis and to reason about a bad reading. |

### `src/sonar/gestures.js`: the detectors

Three pure state machines over Readings plus a clock. No audio, no DOM.

```js
import { SwipeDetector, PushPullDetector, LiftMotion } from '/src/sonar/gestures.js';

const swipe = new SwipeDetector();
const sensor = new DopplerSensor({
  onReading: (r) => {
    const event = swipe.feed(r, performance.now() / 1000);
    if (event === 'next') nextSlide();
    if (event === 'previous') previousSlide();
  },
});
```

| Detector | Call | Emits |
| --- | --- | --- |
| `SwipeDetector` | `feed(reading, now)` | `'next'`, `'previous'` or `null` |
| `PushPullDetector` | `feed(reading, now, reversed)` | `3` on the push, `-1` per step of the return, `0` on the step that lands back at rest, else `null` |
| `LiftMotion` | `feed(reading, now)` then `step(dt, now)` per frame | distance travelled this frame |

`SwipeDetector` needs a pause between sweeps, and that is not a limitation to design around, it is the physics. The microphone senses distance, not direction: a sweep registers as one coherent approach followed by its retreat. The detector takes the first coherent lobe and suppresses the return for 650 ms, which is exactly what stops one wave from firing two navigations.

`PushPullDetector` paces the return by reading how far the reflected energy sits from the carrier, so a quick pull snaps back and a slow one eases. A push while already pushed is ignored rather than stacked.

`LiftMotion` is continuous rather than discrete: `feed()` sets a target from the returned energy, `step()` eases toward it and returns the distance for that frame. It bridges a couple of uncertain frames on purpose, so a momentary misread mid-lift does not drop the motion. `switchDirection()` flips which way a lift travels and drops the motion in flight with it, rather than reversing a camera that is still moving under the hand; `reset()` clears the motion without changing the direction.

---

## Running more than one detector

They cross-trigger, and the fix is a mode rather than a filter.

A sweep passing the microphone looks like an approach followed by a retreat. So does a push followed by a pull. The hardware cannot separate them, so [/sonar](https://three.ws/sonar) makes the active gesture an explicit choice, with an **All three** setting that is honest about misreading more often. Build the same way: pick the gesture your surface needs, and only feed that detector.

---

## What it needs from the room

| Requirement | Why |
| --- | --- |
| Built-in speakers and microphone | Headphones break the reflection path. There is nothing for the tone to bounce off on its way back. |
| The volume up | The carrier has to reach the hand and return. A muted machine senses a still room forever. |
| A quiet-ish 20 kHz band | A nearby machine emitting in the same band raises the floor. The carrier picker routes around most of it. |
| Two and a half seconds of stillness at the start | Everything the microphone hears during calibration becomes the baseline that a hand is later measured against. Move during it and the room learns your hand as background. |

Cats and dogs hear near 20 kHz. Say so wherever you ship this, as [/sonar](https://three.ws/sonar) does.

---

## Privacy

The microphone stream is analysed in memory and never leaves the page: no recording, no upload, no storage. Only the frequency-domain magnitudes around the carrier are ever read, and the page keeps a hardware carrier choice and nothing else. Stopping releases the microphone track, which is what turns the browser's recording indicator off.

---

## On an embedded agent

Any `<agent-3d>` embed can be driven by hand. The attribute permits it; the page
starts it, because opening a microphone and putting a tone into someone's room is
the viewer's decision, not the embed's:

```html
<agent-3d agent-id="your-agent" sonar></agent-3d>
```

```js
const el = document.querySelector('agent-3d');
startButton.addEventListener('click', () => el.startSonar({ mode: 'swipe' }));
```

A sweep steps the agent through its gesture vocabulary, a push moves the camera
in and a pull eases it back out, a held lift turns the camera. Every recognised
gesture also fires a cancelable `sonar-gesture` event, so a host page can take
the gestures and do something else entirely with them:

```js
el.addEventListener('sonar-gesture', (e) => {
	e.preventDefault();
	if (e.detail.gesture === 'swipe') e.detail.direction > 0 ? nextSlide() : prevSlide();
});
```

Nothing of the sensing ships until `startSonar()` is called for the first time,
so an embed that never uses it pays nothing for the capability. The attribute,
the methods and the event detail are specified in
[Web component](./web-component.md#hand-control-no-camera).

---

## The shared controller

`src/sonar/controller.js` is the layer both surfaces sit on. It owns the sensor,
the three detectors, the mode arbitration and the reverse switches, and reports
what it read through callbacks. What a gesture *means* stays with the consumer.

```js
import { SonarController } from '/src/sonar/controller.js';

const sonar = new SonarController({
	mode: 'swipe',
	onSwipe: (direction) => (direction > 0 ? next() : previous()),
	onZoom: (action) => zoom(action),
	onTurn: (radians) => camera.orbitBy(radians),
});
await sonar.start();
```

| Member | Purpose |
| --- | --- |
| `start()` / `stop()` | Open and release the microphone. `stop()` is safe when nothing is running. |
| `setMode(mode)` | `'swipe'`, `'push'`, `'lift'` or `'all'`. Drops the stroke in flight, so a half-formed gesture cannot complete under the new mapping. |
| `setReversed(gesture, on)` | Flip a gesture's direction. `'lift'` reverses through the motion itself, so a held turn stops rather than snapping the other way. |
| `recalibrate()` | Re-measure the still room without restarting the microphone. |
| `feed(reading)` | Drive it from a Reading you already have. The sensor calls this for you; it is public so a recorded stream can be replayed through the same mapping, which is how `tests/sonar-controller.test.js` covers the mode and reverse behaviour with no microphone. |
| `GESTURE_CAST` | The ordered gesture slots a sweep walks through, shared so the page and an embed step the same cast. |

---

## Reusing it elsewhere

The modules ship in the frontend bundle and are plain ES modules with no dependencies beyond each other:

```js
import { DopplerSensor } from 'https://three.ws/src/sonar/doppler.js';
import { SwipeDetector } from 'https://three.ws/src/sonar/gestures.js';
```

Both are MIT, and so is the work they are ported from. Credit Sonar and the SoundWave paper if you build on them.
