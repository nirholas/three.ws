# Mobile input-ergonomics audit

Measured with `scripts/mobile-touch-audit.mjs` against https://three.ws in a real
Pixel 5 Playwright context (Chromium). Every value below is a live computed style or a
measured bounding box, not a source grep.

- Minimum target size checked: 44x44 CSS px
- Inline text links are exempt (WCAG 2.5.8) and counted separately
- Measured: 2026-09-08T17:13:11.901Z

| path | undersized targets | interactive checked | inline-exempt | canvases touch-action:auto / visible | viewport-fit=cover | bottom bars w/o safe-area / total | overflow-x |
|---|---|---|---|---|---|---|---|
| `/docs/start-here` | 308 | 573 | 161 | 0/1 | NO | 0/0 | 0 px |
| `/markets` | 105 | 197 | 0 | 0/1 | yes | 101/101 | 0 px |
| `/` | 70 | 218 | 6 | 0/2 | yes | 0/0 | 0 px |
| `/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` | 30 | 86 | 0 | 0/1 | yes | 1/1 | 0 px |
| `/forge` | 22 | 149 | 1 | 0/2 | yes | 0/0 | 0 px |
| `/changelog` | 11 | 3570 | 4 | 0/1 | NO | 0/0 | 7 px |
| `/ar` | 6 | 14 | 6 | 0/0 | yes | 0/0 | 0 px |
| `/news` | 4 | 122 | 5 | 0/0 | yes | 0/0 | 0 px |
| `/dashboard` | 4 | 36 | 3 | 0/1 | yes | 0/0 | 0 px |
| `/irl` | 4 | 59 | 0 | 0/1 | yes | 5/5 | 0 px |
| `/walk` | 1 | 63 | 0 | 0/1 | yes | 0/0 | 0 px |
| `/marketplace` | 0 | 1654 | 0 | 0/1 | yes | 0/0 | 0 px |
| `/play` | - | - | - | 0/0 | NO | 0/0 | - px |
| `/launches` | - | - | - | 0/0 | NO | 0/0 | - px |

## Detail

### `/docs/start-here`

- undersized targets:
  - 296x `a.sidebar-link 267x30`
  - 1x `a.docs-logo 114x33`
  - 1x `a#world-link.docs-world-link 35x23`
  - 1x `a.btn-primary 58x30`
  - 1x `input#search-input 247x31`
  - 1x `a.sidebar-link.active 267x30`
  - 1x `a.sidebar-link.external 267x30`
  - 1x `button#pagetools-copy.docs-pagetools-btn 110x35`
  - 1x `button#pagetools-caret.docs-pagetools-caret 35x35`
  - 1x `a 146x21`
  - 1x `a 164x21`
  - 1x `a 115x21`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)

### `/markets`

- undersized targets:
  - 100x `a 225x24`
  - 1x `a 317x19`
  - 1x `a 434x19`
  - 1x `a 411x19`
  - 1x `a 471x19`
  - 1x `a 420x19`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
- bottom-anchored bars:
  - `th.left` h=47 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false
  - `td.left.name-cell` h=49 padding-bottom=12px safe-area-rule=false

### `/`

- undersized targets:
  - 29x `a 165x20`
  - 1x `input#hero-forge-input.hero-forge-input 186x36`
  - 1x `button#hero-forge-go.hero-forge-go 110x38`
  - 1x `button.hero-try 101x27`
  - 1x `button.hero-try 98x27`
  - 1x `button.hero-try 113x27`
  - 1x `button.hf-chip.hf-chip--surprise 94x27`
  - 1x `button.hf-chip 110x27`
  - 1x `button.hf-chip 117x27`
  - 1x `button.hf-chip 124x27`
  - 1x `button.hf-chip 103x27`
  - 1x `textarea#hf-prompt-input.hf-prompt 140x35`
- visible canvases:
  - `canvas.walk-preview-canvas` 351x197 touch-action=pan-y (parent auto)
  - `canvas#drop-canvas` 393x627 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas.walk-preview-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 3651 px)
  - `canvas#drop-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 1632 px)

### `/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`

- undersized targets:
  - 5x `a.cv-mkt-x 104x22`
  - 2x `button.cv-range-btn 49x27`
  - 2x `a.cv-mkt-pair 103x17`
  - 2x `a.cv-mkt-pair 698x17`
  - 2x `a.cv-pill 87x36`
  - 2x `a.cv-pill 96x36`
  - 1x `a 38x22`
  - 1x `a 54x22`
  - 1x `button.cv-range-btn 48x27`
  - 1x `button.cv-range-btn 40x27`
  - 1x `button.cv-range-btn 37x27`
  - 1x `button.cv-range-btn 87x27`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
- bottom-anchored bars:
  - `th.left` h=47 padding-bottom=12px safe-area-rule=false

### `/forge`

- undersized targets:
  - 12x `button.showcase-vote 43x44`
  - 3x `button 36x44`
  - 1x `a 70x15`
  - 1x `button 42x44`
  - 1x `a 221x15`
  - 1x `button.showcase-sort-btn.is-active 61x22`
  - 1x `a.showcase-view-all 25x48`
  - 1x `button#showcase-refresh.showcase-refresh 26x26`
  - 1x `button.walk-companion-feedback 20x21`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
  - `canvas.walk-companion-canvas` 148x208 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas.walk-companion-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 7828 px)

### `/changelog`

- undersized targets:
  - 1x `a.nav-skip 157x36`
  - 1x `button.cl-filter 46x28`
  - 1x `button.cl-filter 71x28`
  - 1x `button.cl-filter 73x28`
  - 1x `button.cl-filter 109x28`
  - 1x `button.cl-filter 45x28`
  - 1x `button.cl-filter 52x28`
  - 1x `button.cl-filter 79x28`
  - 1x `button.cl-filter 58x28`
  - 1x `button.cl-filter 59x28`
  - 1x `a.h-footer-community-btn 148x40`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
- horizontal overflow: 7 px beyond 400 px viewport (html overflow-x: visible, actually scrolls sideways: false)

### `/ar`

- undersized targets:
  - 1x `a.brand 98x19`
  - 1x `a.top 81x15`
  - 1x `button.chip 165x29`
  - 1x `button.chip 223x29`
  - 1x `button.chip 146x29`
  - 1x `button.chip 162x29`

### `/news`

- undersized targets:
  - 1x `a 38x26`
  - 1x `a 58x26`
  - 1x `a 82x26`
  - 1x `a.subscribe 165x42`

### `/dashboard`

- undersized targets:
  - 1x `a.skip-link 1x44`
  - 1x `input#remember 18x18`
  - 1x `button.tws-disc-x 43x43`
  - 1x `a.tws-disc-cta.tws-disc-cta--primary 300x43`
- visible canvases:
  - `canvas#avatar-canvas` 393x727 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas#avatar-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 1470 px)

### `/irl`

- undersized targets:
  - 1x `input#irl-consent-dontshow 22x22`
  - 1x `a.irl-ob-learn 142x32`
  - 1x `button.tws-es-btn.tws-es-btn--primary 280x44`
  - 1x `button.tws-es-btn 280x44`
- visible canvases:
  - `canvas#irl-canvas` 393x727 touch-action=none (parent none)
- bottom-anchored bars:
  - `footer.irl-bottom` h=238 padding-bottom=14px safe-area-rule=false
  - `div#irl-error-sheet` h=207 padding-bottom=36px safe-area-rule=false
  - `div#irl-mypins-sheet` h=200 padding-bottom=36px safe-area-rule=false
  - `div#irl-agents-sheet` h=200 padding-bottom=36px safe-area-rule=false
  - `div#irl-calibrate-panel` h=237 padding-bottom=18px safe-area-rule=false
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 0 px):
  - `canvas#irl-canvas` touch-action=none -> page scrolled 0 px (headroom 0 px)

### `/walk`

- undersized targets:
  - 1x `a.h-skip-link 201x36`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)

