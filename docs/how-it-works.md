# How CSS 3D Parallax Works

This page explains the mechanics behind the CSS 3D parallax scrolling hero used in this theme — from the mathematical foundations of 3D projection to the browser-specific quirks that required targeted workarounds. If you want to understand why each line of CSS exists, you are in the right place.

---

## The CSS 3D Coordinate System

Before anything else, you need a mental model of how CSS thinks about three-dimensional space.

CSS uses a right-handed coordinate system. The X axis runs left to right across the screen. The Y axis runs top to bottom (not bottom to top as in mathematics — CSS and HTML have their origin at the top-left corner). The Z axis is perpendicular to the screen, pointing toward you. A positive `translateZ` moves an element closer to you; a negative `translateZ` moves it away into the page.

The **vanishing point** is where all parallel lines in the 3D scene would converge if extended to infinity. In CSS, the vanishing point defaults to the center of the element that has `perspective` set on it. If you set `perspective: 500px` on a container and it is 800px wide and 600px tall, the vanishing point sits at `(400px, 300px)` in that container's coordinate space. Elements positioned away from that center will appear to slant toward it, which is exactly what gives 3D scenes their sense of depth.

There is one important subtlety: the vanishing point is relative to the _perspective element_, not the viewport. This matters enormously for parallax, as we will see shortly.

---

## `perspective` on a Scroll Container vs. `perspective()` in a Transform

There are two ways to introduce perspective into CSS:

**1. The `perspective` property on a parent element:**

```css
.scroll-container {
	perspective: 2.5rem;
	overflow: hidden auto;
}
```

**2. The `perspective()` function inside a `transform` on the element itself:**

```css
.layer {
	transform: perspective(2.5rem) translateZ(-10px);
}
```

These look similar but behave fundamentally differently, and the difference is what makes scrolling parallax possible.

When you use the `perspective` _property_ on a parent, all children share a _single_ vanishing point. Every child's 3D transform is evaluated relative to that one shared origin. As a result, moving one child does not move the vanishing point — it stays anchored to the parent.

When you use `perspective()` inside an individual element's `transform`, each element gets its own independent vanishing point centered on itself. There is no shared scene. Objects do not relate to each other in 3D space.

For parallax, the shared vanishing point is what you want. The scroll container has `perspective` set, and all the depth layers are children. When the container scrolls, the layers scroll at different visual rates because they are at different Z depths — all converging toward the same vanishing point. This is the entire trick.

---

## The Exact Math: `translateZ` and Parallax Depth

Here is the core rule of CSS 3D projection: an element translated along the Z axis by `z` in a container with `perspective: p` will appear to move at a visual rate proportional to `(p - z) / p` when the container is scrolled.

More precisely, when the scroll container moves by `d` pixels (i.e., `scrollTop` increases by `d`), an element at `translateZ(z)` appears to move by:

```
visual_movement = d × (p / (p - z))
```

For the parallax effect we want _slower_ movement for elements further away (negative Z). Substituting a negative Z value:

```
visual_movement = d × (p / (p + |z|))
```

When `|z|` is large, the denominator grows, and the fraction shrinks below 1. The element appears to move _less_ than the scroll distance. That is parallax.

In this theme, the perspective value is `2.5rem`. The CSS variable `--md-parallax-depth` sets the depth multiplier. The actual `translateZ` value applied to each layer is:

```css
transform: translateZ(calc(2.5rem * var(--md-parallax-depth) * -1))
	scale(calc(var(--md-parallax-depth) + 1));
```

With `--md-parallax-depth: 8` (the farthest background layer), the element is pushed `20rem` (8 × 2.5rem) back into the page. Its visual scroll rate becomes:

```
rate = 2.5 / (2.5 + 20) = 2.5 / 22.5 ≈ 0.111
```

That layer moves at about 11% of the scroll speed. A near-foreground layer at `--md-parallax-depth: 1` moves at:

```
rate = 2.5 / (2.5 + 2.5) = 2.5 / 5 = 0.5
```

That layer moves at 50% of scroll speed. The result: the background barely drifts while the foreground moves more noticeably — exactly the depth cue your visual system uses to infer distance.

The four layers in this theme use depth values of `8`, `5`, `2`, and `1`, giving visual scroll rates of roughly 11%, 33%, 56%, and 50% respectively. The gaps between values are chosen to make the depth separation clearly visible without any single layer moving so fast it looks wrong.

---

## Scale Compensation: Why `scale(depth + 1)` Is Necessary

There is a problem with pushing elements back along the Z axis: they appear smaller. An element at `translateZ(-20rem)` inside a `perspective: 2.5rem` container will be dramatically shrunk by the 3D projection — it would appear as a tiny postage stamp in the corner of the screen.

The scale compensation formula fixes this:

```css
scale(calc(var(--md-parallax-depth) + 1))
```

This is derived directly from the projection math. If an element is at depth `d` (where actual `translateZ` equals `d × -p`), the CSS projection shrinks it by a factor of `1 / (d + 1)`. Multiplying by `scale(d + 1)` exactly cancels that shrinkage, restoring the element to its intended visual size.

For the far background at `--md-parallax-depth: 8`:

- Projection shrink factor: `1 / (8 + 1) = 1/9`
- Scale compensation: `9`
- Net visual size: `1/9 × 9 = 1` — back to full size

For the near foreground at `--md-parallax-depth: 1`:

- Projection shrink factor: `1 / (1 + 1) = 1/2`
- Scale compensation: `2`
- Net visual size: `1/2 × 2 = 1` — back to full size

A critical side effect: because scale compensation makes far layers appear full-size, they must actually be _much larger_ in pixel terms than they appear. A layer at depth 8 needs to be rendered 9× its visible dimensions. This is why background images for deep layers need to be wide panoramic files — the scale transform stretches them to fill the viewport.

---

## Why Scrolling a Perspective Container Creates Parallax

You might wonder: if the scroll container is scrolled, does not everything inside move together by the same amount? The answer is yes in 2D, but not in 3D.

When the container scrolls, the viewport's position in the container's coordinate space changes. Elements at `translateZ(0)` behave normally — they scroll at 1:1. But the 3D projection matrix transforms the geometry of elements at non-zero Z positions. As the viewpoint shifts relative to the Z-displaced elements, the _projected_ position on screen changes at a different rate than the raw scroll offset. The perspective math does this automatically; the browser's rendering engine handles it correctly by compositing each layer with its appropriate depth-projected transform.

This is why this technique requires no JavaScript whatsoever. The parallax is not computed by reading `scrollTop` and updating element positions — it is a natural geometric consequence of CSS 3D perspective projection. The browser's compositor thread handles it entirely, on the GPU.

---

## Sticky Positioning for Hero Text

The hero text sits on top of the parallax image layers and should remain readable while the parallax scrolls. The standard approach — `position: sticky` — is used, but it requires a careful negative margin to work correctly:

```css
.parallax__group--hero-text {
	position: sticky;
	top: 0;
	margin-bottom: -100vh;
}
```

The `margin-bottom: -100vh` deserves explanation. Sticky positioning keeps an element "stuck" to the top of the scroll container until its _parent_ scrolls out of view. Without the negative margin, the parent element would end exactly at the bottom of the text content, and the text would begin to scroll away before the parallax images are done moving through the viewport.

By setting `margin-bottom: -100vh`, the parent element's layout height is reduced by one viewport height. This pulls the sticky constraint boundary upward, keeping the text stuck for exactly as long as the parallax hero section occupies the viewport. When the parallax scroll group eventually leaves the viewport, the sticky text goes with it, revealing the normal document content below.

This is a purely CSS technique. No scroll event listeners, no `position: fixed` with JavaScript offset calculations.

---

## Paint Containment with `contain: strict`

```css
.parallax__group {
	contain: strict;
}
```

The `contain: strict` declaration tells the browser that this element and its subtree are self-contained: their layout, paint, and size do not affect anything outside the element, and nothing outside affects them. This is a performance hint that allows the browser to skip repainting the rest of the document when the parallax group changes.

For parallax layers that are constantly being composited and transformed, this is significant. Without containment, each frame of animation might trigger a full-page repaint. With `contain: strict`, the browser can isolate and independently composite each parallax group on the GPU, achieving buttery smooth frame rates even on mid-range hardware.

The reason this is especially important here is that the 3D transforms on the parallax layers happen entirely on the compositor thread (separate from the main JavaScript thread), but only if the browser can correctly promote the layers to their own GPU compositing layers. `contain: strict` helps the browser make that determination reliably.

---

## The `height: 140vh` on the First Group

The first parallax group uses `height: 140vh` rather than `100vh`. This is not arbitrary. The parallax layers inside the group appear to extend beyond the viewport — the far background layer (depth 8) scrolls at 11% of scroll speed, which means for it to travel through the viewport fully, the group needs to be scrolled through more than `100vh` of content.

The exact value needed depends on the depth values used. A deeper background requires a taller container to complete its scroll travel. `140vh` was empirically tuned to ensure all four layers complete their parallax motion before the hero scrolls fully off screen.

Subsequent groups (if any) use responsive `vw`-based heights rather than fixed `vh` values, because their content is image-driven and should maintain aspect ratios:

```css
.parallax__group--scene {
	height: 56.25vw; /* 16:9 aspect ratio */
}
```

This ensures the parallax scene scales proportionally with viewport width, maintaining correct composition at all screen sizes.

---

## The Blend Layer

Between the parallax image layers and the content below, there is a gradient blend layer:

```css
.parallax__blend {
	background: linear-gradient(to bottom, transparent 0%, var(--md-default-bg-color) 100%);
	z-index: 5;
}
```

This gradient transitions from fully transparent (showing the bottom edge of the parallax images) to the site's background color (matching the content sections below). It accomplishes two things:

1. It prevents a hard visual cutoff at the bottom of the parallax hero. Images rarely look clean at their exact edge, and the gradient masks any artifacts.
2. It creates a smooth visual merge between the scenic parallax imagery and the flat document content that follows, making the page feel cohesive rather than jarring.

The blend layer is positioned using `z-index: 5`, which places it above the image layers (which have lower z-index values) but the blend is transparent at the top, so it does not obscure the imagery.

---

## Z-Index Stacking: `z-index: calc(10 - depth)`

The parallax layers need to stack correctly: near objects (low depth number) should appear in front of far objects (high depth number). The formula for this is:

```css
z-index: calc(10 - var(--md-parallax-depth));
```

At `--md-parallax-depth: 1` (near foreground), `z-index` is `9`. At `--md-parallax-depth: 8` (far background), `z-index` is `2`. Near layers are always on top of far layers in the stacking order.

Without this, the 3D projection might place elements visually at different depths, but the browser's paint order (which follows DOM order and z-index) might render them in the wrong order, creating situations where a background element is painted over a foreground element. The `z-index` formula ensures paint order matches visual depth order.

---

## Browser Quirks

### Safari: Disabling `contain: strict`

Safari has a known issue where `contain: strict` on elements inside a `perspective` scroll container breaks the parallax effect — the 3D transforms stop updating correctly during scroll, causing layers to freeze or jump. A browser detection script adds a `.safari` class to the `<body>` element:

```js
if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
	document.body.classList.add('safari');
}
```

The CSS then disables `contain` specifically for Safari:

```css
.safari .parallax__group {
	contain: none;
}
```

This restores correct parallax behavior at the cost of some paint performance in Safari. Given that Safari's rendering engine handles 3D compositing differently, this is an acceptable trade-off.

### Firefox: Repaint Bug Fix

Firefox has a repaint bug where the parallax layers occasionally fail to repaint after a rapid scroll or tab focus change, leaving ghost artifacts or blank regions. The fix involves toggling a class that forces a style recalculation:

```js
window.addEventListener('focus', () => {
	document.body.classList.add('ff-hack');
	requestAnimationFrame(() => document.body.classList.remove('ff-hack'));
});
```

```css
.ff-hack .parallax__layer {
	will-change: transform;
}
```

Adding and removing `will-change: transform` forces Firefox to mark the compositing layers as dirty and repaint them on the next frame. This resolves the ghost artifact issue without any visible effect on the rendered output.

---

## Why Not JavaScript Scroll Listeners?

Traditionally, parallax effects use JavaScript that reads `window.scrollY` on each scroll event and applies position offsets. This approach has serious performance problems:

- Scroll event handlers run on the **main thread**, which is the same thread that runs JavaScript, handles user input, and performs layout. Under heavy load, this thread can be busy, causing the parallax animation to lag behind the actual scroll position.
- Reading `scrollY` followed by writing to `element.style.transform` triggers **layout thrashing** if not carefully managed with `requestAnimationFrame`.
- Even with `requestAnimationFrame`, JavaScript-driven parallax runs at most 60fps on most displays, and may drop frames when other scripts are active.

The CSS 3D approach runs entirely on the **compositor thread**, a separate GPU-accelerated thread that handles `transform` and `opacity` animations. The compositor thread is never blocked by JavaScript. The parallax updates happen at the full display refresh rate (including 120Hz and 144Hz displays) with zero jank, even if the main thread is busy processing data or rendering other UI.

---

## Why Not `animation-timeline: scroll()`?

The CSS Scroll-Driven Animations API (`animation-timeline: scroll()`) is a modern alternative that allows CSS animations to be driven by scroll position. As of 2025, it is supported in Chrome and Edge but lacks full support in Safari and Firefox.

Additionally, scroll-driven animations are still processed on the main thread in some implementations when they affect layout properties, and the API requires careful coordination when combined with 3D transforms and perspective containers. The CSS 3D perspective approach used here works in every browser that supports CSS 3D transforms — which is every major browser since 2012 — and delivers equivalent performance without the compatibility uncertainty.

---

## Debugging: Chrome DevTools

### Layers Panel

Open Chrome DevTools, go to the **Layers** panel (More tools > Layers). Each parallax layer should appear as a separate compositing layer. If a layer is not promoted, you will see it listed as part of its parent. You can click any layer to see why it was or was not promoted (look for "Has a 3D transform" as the reason).

### 3D View

In Chrome DevTools, More tools > **3D View** renders your page's layer stack as an interactive 3D diagram. You can orbit around the layer stack and visually confirm that each parallax layer is at the correct depth. Layers that are pushed back in Z should appear further back in the 3D view. This is the most intuitive way to verify that the transforms are applied correctly.

If a layer appears at `z=0` when it should be at a negative Z, the most common cause is a missing `transform-style: preserve-3d` on an intermediate ancestor, or a CSS property on an ancestor that flattens the 3D context (such as `overflow: hidden` in some browsers, or certain `filter` values).

---

## Summary

The CSS 3D parallax technique works because:

1. A `perspective` property on a scroll container establishes a shared 3D scene with a fixed vanishing point.
2. Child elements at negative Z positions are projected to appear smaller and scroll more slowly — the further back, the slower.
3. Scale compensation exactly counteracts the projection shrinkage, so images appear full-size at all depths.
4. The compositor thread handles all of this at GPU speed, with no JavaScript involvement.
5. Sticky text positioning and a blend gradient handle the presentation layer.
6. Browser-specific workarounds address known bugs in Safari and Firefox without compromising the core technique.

The result is a hero section with genuine, smooth, GPU-accelerated depth — using nothing but CSS that browsers have supported for over a decade.
