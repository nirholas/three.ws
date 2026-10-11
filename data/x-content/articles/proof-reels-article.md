On 2026-09-29 a script opened three.ws/assembly and found a radial engine with nine cylinders. It dragged one slider, waited for the page to say 16.5 L, read the cylinder count again, and found five. Then it clicked a second machine, a steam locomotive, and pulled it apart with a keypress. The whole run was filmed while it ran: 477 frames, 15.9 seconds, stamped with the production commit f2081d946 that answered it.

That is what a feature video from three.ws is. It is not a screen recording of someone clicking around. It is a scripted test run against the live site, filmed as it runs. If any step of the run fails, no video is made, and the feature is not announced.

The rule exists because a fact check was not enough. A post can quote a page word for word and still describe a feature that does not do what the page says. A run that has to click, type and wait for the result cannot. This article follows that one engine reel through the whole pipeline: the steps it is written as, the camera that films it, the bar under the page, the facts it reads, the encoder, the record that binds it to its post, and the partners and open tools that make it possible. The numbers in it come from the code or from the record of a real run, and you can run the same commands yourself.

## A reel starts as a list of steps

A reel begins as a scenario: the steps a person would take, and what they would see if the feature worked. A step can goto a page, click a control by its visible text, hover, upload a file, type into a field, press a key, drag across the scene, scroll, wait, hold still, expect a text to appear, or read a fact off the screen with a pattern. Any step can also carry a caption, the one sentence that explains it to a viewer.

These are the steps behind the Machine Atlas reel, trimmed to the ones that carry its facts, exactly as they sit in the file:

```json
{ "goto": "https://three.ws/assembly", "settle": 8000 },
{ "read": "machines", "match": "(Two) machines" },
{ "read": "cylinders", "selector": "#ma-p-cylinders-out", "match": "(\\d+)" },
{ "read": "displacement", "match": "Displacement\\s*([\\d.]+ L)" },
{ "hold": 1600, "caption": "No model file. This engine is computed when the page loads." },
{ "drag": [[0.8806, 0.278], [0.7, 0.278]], "ms": 1500,
  "caption": "Change a dimension and the geometry is rebuilt: nine cylinders to five" },
{ "expect": "16.5 L" },
{ "read": "cylindersAfter", "selector": "#ma-p-cylinders-out", "match": "(\\d+)" },
{ "click": "Coupled Six", "caption": "The second machine is a steam locomotive, built the same way" },
{ "expect": "Outside-cylinder steam locomotive" },
{ "expect": "Solved four-bar chain, not baked animation" },
{ "press": "e", "caption": "Pull it apart. Every part is its own geometry." }
```

The run reads the cylinder count before the drag and after it. On the filmed run it read 9, then 5, and it waited for the new displacement before it went on. A step that waits for text which appears on success, and not before, is the difference between a test and a tour: the engine's name is on the page before anyone touches it, the new displacement is not.

One list of steps does four jobs at once. It is the probe, because each step must pass against the live product. It is the video, because the run is filmed. It is the captions, because a step carries the sentence that explains it. And it is the evidence, because what the run read off the screen, what it waited for and what the server answered are the facts a claim may cite.

## Steps find controls the way a person does

A person clicks a button because of what it says, so a step names a control by its visible text. When several controls could match, exact names are tried before partial ones. That rule came from a reel in which the word Search was about to resolve to a button called Clear search that sat earlier in the page. With exact names tried before partial ones, a step lands on the control a viewer would expect it to.

A control that is about to appear is waited for on the page's own clock, which is filmed, so the viewer sees the same second pass that the run did. An action can also name the request it has to cause. When the Drive reel types a question to an agent, the run waits for the chat request to answer, and an error fails the run. The record of that run says the chat endpoint answered 200, in 6.8 seconds.

## The page clock is stepped, not recorded

The machine that films has no GPU. A headless browser renders WebGL in software at one to three frames a second, and a screen recorder pads that out by repeating frames, which is why an early clip of ours read as a slide show.

So the camera takes over the page's clock. It advances the clock by one frame, a thirtieth of a second, takes a picture, and repeats. Each frame of a reel is a distinct frame at 1/30 s of page time, however long the machine took to draw it. On the galaxy page, recording in real time gave 1.3 distinct frames a second; stepping gave 30.

![Four frames from the Machine Atlas reel, half a second of page time apart, while the cylinder slider is dragged down and the engine is rebuilt with fewer cylinders](/x-media/proof-reels-article/reel-frames.png)

The other half of the fix was to composite the page itself on the CPU. Without that, the page went through the same software graphics device as the 3D scene, and one frame of a plain list page measured 3.5 to 15 seconds. With it, the 3D scene still renders in software exactly as before, and the page around it stops being the slow part: the same frame takes about 250 ms.

The speed of the machine decides how long filming takes, not how the reel looks. The holographic sticker reel is 18.13 seconds and 544 frames long. One drag in it is 84 frames, 2.8 seconds of reel, and took 90 seconds to film.

## The browser is set up to make that possible

The whole arrangement comes down to a short list of browser flags. WebGL runs on ANGLE with the SwiftShader software device, and the two last flags move the page's own compositing and rasterising off the graphics device:

```js
const BROWSER_ARGS = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-gpu-compositing', '--disable-gpu-rasterization',
];
```

The output sizes are fixed too. A small logical viewport is deliberate: the page lays out for a small screen, so its text and controls come out large in the final frame and stay readable in a phone timeline. Three formats are built in, each a page size, a bar height under it and a device scale:

| Format | Page | Bar | Scale | Output |
|---|---|---|---|---|
| landscape | 1024 x 576 | 80 | 1.25 | 1280 x 720 |
| square | 720 x 720 | 104 | 1.5 | 1080 x 1080 |
| portrait | 540 x 675 | 108 | 2 | 1080 x 1350 |

The Machine Atlas reel is landscape, which is why its record says 1280 by 720 at 30 frames a second.

## What the bar under the page says

Nothing is drawn over the product except the pointer, because a viewer needs to see what was clicked. Captions, a badge for cut waits, and a stamp sit in a bar under the page. The stamp names the site, the production commit that answered, read from the site's own version endpoint, and the day the reel was filmed.

![A frame from the Machine Atlas reel: the engine rebuilt with five cylinders and the slider reading 5, with the caption and the stamp naming the production commit and date in the bar below the page](/x-media/proof-reels-article/reel-stamp.png)

The pointer lives in a closed shadow root hung off the page's root element, so the page's own text queries do not see it and a framework that replaces the page body does not remove it. A caption cannot hide a control, and a viewer does not have to wonder what was behind one.

![A frame from the holographic sticker reel: a word die-cut into a sticker with a neon foil, the Neon foil option selected beside it, and the bar below naming the production commit b4eb6de7a and the day 2026-10-01](/x-media/proof-reels-article/reel-sticker.png)

## Waiting is cut, and labelled

Waiting is not filmed. Anything that waits on the network runs on the real clock while the camera is off. If a wait lasts two seconds or more, the reel says so: a badge such as cut 6 s appears in the bar for the next second and a half. A slow feature is labelled as slow rather than hidden.

![A frame from the Drive reel, where the agent has started answering a question out loud, with the badge reading cut 6 s beside the stamp because the reply took that long to arrive](/x-media/proof-reels-article/reel-cut.png)

The Drive reel shows it at work. Its record lists two cuts, 3.9 seconds and 6.3 seconds, around the moment the agent's reply is on its way, and the reel is 13.4 seconds long. A viewer sees a short, watchable clip and an honest label for the time that was left out.

Here is the Drive run, step by step, as its record lists it. The ms column is how long each step took the machine, and frames is how much of the reel it became:

| Step | Kind | Target | What the run recorded | ms | Frames |
|---|---|---|---|---:|---:|
| 1 | goto | the Drive page | loaded the page | 11198 | 0 |
| 2 | expect | Ready | appeared after 0.6 s | 563 | 0 |
| 3 | hold | 1800 | 1800 ms | 25386 | 54 |
| 4 | hover | Driving | hovered | 8649 | 18 |
| 5 | hold | 1200 | 1200 ms | 17696 | 36 |
| 6 | click | Driving | clicked | 10015 | 21 |
| 7 | expect | Parked | appeared after 0.0 s | 7 | 0 |
| 8 | click | Type | clicked | 10547 | 21 |
| 9 | type | What should I listen to on a long drive? | typed 40 characters | 48143 | 96 |
| 10 | press | Enter | pressed Enter; the chat endpoint answered 200 in 6.8 s | 7222 | 6 |
| 11 | expect | Speaking | appeared after 6.4 s | 6404 | 0 |
| 12 | hold | 5000 | 5000 ms | 78060 | 150 |

Typing the question took the machine 48.1 seconds and became 96 frames, 3.2 seconds of reel, so the viewer reads the question at the pace of a person typing. Steps 2, 7 and 11 wait for the page's own words, Ready, Parked and Speaking, to appear, so the film shows the agent actually answering and not a timer running out.

Captions are measured, not counted. Before anything is filmed, each caption is set in the real bar, beside the longest stamp and the longest badge it could share the line with, and a caption that would be cut off is refused by name. We added that check after reels were filmed with captions that ended mid-sentence, and it means each caption in a reel is read in full.

## Facts come from the run, and are checked again

A number in a post has to sit inside a claim, and the strongest claim is one the run read off the screen. The record of each run keeps each step, each fact read, each request awaited and each wait that was cut, together with a hash of the scenario and of the video. Change a step or swap the file and the post no longer validates. A record also expires after 14 days, because the product moves.

This is a real excerpt of the record behind the engine reel:

```json
{
  "id": "machine-atlas",
  "ranAt": "2026-09-29T08:08:23.156Z",
  "target": { "commit": "f2081d946", "revision": "three-ws-api-00460-4j6" },
  "passed": true,
  "facts": { "machines": "TWO", "cylinders": "9", "displacement": "29.7 L", "cylindersAfter": "5" },
  "saw": ["16.5 L", "Outside-cylinder steam locomotive", "Solved four-bar chain, not baked animation"],
  "video": { "frames": 477, "durationSec": 15.9, "width": 1280, "height": 720, "fps": 30,
             "videoCodec": "h264", "pixFmt": "yuv420p" }
}
```

When a post is reviewed, the scenario runs again without the camera. A fact the post states exactly has to read the same as the reel shows. A fact stated as a floor has to stay at or above it, so a count that keeps growing does not send a true post back to the studio. A fact no claim cites may move freely, because the reel is stamped with the day it was filmed. If a rule breaks, the post goes back to be filmed again. A post that states a count can also carry a check that runs again seconds before it is sent.

The editor that reviews a post cannot watch video, so it is given four frames from the reel spread through its length, the captions in order, and the record of the run, and asked whether each caption is true of the frame under it.

## From frames to a clip X plays at once

Frames are written as pictures, then encoded in one pass into a clip made for X: H.264 high profile, yuv420p, a constant frame rate, and the file's index placed at the front so the clip starts playing before it has finished downloading. The encoder then reads the finished file back, and the record stores its codec, pixel format, size, frame count and SHA-256, so the proof describes the exact bytes that get posted.

```bash
ffmpeg -framerate 30 -i f%06d.jpg \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -profile:v high -preset slow -crf 19 \
  -pix_fmt yuv420p -r 30 -movflags +faststart -an reel.mp4
```

## What the camera holds itself to

A reel has to meet a short list of standards before it exists, and each one protects the person watching:

- **A run with a failed step has no video.** The camera saves a picture of the page at the moment the step failed, so the failure can be looked at rather than guessed at.
- **A reel has to move.** If fewer than 15% of its frames change, the reel does not validate. It is a still with a progress bar, and a still image is the honest format for it. The Machine Atlas, Drive and holographic sticker reels all record full motion.
- **A caption has to fit,** as above.
- **A browser has to draw emoji.** Before filming, the camera draws a waving hand emoji into a small canvas and counts the coloured pixels. A machine without a colour emoji font draws empty boxes, and a reel filmed there would show a page broken where it is not. So the camera checks beforehand, and says which font to install.
- **An uploaded file has to be the same file.** A scenario that uploads a file records its SHA-256, so a reel is paired with the input it filmed and no other.

## A reel is a dated receipt

Taken together, a reel is a receipt. It says that these steps passed on this commit on this day, with the facts the run read and the requests the server answered. The stamp shows the commit and the day in the corner of each frame, and the 14 day expiry keeps the receipt fresh: as the product moves, the feed carries reels that were filmed against what is live now.

A scenario checks what reaches the screen or the network, which is exactly what a person using the feature experiences. A camera flying across a map adds no text, so a visual result is proven by the request that caused it. The camera needs a browser and ffmpeg, so reels are made where posts are reviewed, and production reads the record without filming. The result is a split of duties that keeps the live service light and the evidence strong.

## Try it on your own feature

The commands that make a reel are three:

```bash
npm run x:content -- scout https://three.ws/galaxy --format square   # what the page offers a scenario
npm run x:content -- prove galaxy-search                             # run it, film it, record the proof
npm run x:content -- prove galaxy-search --no-film                   # run it without filming
```

`scout` lists the controls, fields, headings and number-bearing lines of a page, which is what a person would look for before writing a scenario. `prove` runs the steps, films them and writes the record. With `--no-film` the same steps run in a fraction of the time, which is the fast path a review uses to confirm that a feature still works and still shows the facts the reel shows.

## Open tools, credited

Filming stands on open software. Playwright, released under the Apache 2.0 licence, drives the browser and gives the camera its page clock. Chromium renders the page, with ANGLE and the SwiftShader software Vulkan device carrying the WebGL scene on machines without a GPU. FFmpeg and the x264 encoder turn the frames into H.264, shipped through the ffmpeg-static package. The step runner, the camera and the proof record live in one module of the three.ws repository, so the method can be read in full.

## The partners behind the reels

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as it stands. The full map is at [three.ws/partners](https://three.ws/partners).

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. The features these reels film are the ones that run on NVIDIA silicon: text to 3D, photo to avatar, auto-rigging and motion capture, plus the free hosted NIM lane behind the forge. The reel camera itself films them in software, so the same run works on a machine with no GPU at all.

**Google Cloud.** Google Cloud powers three.ws inference, storage and real-time serving. Each reel's record names the Cloud Run revision that answered the run, shown in the excerpt above for the engine reel, and Vertex AI brings Gemini models to agents alongside the three.ws identity layer.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools, including a look at the finished model from several angles, which is the same habit this pipeline applies to its own reels: judge the result from the frames, not from the description.

**IBM.** three.ws lists IBM in the Strategic tier of its partner map. Agent identity on three.ws integrates with IBM watsonx and IBM Granite, so the agents a reel like Drive films can run on enterprise models behind a single agent profile.

**Amazon Web Services.** three.ws is deployed on AWS infrastructure with Marketplace availability, so enterprises can provision three.ws agent capabilities through their existing AWS billing, with support for VPC deployment and IAM-integrated access control.

**Alibaba Cloud.** Alibaba Cloud extends three.ws into APAC markets with Qwen model integration and regional MCP server deployment, so agents reach audiences with low-latency inference close to users in Asia.

**Quicknode.** three.ws is a member of the Quicknode Startup Program with approved infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind live Solana market data.

**HackerNoon.** three.ws has a builder-focused publishing partnership with HackerNoon: feature articles, tutorials and developer guides for people shipping with AI, published to HackerNoon's developer audience. The method in this article is the kind of build note that audience reads.

## Try it

The engine from the reel is live at [three.ws/assembly](https://three.ws/assembly): change a dimension and watch it rebuild. The holographic sticker is at [three.ws/holo](https://three.ws/holo), and the galaxy page the commands above use is at [three.ws/galaxy](https://three.ws/galaxy). The full pipeline, with the proof record format and the review rules, is documented in the repository's content pipeline guide. Production's own version endpoint, the one each stamp reads, is at [the version endpoint](https://three.ws/api/version).
