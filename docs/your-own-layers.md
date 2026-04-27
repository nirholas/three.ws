# Using Your Own Layers

This guide walks through everything you need to know to replace the default hero images with your own artwork. It covers image format selection, dimension requirements, transparency rules, depth value strategy, scene composition principles, and the mechanics of wiring new images into the theme. By the end, you will be able to swap any set of layered images into the parallax hero with confidence.

---

## Why Four Layers?

The theme ships with exactly four image layers, and this is a deliberate choice, not a technical limitation.

**Fewer than four** (two or three layers) produces a noticeably shallow depth effect. The human visual system picks up parallax cues from relative motion between planes. With only two planes, the separation feels thin — more like a cheap slideshow transition than genuine depth.

**More than four** (five or six layers) begins to have diminishing returns on perceived depth while multiplying file size substantially. Each additional AVIF layer adds to the initial page load. At four layers, users with fast connections load the hero in well under a second. At six or seven layers, you may see layout shift or a flash of empty space while the far layers load.

Four layers also maps cleanly to the natural visual hierarchy of most landscape compositions: sky/far background, mid-distance scenery, near-ground elements, and foreground detail. This four-plane model is how matte painters and game background artists have structured parallax scrollers for decades — because it matches how human eyes decompose distance in the real world.

If your scene genuinely needs five planes (for example, a foggy mountain range with a distinct middle-fog layer), adding a fifth is technically straightforward. Just be deliberate about it.

---

## Image Format Comparison

| Format | Compression | Alpha (Transparency) | Browser Support | Recommended Use |
|--------|-------------|---------------------|-----------------|-----------------|
| AVIF | Excellent (AV1-based) | Yes (full alpha channel) | Chrome 85+, Firefox 93+, Safari 16+ | Primary format for all layers |
| WebP | Good (VP8-based) | Yes | Chrome 32+, Firefox 65+, Safari 14+ | Fallback for older Safari |
| PNG | Lossless | Yes | Universal | Source files only; not for production |
| JPEG | Good (DCT-based) | No | Universal | Far background only (no transparency needed) |

**AVIF** is the primary format for this theme. It delivers dramatically smaller file sizes than WebP or PNG at equivalent visual quality — typically 40–60% smaller than WebP and 70–80% smaller than PNG for photographic content. For the wide panoramic images that parallax layers require (often 3000px+ wide), this difference is significant.

AVIF supports a full alpha channel, which is critical for mid-distance, near-ground, and foreground layers (more on this below). The alpha channel in AVIF uses the same AV1 compression as the color data, so transparent regions cost very little in file size compared to PNG's lossless transparency.

**WebP** should be provided as a `<source>` fallback in the `<picture>` element for users on Safari 14–15, which supports WebP but not AVIF. Safari 16+ supports AVIF natively, so WebP coverage is increasingly less necessary, but it remains good practice.

**PNG** should be used only for source/master files during the design phase. Never ship raw PNGs as hero layer images in production — a single transparent PNG at 3000×2000px can easily exceed 5MB, versus under 300KB for an equivalent AVIF.

**JPEG** can be used for the far background layer if it has no transparency requirement, but AVIF still outperforms JPEG at the same file size, so there is rarely a reason to reach for JPEG.

---

## Exact Dimensions

### Minimum Dimensions

No layer should be smaller than the maximum viewport width you expect users to visit your site on. In practice, `2400px` wide is a safe minimum for desktop displays including high-density (2x) monitors at 1440px logical width. For near/foreground layers that are scaled up by the depth compensation factor, you need additional resolution.

Calculate the minimum raw image width for each layer using:

```
minimum_width = viewport_max_width × scale_factor
```

Where `scale_factor = depth + 1` (matching the CSS scale compensation). For the far background at depth 8:

```
minimum_width = 1440 × 9 = 12,960px
```

That looks alarming, but the browser's compositor only ever renders the visible portion of a scaled layer, and AVIF compression means a 12,000px-wide sky image might still only be 400KB due to the repetitive nature of sky gradients.

In practice, the scale compensation is applied in CSS, not to the image itself. The image does not need to be 12,000px wide — it needs to have enough resolution that when it is scaled by 9× in CSS and the user views the center portion at screen resolution, it does not appear blurry. For photographic content at 96dpi display resolution and 2× device pixel ratio, a source image of `3000px` wide is usually sufficient for the far background, because large amounts of scale compression and the visual nature of background imagery makes moderate blurriness imperceptible.

### Ideal Dimensions by Layer

| Layer | Depth | Scale Factor | Recommended Width | Recommended Height |
|-------|-------|--------------|-------------------|--------------------|
| Far background | 8 | 9× | 3000px | 1500px |
| Mid-background | 5 | 6× | 2800px | 1400px |
| Near-ground | 2 | 3× | 2400px | 1200px |
| Foreground | 1 | 2× | 2400px | 1200px |

### Why Wide Panoramas Work Better Than Tall Images

The horizontal crop of each layer is controlled by `--md-image-position`, which maps to `object-position`. Because the scale compensation zooms the image in considerably, a tall image mostly wastes pixels on the top and bottom edges that will never be visible. A wide panorama uses that pixel budget on horizontal detail that *will* be seen as the user adjusts `--md-image-position` or visits on different viewport widths.

The aspect ratio `2:1` (width:height) is a reliable default. If your scene has significant vertical interest in the mid-ground (tall trees, cliffs, buildings), you can go to `1.5:1`, but avoid portrait-oriented source images.

---

## Transparency: Which Layers Need It

The far background layer (depth 8) does not need transparency. It represents the sky, open sea, or any expanse that fills the entire frame. This layer is the "canvas" behind everything else.

Every other layer — mid-background, near-ground, and foreground — needs a transparent background. Here is why:

In a parallax scene, layers stack on top of each other. If the mid-background layer has a solid color fill behind the mountains or trees you painted, that fill will cover the sky layer behind it, creating a hard rectangular cutout effect instead of a natural scene. The mid-background needs to show only the mountains and the sky directly behind them needs to come from the actual far background layer below.

This means:

- **Far background (depth 8):** Solid image, no transparency required
- **Mid-background (depth 5):** Transparent background — show only the mid-distance objects
- **Near-ground (depth 2):** Transparent background — show only near-ground objects and foreground elements
- **Foreground (depth 1):** Transparent background — typically plants, rocks, or architectural elements that frame the scene

A common mistake is forgetting that the scale compensation zooms each layer in significantly. If your mid-background layer has transparent edges on the left and right, those edges may be scaled into the visible viewport. If the object you painted is centered in the image and the transparent area at the edges is large, the visible part of the image may be smaller than expected after scaling. Always preview the scaled result in CSS before finalizing your AVIF files.

---

## AVIF Alpha Channel and Parallax CSS

AVIF's alpha channel is encoded using the same AV1 codec as the color data, stored as a separate "auxiliary image" in the AVIF container. When the browser decodes an AVIF file with an alpha channel, it composites the alpha against the background using standard Porter-Duff "source over" blending.

This interacts with the parallax CSS cleanly. The `object-fit: cover` property applied to each layer image respects the transparency of the image — transparent pixels remain transparent after fitting and cropping. The `object-position` property (controlled by `--md-image-position`) shifts the image within its container while preserving transparency.

One thing to verify: when exporting AVIF from Photoshop, Affinity Photo, or Figma, confirm that you are exporting with "alpha channel" or "transparency" enabled. Some AVIF exporters default to a flat white or black matte on transparent areas, which will destroy your transparency information. Always open the exported AVIF in a browser to visually verify the alpha before publishing.

AVIF files with alpha channels are somewhat larger than those without, because the alpha information is stored alongside the color data. For foreground layers with complex transparency (detailed foliage cutouts, for example), the AVIF file size will be noticeably larger than a solid background layer of the same dimensions. This is expected and acceptable.

---

## The `@4x` Naming Convention

Image files in this theme follow the convention:

```
hero-background@4x.avif
hero-midground@4x.avif
hero-nearground@4x.avif
hero-foreground@4x.avif
```

The `@4x` suffix is a source resolution indicator borrowed from iOS/macOS asset catalog conventions, where `@2x` means 2× pixel density, `@3x` means 3×, and so on. In this context, `@4x` signals that these are high-resolution source images intended to be displayed at a fraction of their pixel dimensions (because CSS scaling reduces them on screen).

This naming convention has two benefits:

1. It documents the intended display scale in the filename, helping future maintainers understand why images seem larger than expected.
2. It prevents confusion with standard-resolution images. If you later add a WebP fallback or generate responsive sizes, you can name them `hero-background@2x.webp` and `hero-background@1x.webp` without ambiguity.

The `@4x` suffix has no special meaning to browsers or MkDocs — it is purely a human-readable convention.

---

## Depth Value Selection Strategy

The four depth values used in this theme are `8`, `5`, `2`, and `1`. Understanding why these specific values were chosen helps you adjust them intelligently for your own scene.

**Depth 8 (far background):** The maximum depth value used. At depth 8, the visual scroll rate is approximately 11% of the page scroll speed. This layer barely moves, giving it a distant, immovable quality appropriate for sky or open horizon.

**Depth 5 (mid-background):** At depth 5, the visual scroll rate is approximately 33%. This layer moves noticeably but slowly, conveying mid-distance.

**Depth 2 (near-ground):** At depth 2, the visual scroll rate is approximately 56%. This layer moves at just over half scroll speed, feeling close.

**Depth 1 (foreground):** At depth 1, the visual scroll rate is 50%. Wait — why is foreground (depth 1) slower than near-ground (depth 2)?

This is a quirk of the non-linear relationship between depth values and scroll rate. The rate formula is `p / (p + depth × p) = 1 / (1 + depth)`. At depth 2, rate is `1/3 ≈ 0.33`... wait, let us recalculate against the actual perspective value:

```
rate = perspective / (perspective + |translateZ|)
     = 2.5rem / (2.5rem + (depth × 2.5rem))
     = 1 / (depth + 1)
```

So at depth 1: rate = `1/2 = 50%`; at depth 2: rate = `1/3 = 33%`; at depth 5: rate = `1/6 ≈ 17%`; at depth 8: rate = `1/9 ≈ 11%`.

The depth values `8 > 5 > 2 > 1` correctly produce scroll rates `11% < 17% < 33% < 50%` — each closer layer moves faster. The gap between values is nonlinear: going from depth 8 to depth 5 is a large jump in scroll rate (11% to 17%), while going from depth 2 to depth 1 is a smaller jump (33% to 50%). This nonlinearity means you get dramatic separation at the far end and subtler separation at the near end — which is how real-world parallax works, as atmospheric perspective compresses apparent depth differences at distance.

**Choosing your own depth values:** Keep the ratio between adjacent depth values large enough to produce a visible difference. Values too close together (e.g., `3`, `2.5`, `2`, `1.5`) produce a nearly flat-looking result because the scroll rate differences are tiny. Values too far apart (e.g., `20`, `10`, `5`, `1`) can make the foreground layer scroll so fast it looks jarring. The range `1–10` with nonlinear spacing works well for most hero sections.

---

## `object-position` as Crop Control

Each parallax layer is displayed using `object-fit: cover` (or equivalent background behavior), which crops the image to fill its container. The `--md-image-position` CSS variable controls where in the image the crop is taken from, horizontally:

```css
.parallax__layer img {
  object-fit: cover;
  object-position: calc(var(--md-image-position) * 1%) center;
}
```

`--md-image-position: 0` crops to the left edge of the image. `--md-image-position: 100` crops to the right edge. `--md-image-position: 50` centers the image (the default).

This is primarily useful for adjusting the composition after images are placed. If your mountain peak is 20% from the right edge of your source image, set `--md-image-position: 80` to shift the crop rightward so the peak is centered in the viewport.

Each layer has its own `--md-image-position` value, allowing independent horizontal positioning of each depth plane. A common technique is to set the foreground layer's position slightly offset from the background — a foreground rock formation at 40% and the background peak at 60% creates a natural sense of different horizontal planes.

**Important:** Because scale compensation increases the displayed size of far layers dramatically, far layers (depth 8) have a large amount of image content outside the visible area. Adjusting `--md-image-position` for far layers shifts through a wide panorama smoothly. For near layers (depth 1), the image is scaled less, so the same change in `--md-image-position` value moves the crop over a smaller physical distance — adjustment is more sensitive.

---

## Scene Composition Principles

### Horizon Alignment

All layers should share the same horizon line — the perceived eye level of the scene. If the background sky meets the mountains at one-third of the image height, the mid-ground trees should also start roughly at one-third, with their roots near the bottom. Mismatched horizon lines make layers feel like they are from different scenes even when the content is superficially similar.

### Foreground Anchoring to the Bottom

Foreground elements should be rooted at the *bottom* of the image frame, not floating in the middle. Plants, rocks, architectural elements, and terrain features that anchor to the bottom edge of the frame appear to "sit" on the ground plane, which is where the user expects near objects to be. Floating foreground elements — a tree whose trunk is not connected to the bottom of the frame — look ungrounded and break the illusion.

Set the foreground layer's `object-position` vertical value to `bottom` to ensure the anchoring is respected:

```css
.parallax__layer--foreground img {
  object-position: calc(var(--md-image-position) * 1%) bottom;
}
```

### Color Consistency

All layers should be lit from the same direction with the same color temperature. A background with warm afternoon sun (golden, directional) combined with a foreground painted with cool overcast light (flat, blue-white) will look artificial regardless of how precise your depth values are. The eye immediately detects lighting inconsistency as a sign that the image is composited.

If your layers come from different source photographs, do color grading passes to unify the white balance, shadow tone, and highlight color before exporting. A quick way to check: convert all layers to grayscale and verify that the contrast and tonal ranges match across layers.

---

## Edge Handling: Avoiding Hard Cutout Artifacts

When a transparent layer is scaled up by the CSS `scale()` transform, its edges are also scaled up. If your transparent layer has a hard pixel edge — one row of semi-transparent pixels and then fully transparent — that hard edge will become visible as a sharp line when the layer is scaled into the viewport.

Fix this by painting a soft feathered edge on transparent layers. In Photoshop: apply a `Refine Edge` or `Select and Mask` operation on your transparency mask with 20–40px feathering before exporting. In Figma: use `Blur > Layer Blur` on the edge regions at a low value (4–8px) before exporting. In Affinity Photo: use the "Feather" slider in the Pixel Selection panel.

The amount of feathering needed scales with your depth value. Layers at depth 2 (scale 3×) need more feathering than layers at depth 1 (scale 2×), because the larger scale factor amplifies edge sharpness more.

---

## Testing Layers Before AVIF Conversion

AVIF conversion is lossy and takes time. Before committing to the AVIF encoding step, verify your layer composition using PNG files in a browser.

The fastest method: stack your PNG layers in a `<div>` with `position: absolute; inset: 0` on each layer, then view it in a browser. If the layers look correct as a flat composite, they will look correct in the parallax hero (depth and scroll behavior aside).

For a more accurate preview, open your layer stack in **Figma** or **Photoshop** as individual layers in a single file. Toggle each layer's visibility to confirm that each plane contains only the content intended for that depth. Check that transparent regions are genuinely transparent, not filled with white or black.

Pay particular attention to:

- The mid-background layer's sky region (should be transparent, not solid)
- The foreground layer's upper region (should be transparent above the foreground objects)
- The exact bottom edge of all non-background layers (should feather out, not hard-cut)

Once you are satisfied with the PNG composite, convert to AVIF using `squoosh`, `avifenc`, or your image editing application's export dialog. Encode at quality 60–75 for photographic content and 75–85 for illustrated/painted content. Check the output file in a browser before publishing.

---

## File Placement

Place finished AVIF files at:

```
docs/assets/hero/hero-background@4x.avif
docs/assets/hero/hero-midground@4x.avif
docs/assets/hero/hero-nearground@4x.avif
docs/assets/hero/hero-foreground@4x.avif
```

MkDocs Material automatically copies the entire `docs/assets/` directory to the built site's `assets/` directory. No additional configuration is required. The paths used in `home.html` should reference `/assets/hero/` (without the `docs/` prefix) because MkDocs strips the `docs/` root from all asset paths in the build output.

**Linux file path note:** File paths on Linux (including MkDocs' build process and most CI environments) are case-sensitive. `Hero-Background@4x.avif` and `hero-background@4x.avif` are different files. Always use lowercase filenames and verify paths match exactly between the file system and your HTML templates.

---

## The `<picture>` Element Structure in `home.html`

Each layer is rendered using a `<picture>` element to support both AVIF and WebP with a PNG fallback:

```html
<picture class="parallax__layer" style="--md-parallax-depth: 8; --md-image-position: 50">
  <source
    type="image/avif"
    srcset="/assets/hero/hero-background@4x.avif"
  />
  <source
    type="image/webp"
    srcset="/assets/hero/hero-background@4x.webp"
  />
  <img
    src="/assets/hero/hero-background@4x.png"
    alt=""
    loading="eager"
    decoding="async"
  />
</picture>
```

Browsers read `<source>` elements in order and use the first type they support. An AVIF-capable browser (Chrome 85+, Firefox 93+, Safari 16+) uses the AVIF. A browser with WebP but no AVIF (Safari 14–15) uses the WebP. Any older browser falls back to the PNG.

The `alt=""` on the `<img>` is intentional. Parallax background images are decorative — they do not convey content that a screen reader user needs. An empty `alt` attribute tells assistive technology to ignore the image entirely, which is the correct behavior.

The `loading="eager"` attribute on the first (far background) layer ensures it begins loading immediately, avoiding a flash of empty background. Layers at depth 2 and 1 (near and foreground) can use `loading="lazy"` if desired, since they are partially revealed only as the user scrolls.

### Adding a WebP Fallback Source

If you only export AVIF files initially and want to add WebP fallbacks later:

1. Convert each AVIF source to WebP using `squoosh` or `cwebp`: `cwebp -q 80 hero-background@4x.png -o docs/assets/hero/hero-background@4x.webp`
2. Place the WebP files alongside the AVIF files in `docs/assets/hero/`
3. Add a `<source type="image/webp">` element to each `<picture>` block, between the AVIF source and the `<img>` tag

---

## Common Mistakes

**Depth values too close together.** Using depths like `4`, `3`, `2`, `1` produces almost no visible parallax separation. The scroll rate difference between depth 4 (`rate = 1/5 = 20%`) and depth 3 (`rate = 1/4 = 25%`) is only 5 percentage points. Spread your values further apart.

**Forgetting transparency on non-background layers.** The mid-ground and near-ground layers must have transparent backgrounds. Exported PNGs with white or black backgrounds turn into opaque rectangles that cover the layers behind them, making the scene look like a stack of colored blocks.

**Wrong file paths (case-sensitive on Linux).** The most common deploy-time bug. The file is `hero-midground@4x.avif` but the template references `hero-Midground@4x.avif`. Works fine on macOS (case-insensitive filesystem), fails silently on Linux CI and production. Standardize on all-lowercase filenames.

**Not accounting for scale when evaluating image quality.** A layer at depth 5 (scale factor 6×) will be rendered at 6× its natural size. Zoom into your AVIF file at 600% in a browser before publishing to check that it does not show blocking artifacts or excessive blurring at the scale it will be displayed.

**Using portrait or square images.** The parallax CSS renders layers in a wide landscape viewport. Portrait images will be cropped heavily, often showing nothing but a narrow vertical strip of content. Always work with landscape-format (wider-than-tall) source images.

**Opacity on individual layers without considering blending.** If you add `opacity` to a mid-ground layer to create a haze effect, note that CSS `opacity` creates a new stacking context, which can interact unexpectedly with `z-index`. Use `mix-blend-mode` or AVIF-level transparency instead.

---

## Swapping Layers Without Breaking the Site

To replace existing layer images:

1. Prepare your new AVIF (and optionally WebP) files following the naming conventions above.
2. Place them in `docs/assets/hero/`.
3. Open `docs/overrides/home.html` (or wherever your theme's `home.html` override lives).
4. Update the `srcset` path in each `<source>` element and the `src` in the `<img>` fallback to point to your new filenames.
5. Adjust `--md-parallax-depth` and `--md-image-position` custom properties on each `<picture>` element if your new scene has different depth requirements or needs a horizontal crop offset.
6. Run `mkdocs serve` locally and scroll through the hero to visually verify the layers.
7. Check that transparent layers do not show hard edges or cutout artifacts.
8. Run `mkdocs build` to generate the static site and confirm the AVIF files appear in `site/assets/hero/`.

If you want to update only one layer — for example, replacing the foreground with a seasonal variation — you only need to update that one `<picture>` block and its associated file. The other layers are independent.

After a layer swap, clear your browser cache or use an incognito window to test, since browsers aggressively cache image resources and may serve the old image even after a rebuild.

---

## Quick Reference: Layer Properties

| Property | Far Background | Mid-Background | Near-Ground | Foreground |
|----------|---------------|----------------|-------------|------------|
| `--md-parallax-depth` | `8` | `5` | `2` | `1` |
| Scale factor | `9×` | `6×` | `3×` | `2×` |
| Visual scroll rate | ~11% | ~17% | ~33% | ~50% |
| Needs transparency | No | Yes | Yes | Yes |
| Recommended width | 3000px | 2800px | 2400px | 2400px |
| `loading` attribute | `eager` | `eager` | `lazy` | `lazy` |
| `z-index` (auto) | 2 | 5 | 8 | 9 |

Adjust `--md-parallax-depth` first when you want to change how dramatic the parallax separation feels. Adjust `--md-image-position` when you want to shift the horizontal crop without changing the depth behavior.
