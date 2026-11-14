# Slicer trusted-hosts submission: PrusaSlicer patch + Bambu Studio issue

Target: [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) pull request and
[Bambu Studio](https://github.com/bambulab/BambuStudio) issue. Ready for owner
order 938: both a GitHub account action (filing a PR/issue) that only the
owner can take, so this file carries the exact patch and issue text to paste.

Re-verified 2026-11-14 (both repos live, not archived, AGPL-3.0, default branch `master`):

- PrusaSlicer: THE OLD PATCH NO LONGER APPLIES TO `master`. `master` was re-architected (2727
  commits ahead of the `version_2.9.7` tag the patch was built on). `src/slic3r/GUI/Downloader.cpp`
  survives as a stale leftover with a two-host list (`printables.com`, `thingiverse.com`) and no
  `GUI_App.cpp` beside it; `libslic3r/AppConfig.hpp` is now `Slic3r/App/AppConfig.hpp`. The live
  allowlist is `validate_and_complete_input` in
  `src/slic3r-shared/src/Slic3r/Biz/FileDownloader/FileDownloaderInteractor.cpp` (blob
  `8b77368a65`, last changed 2026-11-02). It now allows `prusa.com`, `prusa3d.com`, `prusa.cz`,
  `prusa3d.cz`, `prusa3d.dev`, `printables.com`, `testprusaverse.com`, `thingiverse.com` and
  `cults3d.com`. The `AppConfig`-backed `download_url_extra_hosts` design would now need a new
  accessor on `Biz::Platform::IAppConfigProvider` plus its implementation in
  `src/slic3r-shared/src/Slic3r/App/AppConfigProvider.cpp`, which I did not build. Because
  `.github/CONTRIBUTING.md` says every PR must be minimal and local ("no one-trick ponies", "no
  architectural changes", "keep the number of changes to a minimum") and says feature requests
  belong in GitHub Discussions (the issue tracker is for bugs only), the submission is now a
  Discussion plus the one-line patch below, not the configurable-allowlist PR.
- Bambu Studio: still current, with two changes. The function is now at lines 1116-1162 (was
  1105-1151), same five-entry `trusted_entries[]` list. Blank issues are disabled, so the issue
  must be filed from the "Feature request" template (headings below).
- The doc anchor this file used for Forge was stale; the section is now
  [`docs/forge.md#open-in-a-3d-printing-slicer`](../../../docs/forge.md#open-in-a-3d-printing-slicer).
  `src/slicer-handoff.js` still exists and still offers no PrusaSlicer button.

## Why this matters

Forge's slicer handoff (`src/slicer-handoff.js`,
`docs/forge.md#open-in-a-3d-printing-slicer`) opens an `orcaslicer://` or `bambustudio://`
deep link pointing at a three.ws-hosted STL/3MF. Bambu Studio checks `bambustudio://open?file=`
URLs against a hardcoded allowlist and shows a "not from a trusted site" confirmation for any
other host. PrusaSlicer is stricter: `prusaslicer://open?file=` downloads from a host outside
its list are refused outright, which is why Forge offers no PrusaSlicer button today.

## PrusaSlicer: Discussion first, then a one-line patch if they ask for it

Route (per `.github/CONTRIBUTING.md`, re-read 2026-11-14): post in
<https://github.com/prusa3d/PrusaSlicer/discussions> under "Feature requests" (the issue tracker
rejects non-bugs). Offer the one-line patch below; open a PR only if a maintainer asks, because
the guide warns that unrequested feature PRs are routinely not accepted. The configurable
`download_url_extra_hosts` idea from the earlier draft is dropped for `master` (see above).

File: `src/slic3r-shared/src/Slic3r/Biz/FileDownloader/FileDownloaderInteractor.cpp`, function
`validate_and_complete_input`. The diff below was generated today with `git diff --no-index`
against the real `master` blob (`8b77368a65`):

```diff
diff --git a/src/slic3r-shared/src/Slic3r/Biz/FileDownloader/FileDownloaderInteractor.cpp b/src/slic3r-shared/src/Slic3r/Biz/FileDownloader/FileDownloaderInteractor.cpp
index 8b77368..7055990 100644
--- a/src/slic3r-shared/src/Slic3r/Biz/FileDownloader/FileDownloaderInteractor.cpp
+++ b/src/slic3r-shared/src/Slic3r/Biz/FileDownloader/FileDownloaderInteractor.cpp
@@ -71,6 +71,7 @@ bool validate_and_complete_input(FileDownloaderJobInput& input)
                 "testprusaverse.com",
                 "thingiverse.com",
                 "cults3d.com",
+                "three.ws",
 #if !defined(NDEBUG) || defined(SLIC3R_ALLOW_LOCALHOST_SERVICES)
                 "localhost",
 #endif
```

Build status: not rebuilt against `master` today (it is a one-string change in a literal list).
The earlier full from-source build (2026-10-13, 689/689 targets, `ctest` 7/7 suites) was against
the `version_2.9.7` tag with the older configurable-allowlist patch, so do not quote it for this
diff. Before any PR, build `master` and run `ctest` yourself, and add the commit-message
reasoning the guide asks for.

### Discussion text to paste

Category: Feature requests. Title: `Allow three.ws in the prusaslicer:// download allowlist`

Body:

> `validate_and_complete_input` in `FileDownloaderInteractor.cpp` only accepts
> `prusaslicer://open?file=` downloads from a fixed host list (`prusa.com`, `printables.com`,
> `thingiverse.com`, `cults3d.com` and a few others). three.ws is a generative-3D site
> that produces print-ready STL and 3MF files, and a user who wants to print one in PrusaSlicer
> currently has to download the file and open it by hand, so we offer no "Open in PrusaSlicer"
> button. Would you accept adding `three.ws` to that list? It is a one-line change and I can send
> it as a PR if that is welcome. We already ship the equivalent button for OrcaSlicer and Bambu
> Studio.

## Bambu Studio: issue only (no patch attempted; closed-allowlist design differs from PrusaSlicer's)

File: `src/slic3r/GUI/GUI_App.cpp`, function `is_trusted_model_download_url`
(lines 1116-1162 on `master`, re-read 2026-11-14). Unlike PrusaSlicer's flat string list, Bambu Studio's allowlist
is a `static const TrustEntry trusted_entries[]` array of
`{host, suffix, https_only}` structs matched through `libcurl`'s `CURLU`
parser, scoped entirely to Bambu/MakerWorld-owned domains
(`makerworld.bblmw.{com,cn}`, `public-cdn.bblmw.com`, two cloud storage
buckets). There is no `AppConfig`-backed extension point to mirror
PrusaSlicer's patch against, and the struct's `https_only`/`suffix` flags
suggest the array is treated as a security-relevant fixed list rather than a
user preference, so this submission is an issue asking upstream for a
mechanism, not a PR assuming one particular shape.

### Issue text to paste

File it at <https://github.com/bambulab/BambuStudio/issues/new/choose> using the **Feature
request** template (blank issues are disabled; the template adds the `feature` label). Title:
`Model-download trust check is a hardcoded Bambu-only allowlist, no way to add a host`. Put the
text below under the template's "Describe the solution you'd like" heading, and one line under
"Describe the alternatives you've considered": the user can confirm the warning each time.

Body:

> `is_trusted_model_download_url` in `src/slic3r/GUI/GUI_App.cpp` (currently
> lines 1116-1162) checks incoming `bambustudio://open?file=` URLs against a
> fixed `trusted_entries[]` array scoped to Bambu/MakerWorld domains only.
> Any other site that wants to hand a model to Bambu Studio by deep link (for
> example a generative-3D or print-on-demand platform) can't do so without
> the user seeing the "not from a trusted site" warning dialog every time,
> and there's no config key, CLI flag, or settings-UI entry to add a host.
>
> PrusaSlicer keeps a similar fixed list in
> `FileDownloaderInteractor.cpp`, which covers a few third-party model sites. Would you consider
> either adding `three.ws` as a non-suffix, https-only `TrustEntry`, or a user-editable list of
> extra hosts read from the app config? Happy to send a PR for whichever shape you prefer.

## Owner action required

Posting the PrusaSlicer Discussion and opening the Bambu Studio issue both need the owner's
own GitHub account (CLAUDE.md gate 2: external posting). This file holds the diff and both
pieces of ready-to-paste text. Order: post the Discussion at
<https://github.com/prusa3d/PrusaSlicer/discussions/new?category=feature-requests>, then the
Bambu issue. Do not open a PrusaSlicer PR unless a maintainer asks for it.
