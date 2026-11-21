# model-pano2splat verify fixtures

`verify.py` reconstructs these captures on a GPU job. They live in
`gs://three-ws-capture-fixtures/insta360/`, and every insta360 order shares the
machine-readable list at `gs://three-ws-capture-fixtures/insta360/MANIFEST.json`.
Every file is a real, redistributable capture from Wikimedia Commons. Each one was
streamed into the bucket by `fixtures/mirror_fixture.py`, which recorded its
SHA-256 as it went.

| id | kind | size | duration | bytes | license | author |
|---|---|---|---|---|---|---|
| `commons-moscow-metro-interior-2023` | equirect_video (WebM VP9) | 3840x1920 | 30.0 s | 42,117,833 | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Svetlov Artem |
| `commons-old-ghost-road-walkaround` | equirect_video (WebM VP9) | 4096x2048 | 225.5 s | 868,740,794 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 360 New Zealand Ltd |
| `commons-norah-head-insta360-x5` | equirect_video (WebM VP9), Insta360 X5 | 7680x3840 | 488.6 s | 2,469,583,885 | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | GlennsYouTube |

Source pages, which state each license:

- https://commons.wikimedia.org/wiki/File:Moscow_metro_train_Sokolniki_interior_shot_on_spherical_camera_2023-03.MP4.webm
- https://commons.wikimedia.org/wiki/File:3-mins-in-360_on_The_Old_Ghost_Road.webm
- https://commons.wikimedia.org/wiki/File:Norah_Head_Insta360_X5_Virtual_Tour_OHNE_TON.webm

SHA-256:

```
e90506bb9e3f7a12d4fe7e6a53271a73225a51db14fbe2e9c2df32ae5fa941c4  commons-moscow-metro-interior-2023.webm
4b1264a6c5965742bf70517560dc59a7818c4d9c6e210a260c70d8b19385fafc  commons-old-ghost-road-walkaround.webm
0b34bdc77060d8ec151d1ce50d33b80978440a785695d17d363f3254e2ee6fa3  commons-norah-head-insta360-x5.webm
```

They are WebM, not MP4, so the `equirect_video` content sniff accepts the EBML
magic (`1A 45 DF A3`) as well as an ISO BMFF `ftyp` box.

The shared manifest also lists the equirect stills that order 332 added for
model-panodepth. Those are marked `verify: false` and this harness skips them.

## Adding a fixture

```
GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
python3 fixtures/mirror_fixture.py --id <kebab-id> --url <direct file URL> \
  --page-url <license page> --license "<name>" --license-url <url> \
  --author "<name>" --camera-model "<model>" --source-kind equirect_video \
  --content-type video/webm --verify --added-by <order>
```

The manifest merge is guarded by the object's generation, so concurrent writers
cannot drop each other's entries. Only use files whose license allows
redistribution (CC0, CC BY, CC BY-SA), and give attribution here.
