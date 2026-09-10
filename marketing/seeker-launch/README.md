# marketing/seeker-launch/

The announcement kit for three.ws on the Solana dApp Store. The app has been
live for Seeker and Saga since 2026-09-01; this directory is how it gets told.

| File | What it is |
| --- | --- |
| [video-launch.md](video-launch.md) | The run of show for the IRL video announcement: edit spec, the order of the day across X, Telegram, LinkedIn and the vertical platforms, and paste-ready copy for each, every X block under 280 characters |
| [post.md](post.md) | The earlier photo-first version. Its long explainer copy is still the best plain-language description of the app, and the video thread reuses it |
| [make-cuts.mjs](make-cuts.mjs) | Cuts the raw phone footage into the four masters the launch needs |
| [count-x.mjs](count-x.mjs) | Counts every copy block in this directory the way X counts it, and exits non-zero if an X block is over the limit |

## Producing the cuts

Put the original phone file in `marketing/seeker-launch/.raw/` (git ignores that
directory, so a large original never enters the repo), then:

```bash
npm run seeker:launch:cuts -- --in=.raw/seeker-irl.mov --start=00:00:02.5 --end=00:00:34 --poster=00:00:06
```

Four files land in `cuts/`: a 1920x1080 for X and LinkedIn, a 1080x1920 for
TikTok, Reels and Shorts, a silent 1080x1080 loop for Telegram and the
`/seeker` page hero, and a poster frame. Trimming flags are optional; without
them the whole source is converted. Vertical footage is fitted inside the wider
frames rather than cropped, with the bars filled by a blurred copy of the frame.

`cuts/` is working output. Commit a master only if it is small enough to belong
in git (the rendered screencasts in [../seeker-video/](../seeker-video) are the
size precedent, all under 12 MB); anything larger stays local and goes straight
to the platform.

## Related

- [../seeker-video/](../seeker-video): the rendered screen captures, including
  the feature tour that carries the follow-up posts. Produced by
  `npm run seeker:screencast` and `npm run seeker:feature-tour`.
- [../../docs/seeker-app.md](../../docs/seeker-app.md): what the app does, which
  is where every claim in the copy comes from.
- [../../docs/seeker-video.md](../../docs/seeker-video.md): how to capture
  Seeker footage without a Seeker, and which surfaces genuinely need the device.
- [../../solana-mobile/publish/listing/](../../solana-mobile/publish/listing):
  the shipping store listing copy. Nothing in the announcement may promise more
  than this does.
