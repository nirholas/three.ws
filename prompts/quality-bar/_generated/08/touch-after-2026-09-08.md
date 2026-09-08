# Mobile input-ergonomics audit

Measured with `scripts/mobile-touch-audit.mjs` against http://127.0.0.1:3141 in a real
Pixel 5 Playwright context (Chromium). Every value below is a live computed style or a
measured bounding box, not a source grep.

- Minimum target size checked: 44x44 CSS px
- Inline text links are exempt (WCAG 2.5.8) and counted separately
- Measured: 2026-09-08T18:31:36.066Z

| path | undersized targets | interactive checked | inline-exempt | canvases touch-action:auto / visible | viewport-fit=cover | bottom bars w/o safe-area / total | overflow-x |
|---|---|---|---|---|---|---|---|
| `/launches` | 66 | 302 | 0 | 0/2 | yes | 0/0 | 0 px |
| `/play` | 8 | 94 | 0 | 0/1 | yes | 0/0 | 0 px |
| `/docs/start-here` | 7 | 576 | 162 | 0/1 | yes | 0/0 | 0 px |
| `/` | 6 | 210 | 6 | 0/3 | yes | 0/0 | 0 px |
| `/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` | 5 | 87 | 0 | 0/2 | yes | 0/0 | 0 px |
| `/forge` | 3 | 90 | 2 | 0/2 | yes | 0/0 | 0 px |
| `/dashboard` | 3 | 33 | 3 | 0/1 | yes | 0/0 | 0 px |
| `/irl` | 2 | 61 | 0 | 0/1 | yes | 5/5 | 0 px |
| `/markets` | 1 | 80 | 2 | 0/1 | yes | 0/0 | 0 px |
| `/news` | 1 | 122 | 5 | 0/0 | yes | 0/0 | 0 px |
| `/walk` | 1 | 63 | 0 | 0/1 | yes | 0/0 | 0 px |
| `/marketplace` | 0 | 1648 | 0 | 0/1 | yes | 0/0 | 0 px |
| `/ar` | 0 | 14 | 6 | 0/0 | yes | 0/0 | 0 px |
| `/changelog` | 0 | 131 | 4 | 0/2 | yes | 0/0 | 0 px |

## Detail

### `/launches`

- undersized targets:
  - 24x `button.twc-make.twc-tip 37x43`
  - 24x `button.lx-action.lx-action-watch 43x57`
  - 1x `a.lx-btn.lx-btn-primary 146x39`
  - 1x `a.lx-btn 160x39`
  - 1x `a.lx-btn 235x39`
  - 1x `a.lx-btn 154x39`
  - 1x `a.lx-pulse-label 119x14`
  - 1x `button#lx-net-mainnet.lx-net-btn.active 82x28`
  - 1x `button#lx-net-devnet.lx-net-btn 76x28`
  - 1x `button.lx-of-btn.active 35x27`
  - 1x `button.lx-of-btn 72x27`
  - 1x `button.lx-of-btn 59x27`
- visible canvases:
  - `canvas#lx-field` 393x727 touch-action=pan-y (parent auto)
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas#lx-field` touch-action=pan-y -> page scrolled 165 px (headroom 13105 px)

### `/play`

- undersized targets:
  - 1x `button.cc-id-toggle 315x40`
  - 1x `input 315x40`
  - 1x `button.cc-sort.cc-on 81x40`
  - 1x `button.cc-sort 101x40`
  - 1x `button.cc-sort 95x40`
  - 1x `button.cc-sort 73x40`
  - 1x `a 43x44`
  - 1x `a 40x44`
- visible canvases:
  - `canvas#kx-canvas` 393x727 touch-action=none (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 0 px):
  - `canvas#kx-canvas` touch-action=none -> page scrolled 0 px (headroom 0 px)

### `/docs/start-here`

- undersized targets:
  - 1x `a#world-link.docs-world-link 35x44`
  - 1x `a.btn-primary 58x30`
  - 1x `input#search-input 247x36`
  - 1x `a 146x21`
  - 1x `a 164x21`
  - 1x `a 115x21`
  - 1x `a 135x21`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)

### `/`

- undersized targets:
  - 1x `a.press-logo 23x44`
  - 1x `a.press-logo 28x44`
  - 1x `span.tws-tt 97x17`
  - 1x `span.tws-tt 18x17`
  - 1x `button#foot-ca-btn.foot-ca 353x26`
  - 1x `a.brand-mark-chip.is-in 34x34`
- visible canvases:
  - `canvas.walk-preview-canvas` 351x197 touch-action=pan-y (parent auto)
  - `canvas#drop-canvas` 393x627 touch-action=pan-y (parent auto)
  - `canvas.walk-companion-canvas` 148x208 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas.walk-preview-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 4104 px)
  - `canvas#drop-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 2086 px)
  - `canvas.walk-companion-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 5660 px)

### `/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`

- undersized targets:
  - 1x `a 38x22`
  - 1x `a 54x22`
  - 1x `button.cv-range-btn 40x44`
  - 1x `button.cv-range-btn 37x44`
  - 1x `button 38x19`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
  - `canvas.walk-companion-canvas` 148x208 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas.walk-companion-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 5172 px)

### `/forge`

- undersized targets:
  - 1x `a 70x15`
  - 1x `input#provider-key.byok-input 296x39`
  - 1x `a 221x15`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)
  - `canvas.walk-companion-canvas` 148x208 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas.walk-companion-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 3580 px)

### `/dashboard`

- undersized targets:
  - 1x `a.skip-link 1x44`
  - 1x `input#remember 18x18`
  - 1x `span.tws-tt 54x14`
- visible canvases:
  - `canvas#avatar-canvas` 393x727 touch-action=pan-y (parent auto)
- vertical swipe test (px the document scrolled; control swipe off-canvas moved 165 px):
  - `canvas#avatar-canvas` touch-action=pan-y -> page scrolled 165 px (headroom 1292 px)

### `/irl`

- undersized targets:
  - 1x `input#irl-consent-dontshow 22x22`
  - 1x `a.irl-ob-learn 144x32`
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

### `/markets`

- undersized targets:
  - 1x `a.brand-mark-chip.is-in 34x34`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)

### `/news`

- undersized targets:
  - 1x `a 38x44`

### `/walk`

- undersized targets:
  - 1x `a.h-skip-link 201x36`
- visible canvases:
  - `canvas#footer-bot-canvas` 90x90 touch-action=pan-y (parent auto)

