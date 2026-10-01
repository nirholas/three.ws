The feature videos in this feed are not screen recordings. Each one is a scripted test run against the live site, filmed while it runs. If any step of the run fails, no video is made, and the feature is not announced.

That rule exists because a fact check was not enough. A post can quote a page word for word and still describe a feature that does not do what the page says. A run that has to click, type and wait for the result cannot. Here is how a reel gets made, and what the camera refuses to film.

## A reel starts as a list of steps

A reel begins as a scenario: the steps a person would take, and what they would see if the feature worked. A step can goto a page, click a control by its visible text, type into a field, press a key, drag across the scene, expect a text to appear, or read a fact off the screen with a pattern. These are five of the steps behind the Machine Atlas reel, as they sit in the file:

```json
{ "goto": "https://three.ws/assembly", "settle": 8000 },
{ "read": "cylinders", "selector": "#ma-p-cylinders-out", "match": "(\\d+)" },
{ "drag": [[0.8806, 0.278], [0.7, 0.278]], "ms": 1500,
  "caption": "Change a dimension and the geometry is rebuilt: nine cylinders to five" },
{ "expect": "16.5 L" },
{ "read": "cylindersAfter", "selector": "#ma-p-cylinders-out", "match": "(\\d+)" }
```

The run reads the cylinder count before the drag and after it. On the filmed run it read 9, then 5, and it waited for the new displacement before it went on. A step that waits for text which appears on success, and not before, is the difference between a test and a tour: the engine's name is on the page before anyone touches it, the new displacement is not.

An action can also name the request it has to cause. When the Drive reel types a question to an agent, the run waits for the chat request to answer, and an error fails the run.

## The page clock is stepped, not recorded

The machine that films has no GPU. A headless browser renders WebGL in software at one to three frames a second, and a screen recorder pads that out by repeating frames, which is why an early clip of ours read as a slide show.

So the camera takes over the page's clock. It advances the clock by one frame, a thirtieth of a second, takes a picture, and repeats. Every frame of a reel is a distinct frame at 1/30 s of page time, however long the machine took to draw it. On the galaxy page, recording in real time gave 1.3 distinct frames a second; stepping gave 30.

![Four frames from the Machine Atlas reel, half a second of page time apart, while the cylinder slider is dragged down and the engine is rebuilt with fewer cylinders](/x-media/proof-reels-article/reel-frames.png)

The other half of the fix was to composite the page itself on the CPU. Without that, the page went through the same software graphics device as the 3D scene, and one frame of a plain list page measured 3.5 to 15 seconds. With it, the 3D scene still renders in software exactly as before, and the page around it stops being the slow part.

The speed of the machine decides how long filming takes, not how the reel looks. The holographic sticker reel is 18.13 seconds and 544 frames long. One drag in it is 84 frames, 2.8 seconds of reel, and took 90 seconds to film.

## What the bar under the page says

Nothing is drawn over the product except the pointer, because a viewer needs to see what was clicked. Captions, a badge for cut waits, and a stamp sit in a bar under the page. The stamp names the site, the production commit that answered, read from the site's own version endpoint, and the day the reel was filmed.

![A frame from the Machine Atlas reel: the engine rebuilt with five cylinders and the slider reading 5, with the caption and the stamp naming the production commit and date in the bar below the page](/x-media/proof-reels-article/reel-stamp.png)

Waiting is not filmed. Anything that waits on the network runs on the real clock while the camera is off. If a wait lasts two seconds or more, the reel says so: a badge such as cut 6 s appears in the bar for the next second and a half. A slow feature is labelled as slow rather than hidden.

![A frame from the Drive reel, where the agent has started answering a question out loud, with the badge reading cut 6 s beside the stamp because the reply took that long to arrive](/x-media/proof-reels-article/reel-cut.png)

Captions are measured, not counted. Before anything is filmed, each caption is set in the real bar, beside the longest stamp and the longest badge it could share the line with, and a caption that would be cut off is refused by name. We added that check after reels were filmed with captions that ended mid-sentence.

## Facts come from the run, and are checked again

A number in a post has to sit inside a claim, and the strongest claim is one the run read off the screen. The record of each run keeps each step, each fact read, each request awaited and each wait that was cut, together with a hash of the scenario and of the video. Change a step or swap the file and the post no longer validates. A record also expires after 14 days, because the product moves.

When a post is reviewed, the scenario runs again without the camera. A fact the post states exactly has to read the same as the reel shows. A fact stated as a floor has to stay at or above it. If either rule breaks, the post goes back to be filmed again. A post that states a count can also carry a check that runs again seconds before it is sent.

The editor that reviews a post cannot watch video, so it is given four frames from the reel, the captions in order, and the record of the run, and asked whether each caption is true of the frame under it.

## What the camera refuses to film

- **A run with a failed step.** There is no video. The camera saves a picture of the page at the moment the step failed, so the failure can be looked at rather than guessed at.
- **A reel that barely moves.** If fewer than 15% of its frames change, the reel does not validate. It is a still with a progress bar, and a still image is the honest format for it.
- **A caption that would not fit,** as above.
- **A browser that cannot draw emoji.** Before filming, the camera draws a waving hand emoji into a small canvas and counts the coloured pixels. A machine without a colour emoji font draws empty boxes, and a reel filmed there would show a page broken where it is not. So it refuses, and says which font to install.

Some features did not pass when we used them. They are not in this feed. Each one is written down with what happened and what was expected, for the people who fix it, rather than filmed around.

## What a reel does not prove

A reel proves that the steps passed once, on the commit in the stamp, on the day in the stamp. It does not prove the feature works on your phone, under load, or next month. That is why the stamp is there and why the record expires.

A scenario checks what reaches the screen or the network, and nothing else. A camera flying across a map adds no text, so a visual result has to be proven by the request that caused it. And the reels are rendered in software, so the motion is exact but the machine is slow: reels are made where posts are reviewed, not in production, which reads the record and does not film.

The pages in these reels are live. The engine above is at three.ws/assembly.
