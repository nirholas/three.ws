Two lines of HTML put a live, animated 3D avatar on any web page: a script tag that loads the `<agent-3d>` element from three.ws, and the element itself, pointed at a 3D body. There is no API key and no build step. The part worth explaining is what the element does before anyone sees it. It loads the body, starts an idle animation on it, and keeps the frame hidden until that idle has rendered, so the avatar arrives standing naturally instead of with its arms stuck straight out.

## The whole embed

This is all of it. We pasted it into an empty HTML file while writing this and opened it in a browser:

```html
<script type="module" src="https://three.ws/agent-3d/1/agent-3d.js"></script>

<agent-3d body="https://three.ws/avatars/default.glb"
          style="width:480px;height:640px"></agent-3d>
```

`body` takes the address of any GLB file the browser is allowed to fetch. The one above is the platform's default body; your own avatar, a character from the free [Character Library](https://three.ws/character-library), or a model you generated a minute ago goes in the same attribute. The `1` in the script path tracks the 1.x line of the element, so fixes reach your page without you editing it.

![A plain HTML page we wrote for this article, with the snippet in its right-hand column. The avatar is the platform's default body, idling on the page's own background, with no chat box or controls around it.](/x-media/embed-article/demo-page.png)

## What happens before the avatar appears

A 3D file is not a picture. Between the tag landing in the page and a character standing in it, the element does five things, in this order.

1. **It waits until it is nearly on screen.** An IntersectionObserver watches the element and boots it once it comes within 300 pixels of the viewport, so an avatar far down a long page costs nothing until the reader scrolls toward it. The `eager` attribute skips the wait.
2. **It fetches the body and the clips.** The GLB loads into a three.js renderer inside the element's shadow DOM. Alongside it, the element reads the shared [animation manifest](https://three.ws/animations/manifest.json) and loads the idle and walk clips. Clip addresses are rebased onto the origin the script came from, so they resolve when the tag sits on your domain instead of failing against it.
3. **It holds the frame.** A renderer paints a freshly loaded rig in its bind pose, which for most humanoids is a T-pose, and the idle takes over once its clip has been fetched and retargeted. The canvas sits at opacity 0 while that happens.
4. **It snaps the idle in and waits two frames.** A crossfade would blend the clip in from the bind pose, and the arms would visibly swing down. The element starts the idle with no fade, lets one frame pose the body and a second one composite it, then fades the canvas in.
5. **It says so.** The agent:ready event fires once the element has booted, with the body already on screen holding its idle. That is the event to swap out your own placeholder image on.

![Three captures of the same embed loading in headless Chromium. Left: the canvas exists but is held at opacity 0. Middle: the frame where it was revealed, with the idle already playing. Right: the same avatar about two seconds later, still idling.](/x-media/embed-article/first-frame.png)

## One idle, many skeletons

The idle is one clip from the platform's shared library, authored on one skeleton. Avatars from different tools name their bones differently: `mixamorig:LeftArm` in a Mixamo export, `J_Bip_L_UpperArm` in a VRoid one, `upperarm_l` on an Unreal mannequin. Before the clip plays, each bone name is mapped onto one canonical set. The mapping covers Mixamo, Blender and Rigify, VRM and VRoid, Unreal, Daz and Genesis, MakeHuman, Roblox and Second Life, among others, and it maps finger chains as well, because 30 of the 53 tracks in every clip in the library drive a finger joint.

The three bodies on the cover of this article show it working. The middle one is a Mixamo character whose bones carry the `mixamorig:` prefix; the two either side name theirs without it. All three are running the same idle clip, retargeted on load.

There is a floor to this. When too few of a clip's tracks find a matching bone, the retarget builds no animation at all rather than a broken one, and a body that cannot take the idle (a prop, a quadruped) is shown in whatever pose the viewer gave it. The element does not invent a skeleton the file does not have.

## Bare by default, still when asked

A plain tag with a `body` is a bare avatar: a transparent canvas and the character, with no chat box, no input, no debug controls and no name plate. The page behind it shows through, which is why the avatar in the demo stands on the page's own cream background rather than in a box.

It also listens to the visitor's motion setting. When the system asks for reduced motion, a bare avatar settles into a single idle pose and freezes there, which also lets the render loop stop drawing. We checked this while writing: with reduced motion emulated in the browser, captures taken seconds apart came out byte for byte identical, while the same page without the setting changed between captures. The element watches the setting live, so switching it in the operating system takes effect without a reload. Motion the visitor asks for still plays: `playClip(name, { userInitiated: true })` is the call for an animation behind a button.

And it is built to be used more than once on a page. Browsers cap how many WebGL contexts can be alive at once (around 16 in Chrome) and silently kill the oldest when a page asks for more, which freezes or blanks that avatar for good. The element caps itself instead. By default eight avatars are live at a time; when another boots, the one that has been off screen longest releases its context, and it boots again when it scrolls back into view. Whatever the reader is looking at is never the one evicted.

## What this piece does not cover

This is the bare avatar. The element also has a conversational mode, switched on with a `chat` attribute or by binding a published agent with `agent-id`, and it is not covered here.

If an avatar does not take the idle, look at the rig before anything else: a body with no skin, or one whose bone names match no known convention, will appear in its own rest pose. That is the limit to plan around today.

The full list of attributes, methods and events is in the [`<agent-3d>` reference](https://three.ws/docs/web-component), and the [end-to-end tutorial](https://three.ws/tutorials/web-component-end-to-end) walks through the element in a real page.
