# Cleanup task: root-level CSS files

## Goal

The repo root currently holds nine `*.css` files. Five are byte-identical
duplicates of files already in `public/`; the rest are unique source CSS
that the moved-to-`pages/` HTML files reference via absolute URLs
(`/community.css`, `/playground.css`, …). Get every CSS file into `public/`
and remove the dead root copies so the root no longer carries stylesheets.

## Inputs (verify before acting)

Run these checks first; only proceed if the picture matches:

```
ls *.css                         # 9 files in repo root
ls public/*.css | wc -l          # 6+ files already in public/
```

For each root `*.css`, decide its disposition by diffing against the
`public/` counterpart (if one exists). Take the **public/ copy as
authoritative** for the three identical pairs and for `home.css`
(the public version is what the dev server and build currently serve;
the root copy is dead). For the rest, move the root copy into `public/`.

| Root file            | Action                                                       |
|----------------------|--------------------------------------------------------------|
| `app-demo.css`       | `git mv app-demo.css public/app-demo.css`                    |
| `community.css`      | `git mv community.css public/community.css`                  |
| `features.css`       | `git mv features.css public/features.css`                    |
| `footer.css`         | `git rm footer.css`  (identical to `public/footer.css`)      |
| `home.css`           | `git rm home.css`    (public/ version is live)               |
| `marketplace-v2.css` | `git mv marketplace-v2.css public/marketplace-v2.css`        |
| `marketplace.css`    | `git rm marketplace.css` (identical to `public/marketplace.css`) |
| `playground.css`     | `git mv playground.css public/playground.css`                |
| `style.css`          | `git rm style.css` (identical to `public/style.css`)         |

Before deleting, re-verify identity with `diff -q`. If `diff -q` reports
**any** difference for the four `git rm` rows, stop and surface the diff —
do not silently lose CSS.

## Acceptance criteria

1. `ls *.css` at repo root prints nothing (no CSS in root).
2. `ls public/*.css` contains all nine names listed above
   (`app-demo.css`, `community.css`, `features.css`, `footer.css`,
   `home.css`, `marketplace.css`, `marketplace-skills.css`,
   `marketplace-v2.css`, `playground.css`, `style.css`).
3. `npm run build` succeeds.
4. In `dist/`, the HTML files that reference these stylesheets still
   resolve them — spot-check `dist/community.html`,
   `dist/playground.html`, `dist/app-demo.html`, `dist/features.html`,
   `dist/marketplace.html`, `dist/home.html` for live `<link>` tags
   (either bare `/foo.css` or hashed `/assets/foo-HASH.css`).
5. `git grep -nE 'href="/?(style|home|footer|marketplace(-v2)?|community|features|playground|app-demo)\.css"'`
   shows only refs that the build produces correctly — nothing referencing
   a root path that no longer exists.

## Commit

```
git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com \
    commit -m "chore(root): move/dedupe root CSS into public/"
```

The commit must also include deleting this prompt file
(`prompts/cleanup-root/01-root-css-dedup.md`).
