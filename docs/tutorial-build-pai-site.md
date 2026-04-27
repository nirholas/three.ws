# Building docs.pai.direct from scratch inside `nirholas/scroll-zoom-thing`

A complete, step-by-step tutorial for rebuilding the [docs.pai.direct](https://docs.pai.direct) documentation site on top of the [`nirholas/scroll-zoom-thing`](https://github.com/nirholas/scroll-zoom-thing) reference repo. By the end you will have a MkDocs Material site with a pure-CSS 3D perspective parallax hero, a full PAI-style navigation tree, AVIF artwork at the right depths, and a working GitHub Pages deployment behind a custom domain.

Nothing in this guide depends on JavaScript scroll listeners, third-party animation libraries, or build-time image pipelines. Every effect uses primitives the browser already ships: `perspective`, `translateZ`, `scale`, `position: sticky`, and a `<picture>` element with an AVIF source.

---

## What you are building

The pai site is a Material for MkDocs documentation site with three personality traits that make it different from a stock theme:

1. **A cinematic parallax hero** built from four AVIF layers stacked in 3D space, scrolling at different speeds because they sit at different `translateZ` distances from the camera.
2. **A pillars-and-intro landing page** that flows immediately under the hero with the same dark scheme, so the home route is a marketing page first and a docs index second.
3. **A deep nav tree** — Overview, Getting started, Guides, AI, Apps, Advanced, Privacy, Examples, Development, Reference, About — wired into Material's navigation tabs and sections, with a hardened set of markdown extensions for callouts, code, and tabs.

The repo `nirholas/scroll-zoom-thing` already contains a minimal reference implementation of the parallax in its top-level `docs/` folder, plus a complete pai instance under `pai/`. This tutorial walks you through building the `pai/` instance from an empty checkout. Read the reference docs first if you want to understand the math; then come back here to assemble the real site.

---

## Prerequisites

Before you start, install:

- **Python 3.10 or newer** — MkDocs is a Python tool. A `venv` is enough; you do not need Conda.
- **Git** — for cloning, branching, and the GitHub Pages deploy step.
- **A modern image converter** — `ffmpeg` 6+ or [`avifenc`](https://github.com/AOMediaCodec/libavif) for producing AVIF layers. ImageMagick 7 also works if compiled with `--with-libavif`.
- **A GitHub account** — for the eventual Pages deployment and custom domain.

You should also be comfortable editing Jinja2 templates (the `home.html` override is a Jinja file that extends Material's `base.html`) and YAML (the `mkdocs.yml` is several hundred lines once you wire up the full nav).

You do not need Node.js, a bundler, Tailwind, or any framework. Everything is plain HTML, CSS, Markdown, and a little Jinja.

---

## Step 1 — Fork and clone the reference repo

Start by getting a working copy of the reference implementation. You can either fork it on GitHub and clone your fork, or clone the upstream directly and rename the remote later:

```bash
git clone https://github.com/nirholas/scroll-zoom-thing.git
cd scroll-zoom-thing
git checkout -b pai-site
```

Spend ten minutes browsing the layout. The pieces you will be reusing or recreating are:

- `docs/overrides/home.html` — the minimal reference parallax hero
- `docs/assets/stylesheets/home.css` — the stylesheet that drives the depth effect
- `docs/how-it-works.md`, `docs/your-own-layers.md` — explainers for the technique
- `pai/` — the production pai instance (this is the target you are rebuilding)
- `agents/`, `skills/`, `.claude/commands/` — optional tooling for AI-assisted authoring

Treat `pai/` as a black box for now; you will recreate its contents from empty so you understand every line.

---

## Step 2 — Create the pai directory structure

Inside the repo root, create a fresh, empty workspace for your build. Do not copy from `pai/` yet — author the files yourself and diff against the reference at the end.

```bash
mkdir -p pai-fresh/{src,overrides,images}
mkdir -p pai-fresh/src/{general,first-steps,ai,apps,advanced,privacy,usage,persistence,examples,architecture,development,reference,api,agents,tutorials,assets/hero,assets/stylesheets}
touch pai-fresh/{mkdocs.yml,requirements.txt}
touch pai-fresh/overrides/home.html
touch pai-fresh/src/{index.md,quickstart.md,installation.md,getting-started.md,using-pai.md,models.md,configuration.md,deployment.md}
```

That scaffolds the whole tree at once. Material expects the nav targets in `mkdocs.yml` to resolve to real files; missing files build successfully but produce broken links, so it is worth touching all the placeholders early.

Add a `requirements.txt` so anyone (and any CI runner) can reproduce your local environment exactly:

```
mkdocs-material>=9.5
pymdown-extensions>=10.7
mkdocs-redirects>=1.2
```

Then create and activate a virtualenv:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r pai-fresh/requirements.txt
```

---

## Step 3 — Author `mkdocs.yml`

`mkdocs.yml` is the single most consequential file in the project. It chooses the theme, switches on Material features, lists every markdown extension, registers stylesheets, and declares the entire navigation tree. Copy this skeleton into `pai-fresh/mkdocs.yml`:

```yaml
site_name: PAI Documentation
site_description: Private AI on a bootable USB drive — Debian + Sway + Ollama.
site_url: https://docs.pai.direct
repo_url: https://github.com/nirholas/pai
repo_name: nirholas/pai
edit_uri: edit/main/docs/src/

docs_dir: src
site_dir: _site

theme:
  name: material
  custom_dir: overrides
  language: en
  logo: assets/pai-logo-white.png
  palette:
    - scheme: slate
      primary: custom
      accent: custom
  font:
    text: Inter
    code: JetBrains Mono
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.top
    - navigation.instant
    - navigation.tracking
    - search.suggest
    - search.highlight
    - content.code.copy
    - content.action.edit
    - toc.follow

extra_css:
  - assets/pai-theme.css
  - assets/stylesheets/home.css

markdown_extensions:
  - admonition
  - attr_list
  - def_list
  - footnotes
  - md_in_html
  - tables
  - toc:
      permalink: true
  - pymdownx.details
  - pymdownx.highlight:
      anchor_linenums: true
  - pymdownx.inlinehilite
  - pymdownx.snippets
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.tabbed:
      alternate_style: true
  - pymdownx.tasklist:
      custom_checkbox: true

plugins:
  - search
```

A few decisions to call out:

- **`docs_dir: src`** — non-standard but deliberate. It keeps the markdown content separate from the site config, the override templates, and the deploy artifact. Many MkDocs sites collapse this into the default `docs/`; here we want the source tree to feel like a real project tree.
- **`scheme: slate`** — Material's dark scheme. The hero artwork is desaturated landscape photography that looks anaemic on the light scheme, so we lock the home page to slate via a `data-md-color-scheme="slate"` attribute on the parallax sections later.
- **`custom_dir: overrides`** — tells Material to look in `overrides/` for partial template replacements. The home page template lives there.
- **`navigation.instant`** — turns the docs into a single-page app with route-level prefetch. It is fast, but it interacts with the parallax: instant nav swaps `<body>` content rather than reloading, so any code that runs on `DOMContentLoaded` will not re-fire. The pure-CSS parallax does not care.
- **`navigation.tabs`** — promotes the top-level nav entries to a horizontal tab bar. PAI has eleven sections; without tabs the sidebar gets unreadable.

Now append the navigation tree. This is the part that takes the longest, but it is mechanical:

```yaml
nav:
  - Home: index.md
  - Overview:
      - How PAI works: general/how-pai-works.md
      - Features included: general/features-included.md
      - System requirements: general/system-requirements.md
      - Warnings and limitations: general/warnings-and-limitations.md
  - Getting started:
      - Try in a VM: first-steps/try-in-a-vm.md
      - Quickstart: quickstart.md
      - Installation: installation.md
      - USB flashing: USB-FLASHING.md
      - Starting on Mac: first-steps/starting-on-mac.md
      - Starting on Windows: first-steps/starting-on-windows.md
      - First boot walkthrough: first-steps/first-boot-walkthrough.md
      - Desktop basics: first-steps/desktop-basics.md
  - Guides:
      - Using PAI: using-pai.md
      - Basic usage: usage/basic.md
      - Advanced usage: usage/advanced.md
      - Persistence:
          - Introduction: persistence/introduction.md
          - Creating persistence: persistence/creating-persistence.md
          - Unlocking: persistence/unlocking.md
          - Backing up: persistence/backing-up.md
      - Configuration: configuration.md
      - Deployment: deployment.md
  - AI:
      - Choosing a model: ai/choosing-a-model.md
      - Managing models: ai/managing-models.md
      - Using Ollama: ai/using-ollama.md
      - Using Open WebUI: ai/using-open-webui.md
  - Apps:
      - Password management: apps/password-management.md
      - Encrypting files (GPG): apps/encrypting-files-gpg.md
      - Secure delete: apps/secure-delete.md
  - Advanced:
      - GPU setup: advanced/gpu-setup.md
      - GPU passthrough (VMs): advanced/gpu-passthrough.md
      - Running in a VM: advanced/running-in-a-vm.md
      - Boot options: advanced/boot-options.md
  - Privacy:
      - Introduction: privacy/introduction-to-privacy.md
      - Privacy mode (Tor): privacy/privacy-mode-tor.md
      - MAC address anonymization: privacy/mac-address-anonymization.md
      - Offline mode: privacy/offline-mode.md
  - Examples:
      - Local AI assistant: examples/local-ai-assistant.md
      - Crypto cold signing: examples/crypto-cold-signing.md
      - Travel and network hardening: examples/travel-and-network-hardening.md
  - Reference:
      - Architecture:
          - Overview: architecture/overview.md
          - Components: architecture/components.md
          - Data flow: architecture/data-flow.md
      - Skills: skills.md
      - Keyboard shortcuts: reference/keyboard-shortcuts.md
      - FAQ: reference/faq.md
      - Glossary: reference/glossary.md
  - About:
      - Philosophy: PHILOSOPHY.md
      - Vision: VISION.md
      - Roadmap: roadmap.md
      - Changelog: CHANGELOG.md
```

You can shrink this for a smaller starter site, but Material tolerates an unbalanced tree poorly: half the nav features assume you have at least two levels. Stub the files with one-line placeholders for now; you can fill them in later.

---

## Step 4 — Build the parallax hero template

Create `pai-fresh/overrides/home.html`. This file extends Material's `base.html` and overrides the `tabs` block — the slot that normally renders the top tab bar — to inject the entire parallax. We also blank out the standard content and footer blocks for the home route so the hero owns the whole viewport:

```jinja
{% extends "base.html" %}

{% block tabs %}
  {{ super() }}
  <style>
    .md-header{position:initial}
    .md-main__inner{margin:0}
    .md-main__inner > .md-content{display:none}
    @media screen and (min-width:60em){.md-main__inner > .md-sidebar--secondary{display:none}}
    @media screen and (min-width:76.25em){.md-main__inner > .md-sidebar--primary{display:none}}
  </style>

  <div class="mdx-parallax" data-mdx-component="parallax">

    <section class="mdx-parallax__group" data-md-color-scheme="slate">
      <picture class="mdx-parallax__layer" style="--md-parallax-depth: 8; --md-image-position: 70%">
        <source type="image/avif" srcset="{{ 'assets/hero/1-landscape@4x.avif' | url }}">
        <img src="{{ 'assets/hero/1-landscape@4x.avif' | url }}" alt="" class="mdx-parallax__image" draggable="false">
      </picture>
      <picture class="mdx-parallax__layer" style="--md-parallax-depth: 5; --md-image-position: 25%">
        <source type="image/avif" srcset="{{ 'assets/hero/2-plateau@4x.avif' | url }}">
        <img src="{{ 'assets/hero/2-plateau@4x.avif' | url }}" alt="" class="mdx-parallax__image" draggable="false">
      </picture>
      <picture class="mdx-parallax__layer" style="--md-parallax-depth: 2; --md-image-position: 40%">
        <source type="image/avif" srcset="{{ 'assets/hero/5-plants-1@4x.avif' | url }}">
        <img src="{{ 'assets/hero/5-plants-1@4x.avif' | url }}" alt="" class="mdx-parallax__image" draggable="false">
      </picture>
      <picture class="mdx-parallax__layer" style="--md-parallax-depth: 1; --md-image-position: 50%">
        <source type="image/avif" srcset="{{ 'assets/hero/6-plants-2@4x.avif' | url }}">
        <img src="{{ 'assets/hero/6-plants-2@4x.avif' | url }}" alt="" class="mdx-parallax__image" draggable="false">
      </picture>

      <div class="mdx-parallax__layer mdx-parallax__blend"></div>

      <div class="mdx-hero" data-mdx-component="hero">
        <div class="mdx-hero__scrollwrap md-grid">
          <div class="mdx-hero__inner">
            <div class="mdx-hero__teaser md-typeset">
              <h1>Your AI. Your keys. Your OS.</h1>
              <p>PAI is a full Linux desktop on a USB drive — private AI, cold-signing, encryption, all of it local. Plug into any machine, boot into your own workspace in seconds, pull the drive. No cloud, no account, nothing left behind.</p>
              <a href="{{ 'quickstart/' | url }}" class="md-button md-button--primary">Quickstart</a>
              <a href="{{ 'general/how-pai-works/' | url }}" class="md-button">Learn more</a>
            </div>
            <div class="mdx-hero__more">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11 4h2v12l5.5-5.5 1.42 1.42L12 19.84l-7.92-7.92L5.5 10.5 11 16z"/></svg>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="mdx-parallax__group mdx-pillars" data-md-color-scheme="slate">
      <div class="mdx-pillars__inner">
        <div class="mdx-pillar">
          <h3 class="mdx-pillar__title">Runs in RAM, leaves no trace</h3>
          <p class="mdx-pillar__body">Boot from USB into a full Debian + Sway desktop that lives entirely in memory. Your host disk is never touched. Pull the drive and nothing remains.</p>
        </div>
        <div class="mdx-pillar">
          <h3 class="mdx-pillar__title">Local AI, any model, your hardware</h3>
          <p class="mdx-pillar__body">Ollama and Open WebUI are preinstalled. Run Llama, Mistral, Qwen, Gemma, or your own GGUF, with GPU offload on CUDA, ROCm, or Metal. No API keys, no quotas, no telemetry.</p>
        </div>
        <div class="mdx-pillar">
          <h3 class="mdx-pillar__title">Privacy by construction</h3>
          <p class="mdx-pillar__body">Hardened defaults, optional Tor routing, MAC randomization, and a LUKS-encrypted persistence option when you want to keep work between boots. Designed to be boring to surveil.</p>
        </div>
      </div>
    </section>

    <section class="mdx-parallax__group mdx-intro" data-md-color-scheme="slate">
      <div class="mdx-intro__inner">
        <div class="mdx-intro__card">
          <h2>Overview</h2>
          <p>PAI is a bootable USB Linux distribution that runs Ollama and Open WebUI locally. A complete offline AI workstation that lives entirely in RAM and leaves zero trace on your host machine.</p>
          <a href="{{ 'general/how-pai-works/' | url }}" class="md-button">How PAI works →</a>
        </div>
        <div class="mdx-intro__card">
          <h2>Quickstart</h2>
          <p>Download the ISO, flash a USB stick, and boot from it. First launch takes under two minutes from power-on to a working local AI chat.</p>
          <ol>
            <li>Grab the latest ISO from <a href="https://pai.direct">pai.direct</a></li>
            <li>Flash with <code>dd</code>, Rufus, or Raspberry Pi Imager</li>
            <li>Boot your machine from USB and pick a model</li>
          </ol>
          <a href="{{ 'quickstart/' | url }}" class="md-button md-button--primary">Get started →</a>
        </div>
      </div>
    </section>

  </div>
{% endblock %}

{% block content %}{% endblock %}
{% block footer %}{{ super() }}{% endblock %}
```

Things worth understanding here:

- The four `<picture>` elements are the parallax layers. Their order in the DOM is back-to-front: layer 1 is the deepest (the landscape, depth 8); layer 4 is the closest (foreground plants, depth 1). The browser walks the DOM in document order, so this also matches paint order, which is what we want when `z-index` is computed from depth in the stylesheet.
- The `--md-parallax-depth` and `--md-image-position` CSS custom properties are set inline. The stylesheet reads them via `var()` to compute the transform. Per-layer values stay in the template; global behaviour stays in the stylesheet.
- The `.mdx-parallax__blend` div is a transparent-to-background gradient that fades the hero into the page. Without it, the hero ends with a hard edge against the next section.
- The `.mdx-hero__scrollwrap` uses `position: sticky; top: 0; height: 100vh` so the hero text stays pinned in the viewport while the layers scroll under it. The `margin-bottom: -100vh` cancels the sticky element's contribution to the scroll height — the section is 140vh tall, the text is sticky for 100vh of that, and we want the next section to start at 140vh, not 240vh.

---

## Step 5 — Wire up `home.css`

Create `pai-fresh/src/assets/stylesheets/home.css`. The full contents are reproduced below; every block is annotated so you understand which lines you can change without breaking the effect:

```css
:root {
  --md-parallax-perspective: 2.5rem;
}

.md-main__inner { margin: 0; }
.md-main__inner > .md-content,
.md-main__inner > .md-sidebar--secondary { display: none; }

.md-header:not(.md-header--shadow) {
  background-color: initial;
  transition: background-color 125ms, transform 125ms cubic-bezier(.1, .7, .1, 1), box-shadow 0ms;
}
.md-header--shadow {
  transition: background-color .25s, transform .25s cubic-bezier(.1, .7, .1, 1), box-shadow .25s;
}

/* Scroll container */
.mdx-parallax {
  height: 100vh;
  margin-top: -2.4rem;
  overflow: hidden auto;
  overscroll-behavior-y: none;
  perspective: var(--md-parallax-perspective);
  scroll-behavior: smooth;
  width: 100vw;
}

/* Sections */
.mdx-parallax__group {
  background-color: var(--md-default-bg-color);
  color: var(--md-typeset-color);
  display: block;
  position: relative;
  transform-style: preserve-3d;
}

/* Hero section is taller than the viewport so layers have room to travel */
.mdx-parallax__group:first-child {
  background-color: initial;
  contain: strict;
  height: 140vh;
}

/* Layers */
.mdx-parallax__layer {
  height: max(120vh, 100vw);
  pointer-events: none;
  position: absolute;
  top: 0;
  transform:
    translateZ(calc(var(--md-parallax-perspective) * var(--md-parallax-depth) * -1))
    scale(calc(var(--md-parallax-depth) + 1));
  transform-origin: 50vw 50vh;
  width: 100vw;
  z-index: calc(10 - var(--md-parallax-depth, 0));
}

.mdx-parallax__image {
  display: block;
  height: 100%;
  object-fit: cover;
  object-position: var(--md-image-position, 50%);
  position: absolute;
  width: 100%;
  z-index: -1;
}

.mdx-parallax__blend {
  background-image: linear-gradient(to bottom, transparent, var(--md-default-bg-color));
  bottom: 0;
  height: min(100vh, 100vw);
  top: auto;
}

/* Hero text */
.mdx-hero { display: block; height: inherit; }
.mdx-hero__scrollwrap {
  height: 100vh;
  margin-bottom: -100vh;
  position: sticky;
  top: 0;
  z-index: 9;
}
.mdx-hero__inner {
  bottom: 3.2rem;
  display: block;
  position: absolute;
  width: 100%;
}
.mdx-hero__teaser {
  color: var(--md-primary-bg-color);
  margin: 0 .8rem;
  max-width: 27rem;
}
.mdx-hero__teaser :not(.md-button) { text-shadow: 0 0 .2rem #211d2dcc; }

@media screen and (min-width: 60em)    { .md-sidebar--secondary { display: none; } }
@media screen and (min-width: 76.25em) { .md-sidebar--primary   { display: none; } }
```

The mental model for the depth formula is short. The scroll container has `perspective: 2.5rem`. A layer with `--md-parallax-depth: 5` ends up at `translateZ(-12.5rem)` — five times the perspective, pushed away from the camera. Because the projection shrinks distant things, we counter with `scale(6)` (depth + 1) so the layer still fills the viewport. The browser, when scrolling the container, applies its standard 3D projection math; layers further from the camera traverse less screen distance per unit of scroll. That is the parallax. There is no JavaScript timer interpolating positions, no `scroll` event handler reading `window.scrollY` and updating transforms, no `requestAnimationFrame` loop. The animation is a side-effect of how the browser already renders 3D transforms during scroll.

---

## Step 6 — Generate hero artwork

You need four images. The pai instance uses landscape photography — a far horizon, a mid-distance plateau, near plants, and very near plants — but the technique works for anything as long as the layers are visually separable by depth.

You have three reasonable sourcing paths:

1. **Photograph it yourself.** Take four photos that genuinely sit at different depths, then composite the foreground layers onto transparent backgrounds in any image editor.
2. **Use stock.** Find a single landscape image and slice it into depth-sorted strata in Photoshop or Affinity. Less convincing, but quick.
3. **Generate with AI.** This is what the upstream repo's `agents/image-agent.md` and `.claude/commands/generate-prompts.md` are for. Ask a diffusion model for a single coherent landscape, then ask for matching foreground passes with transparent backgrounds. Aim for 4096×2304 source images so the AVIF encode has headroom.

For each layer, export PNG at 4× density (suffix `@4x`), with transparent backgrounds for everything except the deepest landscape layer. Filenames must match the template:

- `1-landscape@4x.png` — full background, opaque
- `2-plateau@4x.png` — mid-distance silhouette, transparent elsewhere
- `5-plants-1@4x.png` — near foreground, transparent elsewhere
- `6-plants-2@4x.png` — closest foreground, transparent elsewhere

The numbering is intentionally non-sequential so you can drop in extra layers (3, 4) later without renaming everything.

---

## Step 7 — Convert to AVIF

AVIF is the format the parallax assumes, and not by accident. At equivalent quality it is three to five times smaller than PNG, and the alpha channel is first-class — critical for the foreground layers.

With `avifenc`:

```bash
for src in pai-fresh/src/assets/hero/*.png; do
  avifenc --min 28 --max 36 --speed 4 "$src" "${src%.png}.avif"
done
```

With `ffmpeg`:

```bash
for src in pai-fresh/src/assets/hero/*.png; do
  ffmpeg -y -i "$src" -c:v libaom-av1 -still-picture 1 -crf 32 -b:v 0 "${src%.png}.avif"
done
```

Sanity-check sizes. A 4096×2304 photographic layer should land between 250 and 600 KB. Foreground plant layers with large transparent areas often come in under 80 KB. If a layer is over a megabyte, your quality setting is too aggressive or your source image has too much noise.

Place every `.avif` file in `pai-fresh/src/assets/hero/`. Delete the source PNGs from the docs tree once you have committed them somewhere safe (the repo's `pai/images/SCREENSHOTS.md` notes where the originals live).

---

## Step 8 — Tune depth, position, and crop

This is the artistic step. You set four numbers per layer: depth (Z distance), object-position (which slice of the image is visible), the section height, and the global perspective. Tune in this order:

1. **Depths.** Start with `8 / 5 / 2 / 1` for four layers. The ratio matters more than the absolute values. If layer 1 feels too aggressive, raise it to 10. If two adjacent layers visually merge, push them apart.
2. **Object positions.** A landscape with the horizon in the upper third looks correct at `--md-image-position: 70%` (bottom-of-image is what shows). Foregrounds with subjects on the left often want `25%` or `40%`.
3. **Hero height.** The `.mdx-parallax__group:first-child { height: 140vh }` rule sets the scroll length of the hero. Longer hero = slower-feeling effect. The media-query block in the reference stylesheet bumps height up to `150vw` on very wide viewports so the layers do not run out of vertical room before the user reaches the next section.
4. **Perspective.** `--md-parallax-perspective: 2.5rem` is small. Smaller perspective = more dramatic depth. If you raise it to `5rem` the parallax becomes subtle; lower to `1.5rem` and it becomes operatic. Tune last; everything else is sensitive to it.

Reload the page after every change. The effect is small enough that screenshots lie — you have to scroll it.

---

## Step 9 — Author content pages

For every file you touched in Step 2, write at least a placeholder. Material renders empty markdown files as page-not-found, which breaks the nav. The bare minimum for a stub is:

```markdown
# Choosing a model

Coming soon. See [Managing models](managing-models.md) for related guidance.
```

A handful of pages deserve real content from day one because they are linked from the hero CTAs:

- `src/index.md` — gets shadowed by the parallax hero on the home route, but search and the sitemap still index it. Put a short, factual paragraph in plain markdown so screen readers and crawlers see something real.
- `src/quickstart.md` — the "Quickstart" button on the hero points here. This is the single most important page after the home; write it carefully.
- `src/general/how-pai-works.md` — the "Learn more" button. Three sections: the hardware story (USB, RAM-only), the software story (Debian + Sway + Ollama), and the privacy story (Tor, MAC randomization, LUKS persistence).

Use Material's admonition extension for callouts:

```markdown
!!! warning "USB drives wear out"
    Flash storage has a finite write count. If you enable persistence,
    use a quality drive — Samsung BAR Plus, SanDisk Extreme Pro, or
    similar — and back up your encrypted volume regularly.
```

Use tabbed content blocks for platform-specific install steps:

```markdown
=== "macOS"
    ```bash
    diskutil list
    sudo dd if=pai.iso of=/dev/rdiskN bs=1m
    ```

=== "Linux"
    ```bash
    lsblk
    sudo dd if=pai.iso of=/dev/sdX bs=4M status=progress
    ```

=== "Windows"
    Use Rufus or Raspberry Pi Imager.
```

Both are enabled in the `markdown_extensions` block from Step 3.

---

## Step 10 — Add brand CSS

The parallax stylesheet handles the hero. Brand styling — accent colours, button shapes, link decoration — goes in a second stylesheet. Create `pai-fresh/src/assets/pai-theme.css`:

```css
:root {
  --md-primary-fg-color:        #0e7c66;
  --md-primary-fg-color--light: #14a484;
  --md-primary-fg-color--dark:  #094f41;
  --md-accent-fg-color:         #14a484;
}

[data-md-color-scheme="slate"] {
  --md-default-bg-color:        #0a0d10;
  --md-default-fg-color:        #e6e9ec;
  --md-typeset-color:            #d8dde2;
  --md-typeset-a-color:          #14a484;
}

.md-button--primary {
  background-color: var(--md-primary-fg-color);
  border-color:     var(--md-primary-fg-color);
}

.mdx-pillars__inner,
.mdx-intro__inner {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 2rem;
  max-width: 64rem;
  margin: 0 auto;
  padding: 6rem 1.5rem;
}

.mdx-pillar__title { font-size: 1.25rem; margin-bottom: .5rem; }
.mdx-pillar__body  { color: var(--md-default-fg-color--light); line-height: 1.6; }

.mdx-intro__card {
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: .5rem;
  padding: 2rem;
}
```

Both stylesheets are listed under `extra_css` in `mkdocs.yml`. Order matters: load `pai-theme.css` first so `home.css` can override it where needed.

---

## Step 11 — Run it locally

From the repo root:

```bash
cd pai-fresh
mkdocs serve --dev-addr 0.0.0.0:8000
```

Open `http://localhost:8000`. You should see the hero, the pillars, the intro cards, and a working tab nav. Scroll the hero — the foreground plants should blur past faster than the distant landscape. If they all move at the same speed, your `transform-style: preserve-3d` got dropped from `.mdx-parallax__group`, or the `perspective` is on the wrong element (must be on `.mdx-parallax`, not `body`).

Common first-run issues:

- **Blank hero, all layers white.** AVIF source paths are wrong. Open devtools → Network and check the asset URLs. The Jinja `{{ '...' | url }}` filter resolves relative to the site URL, not the markdown file.
- **Hero text scrolls with the layers.** The `.mdx-hero__scrollwrap` lost its `position: sticky`. Some Material updates inject conflicting layout into `.md-grid`; if you upgrade, recheck.
- **Hero is tiny on Safari.** Safari interprets `contain: strict` differently on the first paint. The reference stylesheet ships a `.safari .mdx-parallax__group:first-child { contain: none; }` opt-out keyed on a class you set with one line of JS in your override (`document.documentElement.classList.add('safari')` inside a UA sniff). Do this in `overrides/main.html` if you care about Safari users.
- **Hero is jumpy on Firefox.** Same fix, different class: `.ff-hack`. Firefox's containment behaviour pre-115 produced visible flashes; the override turns containment off entirely on those builds.

---

## Step 12 — Deploy to GitHub Pages

The pai site lives at `docs.pai.direct`, served by GitHub Pages from the `gh-pages` branch of `nirholas/pai`. Replicate the same setup on your fork.

Add a deploy workflow at `.github/workflows/pages.yml`:

```yaml
name: Deploy docs

on:
  push:
    branches: [main]
    paths:
      - 'pai-fresh/**'
      - '.github/workflows/pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip
      - run: pip install -r pai-fresh/requirements.txt
      - run: mkdocs build --config-file pai-fresh/mkdocs.yml --strict
      - uses: actions/upload-pages-artifact@v3
        with:
          path: pai-fresh/_site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

The `--strict` flag in the build step turns broken links and missing nav targets into hard errors. Use it; the alternative is silently shipping 404s.

In the repo settings, under Pages, choose "GitHub Actions" as the source. Push to `main`, watch the workflow, and the site will publish to `https://<your-user>.github.io/<repo>/`.

---

## Step 13 — Wire up the custom domain

For `docs.pai.direct` (or whatever subdomain you control), add a `CNAME` record at your DNS host pointing the subdomain to `<your-user>.github.io`. Then in the repo, create `pai-fresh/src/CNAME`:

```
docs.pai.direct
```

Material copies any file in `docs_dir` to the build output verbatim, so `_site/CNAME` lands in the gh-pages artifact and Pages picks it up. After the first deploy, GitHub will provision a Let's Encrypt certificate automatically — usually within ten minutes, sometimes longer. Tick "Enforce HTTPS" in the Pages settings once it is available.

---

## Step 14 — Performance and accessibility

A few non-negotiables before you call it done:

- **Decorative alt text.** All four parallax layers carry `alt=""` and `draggable="false"` because they are decoration. Screen readers will skip them, which is correct — the meaningful content is the hero text.
- **Reduced motion.** The parallax respects scroll speed but does not honour `prefers-reduced-motion`. Add a media query that flattens the depth for users who request it:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .mdx-parallax__layer { transform: none; }
    .mdx-hero__more      { animation: none; }
  }
  ```
- **Focus order.** The sticky hero text sits inside the same DOM section as the layers, so tabbing works without surprises. Verify by tabbing from the hero CTAs into the pillars without using the mouse.
- **Lighthouse.** Aim for 95+ on Performance, 100 on Accessibility. The parallax costs almost nothing at runtime — no JS, decoded AVIFs are cached by the browser — but if a layer is oversized you will see a bad LCP score. Resize sources before encoding rather than relying on `object-fit` to compensate.

---

## Step 15 — Iterate

You now have the entire pai site standing up locally and on a custom domain. Everything past this point is content. Keep these habits as you fill in pages:

- **Run `mkdocs build --strict` before every commit.** It catches broken links earlier than CI.
- **Diff your `mkdocs.yml` carefully.** A single mis-indented nav entry can hide an entire section from the sidebar.
- **Compress new artwork up front.** Resist the temptation to commit a 2 MB PNG and "fix it later". Later does not arrive.
- **Tune the hero with users present.** The parallax is the brand. Grab a colleague, screen-share, scroll the page, and watch their reaction. If they do not notice the depth in the first three seconds, your layer separation is too subtle. If they comment on it before reading the text, it is too loud.

---

## Where to look in the reference repo

When something does not match, compare against the upstream files directly. The most useful ones, in order:

- [`pai/mkdocs.yml`](https://github.com/nirholas/scroll-zoom-thing/blob/main/pai/mkdocs.yml) — production config
- [`pai/overrides/home.html`](https://github.com/nirholas/scroll-zoom-thing/blob/main/pai/overrides/home.html) — production hero with pillars and intro cards
- [`docs/assets/stylesheets/home.css`](https://github.com/nirholas/scroll-zoom-thing/blob/main/docs/assets/stylesheets/home.css) — annotated stylesheet
- [`docs/how-it-works.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/docs/how-it-works.md) — the math, in prose
- [`docs/your-own-layers.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/docs/your-own-layers.md) — guidance on choosing depths and crops
- [`agents/image-agent.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/agents/image-agent.md) — prompts for AI-generated artwork
- [`.claude/commands/setup-parallax.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/.claude/commands/setup-parallax.md) — slash-command bundle for Claude Code that scaffolds the whole parallax in one go

The repo also ships `llms.txt` and `llms-full.txt` files that summarise the technique for AI assistants. If you ask Claude or another agent to extend the site, point it at those files first; they are the most concise statement of intent the project has.

---

## Closing notes

What you have built is a complete documentation site whose landing page is a piece of standard browser geometry — `perspective`, `translateZ`, `scale`, `position: sticky`. The parallax has no JavaScript, no animation library, no scroll-driven layout calculations. It is fast on a 2015 laptop, smooth on a phone, accessible to a screen reader, and degrades to a stack of static images on browsers that do not support `perspective` (a vanishingly small set in 2026).

The same pattern works for any product site. Swap the artwork, retune the depths, rewrite the hero copy, and you have your own version. The thing that took the upstream maintainers the longest was not the CSS — it was discovering that the trick is to let the browser do the work, and to stop reaching for JavaScript every time the word "parallax" appears in a design.

Ship it.

---

# Part Two — Going deeper

The first half of this tutorial gets you to a working pai clone. The second half is the long tail: extra companion pages, the AI prompt strategy that produced the upstream artwork, the Safari and Firefox JavaScript escapes, multi-section parallax, content-authoring patterns, and a checklist for the moment before you flip DNS.

Skip ahead if you only need a specific section. Everything below is independently useful.

---

## Step 16 — Add the technique-explainer pages

The pai site links the marketing hero to a real explanation of how the parallax works. Two short companion pages do the heavy lifting in the upstream repo, and you should ship them on your fork too — they answer questions you will otherwise field over Twitter for the next year.

Create `pai-fresh/src/development/how-parallax-works.md`:

```markdown
---
title: How CSS 3D Parallax Works
description: Technical deep-dive into CSS perspective, translateZ, and scale.
---

# How CSS 3D Parallax Works

A CSS `perspective` value on a scroll container creates a 3D vanishing
point. Any child element with a `translateZ` transform is rendered at
a perceived depth — and because it is visually further away, it
appears to move slower as the container scrolls. This is not
simulated. It is the browser's real 3D projection math applied to
normal scroll rendering.

## The four pieces

1. **The scroll container.** `.mdx-parallax` has `overflow: hidden auto`
   and `perspective: 2.5rem`. The element scrolls; `html` and `body`
   do not.

2. **Depth via `translateZ`.** Each layer is pushed back by
   `depth × perspective`. A layer at depth 8 sits at `translateZ(-20rem)`.
   Because it is further from the camera, it covers less screen
   distance per unit of scroll. That is the parallax.

3. **Scale compensation.** `scale(depth + 1)` undoes the apparent size
   reduction from pushing the layer back. Without it, deeper layers
   would render smaller than the viewport.

4. **Sticky hero text.** The hero copy lives inside a
   `position: sticky` wrapper with `margin-bottom: -100vh`. It pins
   to the viewport while the layers scroll behind it, then releases
   when the next section arrives.
```

Then `pai-fresh/src/development/your-own-layers.md`, which is the page someone reads when they decide to swap the artwork:

```markdown
---
title: Using your own layers
description: How to create and export layered AVIF images.
---

# Using your own layers

## Image requirements

| Property      | Recommendation                                |
|---------------|------------------------------------------------|
| Format        | AVIF (best), WebP fallback, PNG last resort    |
| Dimensions    | Wide panorama — at least 1920×600              |
| Transparency  | Required for mid and foreground layers         |
| Naming        | `1-far@4x.avif`, `2-mid@4x.avif`, etc.         |

## How many layers

Four is the sweet spot. Fewer and the effect is subtle; more and you
are paying file size for imperceptible depth.

| Layer | Contents                              | Depth |
|-------|----------------------------------------|-------|
| 1 Far | Sky, horizon — opaque                  | 8     |
| 2 Mid | Buildings, terrain — transparent       | 5     |
| 3 Near| Foliage, structures — transparent      | 2     |
| 4 Front| Closest plants, frame — transparent   | 1     |

## Wiring layers in `home.html`

Each `<picture>` gets two inline custom properties:

- `--md-parallax-depth` — how far back the layer sits
- `--md-image-position` — maps to `object-position`, picks which
  vertical slice is visible (0% top, 100% bottom)

Tune `--md-image-position` per layer. A landscape with the horizon in
the upper third often wants 70% (so the bottom of the image shows).
A foreground with subjects on the left wants 25%.
```

Both pages should appear in the Development section of `mkdocs.yml`:

```yaml
- Development:
    - How parallax works: development/how-parallax-works.md
    - Use your own layers: development/your-own-layers.md
```

These pages are short on purpose. They link from the hero "Learn more" button as a fallback — anyone who sees the parallax and wants to know how it was built lands here within two clicks.

---

## Step 17 — A serious AI image-generation workflow

The reference repo's `agents/image-agent.md` exists because making four cohesive layers is the single hardest part of building a parallax site. A photo set that does not depth-sort is the difference between a site that ships and a site that drags for two months. Here is the workflow the pai artwork was generated with, distilled into something you can run without an agent.

### Decide the scene before prompting

Write a one-sentence brief covering subject, time of day, palette, and aspect. Example: *"A high desert plateau at blue hour, indigo and slate palette, 16:5 panoramic, sparse foreground vegetation."* This sentence becomes the style anchor that every layer prompt repeats verbatim. Layers that drift in lighting or palette will not composite — you will spend an afternoon trying to colour-correct them and conclude you have to start over.

### Layer prompts

For each of the four layers, prompt for the same scene at a different depth plane. The key trick is that each prompt asks for **only** the elements at that depth and explicitly excludes everything else. Use this structure:

```
[STYLE ANCHOR sentence, verbatim from above]

Subject for this depth plane:
[depth 8] - "the distant landscape only — sky, horizon, mountains.
            No mid-distance plateau. No foreground. Opaque background."
[depth 5] - "the mid-distance plateau only — silhouette of plateau
            and rolling hills. No sky. No foreground vegetation.
            Transparent background."
[depth 2] - "near-foreground vegetation only — sparse desert plants
            standing 0.5–2 metres tall. No plateau. No sky.
            Transparent background."
[depth 1] - "very-near foreground only — tall grasses and a single
            agave silhouette occupying the bottom third of the frame.
            No mid-ground. No sky. Transparent background."

Aspect: 16:5 panoramic. Render: 4096 × 1280 minimum.
```

### Tool-specific notes

- **Google ImageFX** — the upstream pai layers were generated here. ImageFX produces clean cut-outs when you specify "no background" explicitly, and the per-prompt style consistency is good enough to skip a separate style-locking step.
- **Midjourney** — add `--ar 16:5 --style raw` and use `--no background` for transparent layers. Style-lock with `--sref` to a single reference URL so all four layers inherit the same look.
- **DALL·E 3** — paste the style anchor verbatim into every prompt. Add `"isolated on white"` and remove the white in post with `rembg`; DALL·E does not honour `transparent PNG` reliably.
- **Stable Diffusion** — ControlNet depth maps are the secret weapon. Generate one full scene, extract the depth map, then run inpainting four times to isolate each depth plane. This produces the cleanest cohesion of any tool but takes the longest.

### Background removal

If your tool does not produce true alpha, run the layers through `rembg`:

```bash
pip install "rembg[cli]"
for f in pai-fresh/src/assets/hero/*-raw.png; do
  rembg i --alpha-matting "$f" "${f%-raw.png}.png"
done
```

`--alpha-matting` matters for vegetation: without it, leaf edges become hard mattes and the foreground reads as cardboard.

### Checking before encoding

Open all four PNGs in any image editor as a stack, deepest at the bottom. Toggle each layer on and off. The full stack should read as a coherent scene. The deepest layer alone should read as a flat backdrop. Each transparent layer alone should read as a meaningful silhouette against a checkerboard. If any of those three checks fail, regenerate that layer before encoding to AVIF — it is much easier to fix at PNG stage.

---

## Step 18 — The Safari and Firefox JavaScript escapes

The pure-CSS parallax is pure-CSS in the steady state. The two browser bugs that justify a few lines of JavaScript live entirely in the boot path; once the page has scrolled three thousand pixels, the JS unbinds and never runs again.

Add `pai-fresh/overrides/main.html` to extend Material's base layout with a tiny header script:

```jinja
{% extends "base.html" %}

{% block extrahead %}
  {{ super() }}
  <script>
    // Safari treats `contain: strict` so aggressively that scaled-up
    // 3D layers get clipped to invisibility. Detect Safari and let
    // the stylesheet opt out via the `.safari` class.
    if (navigator.vendor === "Apple Computer, Inc.") {
      document.documentElement.classList.add("safari");
    }

    // Firefox shows a one-frame flash on the first scroll because
    // its containment painter releases later than Chromium's.
    // The fix: set `.ff-hack` on body until the user has scrolled
    // past the danger zone, then remove it.
    if (navigator.userAgent.includes("Gecko/")) {
      document.body.classList.add("ff-hack");
      const el = document.querySelector(".mdx-parallax");
      if (el) {
        const handler = () => {
          if (el.scrollTop > 3000) {
            document.body.classList.remove("ff-hack");
            el.removeEventListener("scroll", handler);
          } else {
            document.body.classList.toggle("ff-hack", el.scrollTop <= 1);
          }
        };
        el.addEventListener("scroll", handler, { passive: true });
      }
    }
  </script>
{% endblock %}
```

The corresponding stylesheet rules already live in `home.css` from Step 5:

```css
.safari .mdx-parallax__group:first-child { contain: none; }
.ff-hack .mdx-parallax__group:first-child { contain: none !important; }
```

Two notes on the trade-off. First, this is the only JavaScript on the home page. Stripping it out costs you Safari and Firefox visitors who would otherwise see a clipped or flashing hero. Second, the UA sniff is intentional. Feature detection does not help here; the bugs are about how the browser implements features it claims to support. UA sniffs age badly in general but age fine for "is this engine WebKit or Gecko."

---

## Step 19 — Multiple parallax sections

The pai instance has three sections: the hero, the pillars, and the intro cards. The reference `docs/overrides/home.html` only has one. Once you understand how the second and third sections compose, you can add as many as you like.

The structure is identical for every group:

```html
<section class="mdx-parallax__group" data-md-color-scheme="slate">
  <!-- content -->
</section>
```

What changes between groups is:

- **The first group has layers and is taller than 100vh.** It contains the `<picture>` elements and the sticky hero. Its height is 140vh on narrow viewports, scaling with width on wider ones.
- **Subsequent groups are normal-height content panels.** They do not contain `<picture>` elements. They use `data-md-color-scheme` to switch between slate and default as the user scrolls. They get their own padding and grid layouts via per-section classes (`mdx-pillars`, `mdx-intro`).

The transition between groups is visual: as the user scrolls past the hero, the gradient blend layer fades the hero into the page background, and the next group's solid background takes over. There is no JavaScript fade; both groups simply render in the same scroll container, and the blend layer sits on top of the layers but below the next group.

To add a fourth section — say, a "frequently asked questions" panel — append another group inside `.mdx-parallax`:

```html
<section class="mdx-parallax__group mdx-faq" data-md-color-scheme="default">
  <div class="mdx-faq__inner">
    <h2>Frequently asked</h2>
    <details>
      <summary>Does PAI work without internet?</summary>
      <p>Yes. Models you have already pulled run entirely locally.</p>
    </details>
    <!-- more <details> -->
  </div>
</section>
```

Then style `.mdx-faq` and `.mdx-faq__inner` in `pai-theme.css` the same way you styled `.mdx-pillars`. The parallax does not care how many groups you add.

---

## Step 20 — Responsive depth tuning

The depth values that look right on a 14-inch laptop look subtle on a 32-inch ultrawide. Two strategies handle this without breaking the basic effect.

**Strategy A — scale perspective with viewport.** Replace the static `:root { --md-parallax-perspective: 2.5rem; }` with a clamp:

```css
:root {
  --md-parallax-perspective: clamp(1.5rem, 2.5vw, 3rem);
}
```

This shrinks perspective on small screens (more dramatic depth) and grows it on big ones (more subtle). It is a one-liner and covers most cases.

**Strategy B — adjust depth at breakpoints.** When clamping is not enough, override per-layer depths inside a media query:

```css
@media (min-width: 120em) {
  .mdx-parallax__layer:nth-child(1) { --md-parallax-depth: 10; }
  .mdx-parallax__layer:nth-child(2) { --md-parallax-depth: 7; }
  .mdx-parallax__layer:nth-child(3) { --md-parallax-depth: 3; }
  .mdx-parallax__layer:nth-child(4) { --md-parallax-depth: 1.5; }
}
```

Use Strategy A for everyone, then layer Strategy B on top for ultrawide if you actually have ultrawide users to test on. Do not apply B blindly; on a 16:9 monitor it just makes the foreground feel detached.

The hero height also needs to grow with viewport width or layers run out of vertical room. The default stylesheet ships with these breakpoints:

```css
@media (min-width: 125vh)   { .mdx-parallax__group:first-child { height: 120vw; } }
@media (min-width: 150vh)   { .mdx-parallax__group:first-child { height: 130vw; } }
@media (min-width: 200vh)   { .mdx-parallax__group:first-child { height: 150vw; } }
@media (min-width: 250vh)   { .mdx-parallax__group:first-child { height: 160vw; } }
```

The unit is intentional: `min-width` in `vh` measures viewport aspect ratio, not absolute width. A 1920×600 ultrawide laptop and a 3840×1200 desktop monitor both have width-greater-than-2×-height, so they both pick up the `min-width: 200vh` rule even though their pixel widths are wildly different.

---

## Step 21 — Performance budget

The site has to feel instant. A parallax that drops frames is worse than no parallax. Set a performance budget before you ship and measure against it.

**Targets:**

- **Largest Contentful Paint (LCP) under 2.0 s** on a Moto G4 throttled to 4× CPU and Slow 4G in Lighthouse.
- **Cumulative Layout Shift (CLS) under 0.05.** The parallax layers have explicit `width: 100vw; height: max(120vh, 100vw)`, so they should not shift. The hero text is sticky, so it should not shift either. CLS should be effectively zero.
- **Interaction to Next Paint (INP) under 200 ms.** The home page has no event handlers; INP only matters once the user navigates to a content page.
- **Total transfer size on home under 800 KB.** Four AVIF layers at 200 KB each is your budget; the Material theme adds about 80 KB CSS and 60 KB JS gzip.

**Three things that wreck the budget if you let them:**

1. **Source AVIFs over a megabyte.** Re-encode at higher CRF or smaller dimensions. A foreground layer with mostly transparent area should weigh under 60 KB.
2. **Preload of the wrong layer.** The `<link rel="preload">` should target the closest layer (depth 1) — that is the one painted on top, the one whose absence is most visible. Preloading the deep landscape is the common mistake; it is the layer the user notices last.
3. **Layout containment turned off everywhere.** The `.safari` and `.ff-hack` opt-outs are scoped to the first group. Do not move `contain: none` higher in the cascade — every group benefits from containment, only the first hero group has the bug.

Run Lighthouse twice: once on a cold load (browser cache cleared, throttling on) and once on a warm reload. Cold should hit 90+ Performance; warm should hit 99+.

---

## Step 22 — Authoring the long tail of content

The home page is the smallest part of a docs site. The PAI nav has roughly seventy markdown files. A few authoring patterns make that volume manageable.

**Use `pymdownx.snippets` for repeated blocks.** Things like the standard install warning, the "needs a UEFI machine" note, or the "this requires persistence enabled" callout should live in `_includes/` and be pulled in with `--8<-- "warnings/needs-persistence.md"`. Editing once updates everywhere.

**Use Mermaid for diagrams, sparingly.** The architecture pages benefit from one or two flowcharts. Avoid stuffing every page with a diagram; Mermaid renders client-side and adds 200 KB of JS to any page that uses it.

**Tabbed install paths.** Quickstart, USB flashing, and persistence pages all need three tabs (macOS, Linux, Windows). Standardise the tab order and labels across the site so users learn to ignore the irrelevant ones.

**Cross-link aggressively.** Material's search is good but cold. The first-time visitor follows links, not search. Every callout that mentions a feature should link to its dedicated page. Every dedicated page should link back to two or three related pages.

**Audit dead links before each release.** Run `mkdocs build --strict` in CI; it fails the build on broken anchors. Do not let strict-mode warnings accumulate; once you have ten, you stop reading them.

---

## Step 23 — Pre-launch checklist

Before you flip DNS and announce, run through this list. Each item takes under a minute; the whole list takes ten.

- [ ] `mkdocs build --strict` passes locally with no warnings.
- [ ] `mkdocs serve` shows the parallax scrolling correctly on Chrome, Safari, Firefox.
- [ ] The hero CTAs (Quickstart, Learn more) point to real pages that exist.
- [ ] All four AVIF layers return 200 in devtools Network panel.
- [ ] No layer is over 600 KB; foreground layers are under 80 KB.
- [ ] Lighthouse Performance ≥ 90, Accessibility = 100, Best Practices = 100, SEO = 100.
- [ ] `prefers-reduced-motion: reduce` flattens the parallax (test by enabling reduce motion in OS settings).
- [ ] Tab order works without a mouse: Tab from page load reaches both hero CTAs in two presses.
- [ ] Search indexes content (open `/search.html` and search for a known string).
- [ ] `site_url` in `mkdocs.yml` matches the production URL exactly.
- [ ] `CNAME` file in `src/` matches the production domain.
- [ ] DNS CNAME record points to `<your-user>.github.io`.
- [ ] HTTPS is enforced in Pages settings; cert is issued.
- [ ] 404 page renders (Material ships one by default; verify it picks up your theme).
- [ ] `robots.txt` and `sitemap.xml` are generated (Material does this automatically when `site_url` is set).
- [ ] Social cards plugin is configured (optional but recommended; sets the Open Graph image so links unfurl on Twitter and Slack).

If every box is ticked, you are done. Push to `main`, watch the Pages workflow, and announce.

---

## Step 24 — Iterating after launch

The first version of the site is wrong. Every site is. The differences between the v1 and v3 of the upstream pai site, judging by commit history, were almost entirely:

1. **Hero copy.** The first hero said too much. The fourth one said the right amount in fewer words. Watch what gets quoted on Twitter; that is the line that should be the H1.
2. **Layer count and depth.** v1 had three layers and felt flat. v3 has four with depths 8/5/2/1. Adding a fifth layer was tested and rolled back; it added file size without perceptible depth.
3. **Pillar copy.** Three pillars is the right number. The pillar bodies got shorter every revision; the final versions are ~30 words each.
4. **Nav tree.** The first nav had every page at the top level. The fourth nav grouped pages under Overview / Getting started / Guides / etc. Users do not read the sidebar from top to bottom; they scan section headers.

Treat launch as the start of authoring, not the end. Keep an `ideas.md` outside the docs tree where you collect things you noticed after shipping; review it monthly; merge the best ones in batches. Resist the urge to redesign the parallax — the depth math is the one thing that does not need to change.

---

## Appendix A — The full file tree

What you should have on disk by the end:

```
scroll-zoom-thing/
├── pai-fresh/
│   ├── mkdocs.yml
│   ├── requirements.txt
│   ├── overrides/
│   │   ├── home.html
│   │   └── main.html
│   └── src/
│       ├── CNAME
│       ├── index.md
│       ├── quickstart.md
│       ├── installation.md
│       ├── using-pai.md
│       ├── general/
│       │   ├── how-pai-works.md
│       │   ├── features-included.md
│       │   ├── system-requirements.md
│       │   └── warnings-and-limitations.md
│       ├── first-steps/
│       ├── ai/
│       ├── apps/
│       ├── advanced/
│       ├── privacy/
│       ├── persistence/
│       ├── examples/
│       ├── architecture/
│       ├── development/
│       │   ├── how-parallax-works.md
│       │   └── your-own-layers.md
│       ├── reference/
│       ├── api/
│       ├── PHILOSOPHY.md
│       ├── VISION.md
│       ├── CHANGELOG.md
│       └── assets/
│           ├── pai-logo-white.png
│           ├── pai-theme.css
│           ├── stylesheets/
│           │   └── home.css
│           └── hero/
│               ├── 1-landscape@4x.avif
│               ├── 2-plateau@4x.avif
│               ├── 5-plants-1@4x.avif
│               └── 6-plants-2@4x.avif
└── .github/
    └── workflows/
        └── pages.yml
```

Roughly seventy markdown files, four AVIFs, two stylesheets, two Jinja overrides, one workflow, one `mkdocs.yml`. That is the entire site.

---

## Appendix B — Common build errors and what they mean

**`Config value: 'docs_dir'. Error: The path 'docs' isn't an existing directory.`**
You forgot to set `docs_dir: src` in `mkdocs.yml`, or you are running `mkdocs` from the wrong directory.

**`The following pages exist in the docs directory, but are not included in the "nav" configuration:`**
Material warns about orphan files. Either add them to the nav or delete them. Strict mode turns this warning into an error; that is on purpose.

**`Doc file 'index.md' contains a link to 'quickstart/' which is not found in the documentation files.`**
The link target uses a directory-style URL but the file does not exist. Either create `quickstart.md` or update the link.

**`unsupported operand type(s) for &: 'str' and 'str'`**
An older `pymdown-extensions` against a newer `mkdocs-material`. Pin both in `requirements.txt`.

**Hero is invisible on first paint, appears after the first scroll on Firefox.**
The `.ff-hack` script is missing or scoped wrong. Re-check `overrides/main.html`.

**Hero layers all render at the same depth on Safari.**
The `.safari` class is not being applied. Check `navigator.vendor === "Apple Computer, Inc."` matches in your script (it does, exactly).

---

## Appendix C — Where to read further

The upstream repo is the canonical reference. After this tutorial, the files most worth reading are:

- [`agents/parallax-agent.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/agents/parallax-agent.md) — instructions for an AI agent that can scaffold the parallax from a single brief.
- [`.claude/commands/tune-layers.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/.claude/commands/tune-layers.md) — slash command that adjusts depths and image positions interactively.
- [`.claude/commands/convert-images.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/.claude/commands/convert-images.md) — automated PNG→AVIF pipeline with sensible quality defaults.
- [`docs/advanced-css.md`](https://github.com/nirholas/scroll-zoom-thing/blob/main/docs/advanced-css.md) — multiple groups, color-scheme transitions, ultrawide tuning.
- [Material for MkDocs reference](https://squidfunk.github.io/mkdocs-material/reference/) — the underlying theme. Almost every visual choice in pai is a Material convention; if something looks like it should be configurable, it usually is.

The technique is small. The art is in the tuning. Build it, scroll it, show it to someone, tune it, repeat.
