# 431. Wire the existing site-wide image-fallback mechanism onto the gallery grid and four marketplace renderers that skip it

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks, no fake data, no unfinished-work markers, no commented-out code.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Do not build a new fallback mechanism. `public/inline-behaviors.js` already exists, is already injected on every built page (see Step 0), and is already the convention five other files use correctly. This order is "tag the missing `<img>` elements," not "invent a helper." Building `src/shared/thumb-fallback.js` or any `data-thumb-fallback` variant duplicates it; do not do that here or anywhere else.

## Why this matters (measured 2026-10-24, from HEAD at the time of writing)

`/gallery` and `/marketplace` are two of the highest-traffic surfaces in the product, and both are
live-tested right now to throw real broken-image icons at users whenever a thumbnail 502s, with
zero graceful degradation, while the exact same page already has the fix available and wired for
other images on the same page.

Live reproduction (Playwright, headed at `https://three.ws`, 2026-10-24):

    /drive       -> 24 request errors, nearly all `cdn/thumb/*.png` and `cdn/u/*/og.png` returning 502
    /alpha-copilot -> 21 request errors, same 502 pattern on `cdn/thumb/*` and `cdn/forge/*`
    /classic     -> `cdn/u/*.glb` 502, console: "[agent-3d] boot failed: fetch ... responded with 502"

These 502s are the already-tracked R2/object-storage outage
(`prompts/finish/_context/production-100-OWNER-ACTIONS.md` row 36, owner-gated, do not re-file).
This order does NOT target the outage. It targets the fact that the frontend has no resilience to
it on two specific surfaces, when the exact same codebase already solved this problem elsewhere.

The mechanism already exists and is already live: `public/inline-behaviors.js` is a capture-phase
`error` listener, injected into every built HTML page except `nav.html`/`footer.html` by
`scripts/inject-inline-behaviors.mjs` (the last step of the root `build` script in `package.json`).
Confirmed live on both target pages:

    curl -s https://three.ws/gallery | grep -o 'inline-behaviors[^"]*'       # -> inline-behaviors.js
    curl -s https://three.ws/marketplace | grep -o 'inline-behaviors[^"]*'   # -> inline-behaviors.js
    curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/inline-behaviors.js   # -> 200

The listener reads `data-fallback="..."` (`hide`, `invisible`, `remove`, `sibling`, `text`,
`parent-text`, `element`, `closest`, `keep`, plus `data-fallback-src`/`-class`/`-text`/`-tag`/
`-parent-class`/`-closest`/`-display`) off any `<img>` anywhere on the site, and deliberately
bails out of untagged images (`public/inline-behaviors.js` line 132:
`if (!swap && !img.dataset.fallbackParentClass && !MODES.has(img.dataset.fallback)) return;`).
`src/marketplace.js`'s own `cardThumbHtml()` (the main marketplace card-grid renderer, around line
1612) already does this correctly: `data-fallback="element" data-fallback-class="card-img-fallback"`.
So does its `mkt-top-avatar` image (around line 9054): `data-fallback="hide"`. Both of these are
already fine; do not touch them.

Six `<img>` elements on the same two pages have no `data-fallback` attribute at all, so a 502'd
thumbnail shows the browser's default broken-image icon with no CSS hook to style around it:

- `public/gallery/gallery.js` line 508 (main avatar-grid thumbnail, the `<img>` branch of a
  ternary whose other branch renders a `<model-viewer poster="...">`):
  `` `<img src="${escapeAttr(thumbSrc)}" alt="${escapeAttr(altText)}" loading="lazy" decoding="async" />` ``
- `public/gallery/gallery.js` line 659 (`.equip-avatar-thumb`):
  `` `<img class="equip-avatar-thumb" src="${escapeAttr(thumbSrc)}" alt="" loading="lazy" decoding="async" />` ``
- `src/marketplace.js` line 989 (`.market-pulse-av`, the live-sale ticker avatar):
  `` `<img class="market-pulse-av" src="${escapeHtml(sale.agentImage)}" alt="" loading="lazy" decoding="async" />` ``
- `src/marketplace.js` line 3813 (`.anim-listing-thumb`, animation marketplace listing card):
  `` `<img class="anim-listing-thumb" src="${escapeHtml(it.thumbnail_url)}" alt="" loading="lazy" />` ``
- `src/marketplace.js` line 3967 (animation buy-modal media):
  `` `<img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnail_url)}" alt="" />` ``
- `src/marketplace.js` line 8704 (small avatar icon set via `innerHTML`):
  `` `iconEl.innerHTML = \`<img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />\`;` ``

Separately, `public/gallery/gallery.js` line 447 already has its own ad-hoc, different-style fix
on a third image (`img.addEventListener('error', () => img.remove(), { once: true });`); this is
fine as-is (it removes the element live-DOM, which is a valid equivalent to `data-fallback="remove"`)
and is out of scope here, listed only so you don't "fix" it a second time.

This order's two files do not overlap `prompts/finish/417-auto-thumbnail-error-fallback.md`'s scope
(`src/monitor.js`, `src/economy-live.js`, `src/avatar-gallery-picker.js`, all explicitly excluded
there as a different campaign building a new helper); if 417 is still open when you read this,
leave it alone, this order does not touch its files or its approach.

## Step 0: re-derive the current state

    git log --oneline -1
    curl -s https://three.ws/gallery | grep -o 'inline-behaviors[^"]*'
    curl -s https://three.ws/marketplace | grep -o 'inline-behaviors[^"]*'
    grep -n 'data-fallback' public/gallery/gallery.js        # confirm still zero matches
    sed -n '495,520p' public/gallery/gallery.js              # confirm line ~508 unchanged
    sed -n '650,662p' public/gallery/gallery.js               # confirm line ~659 unchanged
    sed -n '985,992p' src/marketplace.js                      # confirm line ~989 unchanged
    sed -n '3808,3818p' src/marketplace.js                    # confirm line ~3813 unchanged
    sed -n '3963,3970p' src/marketplace.js                    # confirm line ~3967 unchanged
    sed -n '8700,8708p' src/marketplace.js                    # confirm line ~8704 unchanged
    sed -n '1605,1625p' src/marketplace.js                    # confirm cardThumbHtml already correct, do not touch
    sed -n '48,160p' public/inline-behaviors.js               # the mechanism's real current semantics; match this, not this file's summary

## Tasks

1. `public/gallery/gallery.js` line 508: add `data-fallback="element" data-fallback-class="card-img-fallback"` to the `<img>` tag, matching `src/marketplace.js`'s `cardThumbHtml()` convention exactly (reuse the existing `.card-img-fallback` CSS class; grep for it under `src/`/`public/` to confirm it already renders a sane placeholder box, do not invent a second class name).
2. `public/gallery/gallery.js` line 659 (`.equip-avatar-thumb`): add `data-fallback="element" data-fallback-class="card-img-fallback"` as well, unless the surrounding markup is too small for that placeholder's default sizing to look right when you check it visually in the dev server; if so, use `data-fallback="hide"` instead (same convention as `mkt-top-avatar`) and say which you chose and why in the report.
3. `src/marketplace.js` line 989 (`.market-pulse-av`): add `data-fallback="hide"` (a broken avatar in a one-line ticker row should just disappear, matching `mkt-top-avatar`'s existing choice for the same visual role).
4. `src/marketplace.js` line 3813 (`.anim-listing-thumb`): add `data-fallback="element" data-fallback-class="card-img-fallback"`.
5. `src/marketplace.js` line 3967 (buy-modal media): add `data-fallback="element" data-fallback-class="card-img-fallback"`.
6. `src/marketplace.js` line 8704 (icon `innerHTML`): add `data-fallback="hide"` (a missing small icon should disappear, not show a placeholder box, matching the ticker avatar's choice).
7. Start the dev server on a free port (`npx vite --port 3107`) and visually confirm, for at least one of the six: load the page, open devtools, force one thumbnail's `<img src>` to a 404ing URL via the element inspector, and watch `public/inline-behaviors.js`'s listener fire and apply the fallback instead of leaving a broken-image icon. Stop the dev server before ending the turn.
8. Run `npm run check:rules -- --paths public/gallery/gallery.js src/marketplace.js`.

## Definition of done

- [ ] All six `<img>` tags listed above carry a `data-fallback` attribute, chosen per the task list (3 use `element`/`card-img-fallback`, 3 use `hide`).
- [ ] `cardThumbHtml()` (~line 1612) and `mkt-top-avatar` (~line 9054) in `src/marketplace.js` are unmodified.
- [ ] `public/gallery/gallery.js` line ~447's existing `addEventListener('error', ...)` fix is unmodified.
- [ ] No new helper file, no new attribute convention, no edit to `public/inline-behaviors.js` or `scripts/inject-inline-behaviors.mjs`: this order only adds attributes to existing `<img>` tags.
- [ ] Visual confirmation in a real browser (task 7) is described in the report, including which of `element`/`hide` was chosen for the `.equip-avatar-thumb` case and why.
- [ ] `npm run check:rules -- --paths public/gallery/gallery.js src/marketplace.js` exits 0.
- [ ] One `data/changelog.json` entry (tag `fix`) describing the resilience fix.
- [ ] Dev server stopped before the turn ends if one was started.
- [ ] Commit with explicit paths; subject names the actual fix (e.g. `fix(gallery,marketplace): fall back broken thumbnails instead of showing the browser's default icon`).

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The R2/object-storage outage (row 36) is still live when you test, so thumbnails are still 502ing | That is the exact condition this order improves the UX for; it does not require the outage to be fixed or even reproducible on demand | Verify with the forced-404 technique in task 7 instead of waiting for a live 502 |
| `.card-img-fallback` CSS doesn't exist yet or looks wrong at small sizes (the `.equip-avatar-thumb` case) | `src/marketplace.js`'s `cardThumbHtml()` already proves the class exists and renders correctly for its own card size; check the CSS rule, adapt sizing with a scoped selector if needed, do not invent a second class | Grep `card-img-fallback` under `src/`, `public/` for the existing rule before deciding it's missing |
| Order 417 (`thumbnail-error-fallback`) is still open and seems related | Its scope is three different files (`src/monitor.js`, `src/economy-live.js`, `src/avatar-gallery-picker.js`) and a different helper; this order's six targets are explicitly not in its list | Do not edit 417's files or its proposed helper from this order; file them as fully separate work |
| It's tempting to also fix `src/marketplace.js`'s other image spots while you're in the file | Scope creep risks an incomplete, unreviewed diff; this order names exactly six lines for a reason (verified via Step 0 that these are the only untagged `<img>` elements across these two files as of today) | Re-run `grep -n '<img' src/marketplace.js public/gallery/gallery.js` if you suspect a new untagged image appeared since this order was written, and only then expand scope, noting it in the report |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths.
3. Delete this file in the final commit (`git rm prompts/finish/431-auto-gallery-marketplace-thumb-fallback.md`) once every Definition of done line is verified green, and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA. If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the Step 0 measurements, the diff summary, the visual confirmation from task 7, the one-line judgment call on `.equip-avatar-thumb`'s mode choice, the commit SHA. No trailing questions.
