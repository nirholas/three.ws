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
| `commons-visby-march-theta` | equirect_video (WebM VP8), Ricoh Theta | 1920x960 | 87.1 s | 40,180,340 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | Jan Ainali |
| `commons-visby-march-theta-reframe` | derived_reframe_video (MP4 H.264), `derived/` | 1280x720 | 30.0 s | 5,722,506 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | Jan Ainali (derived by three.ws) |
| `zenodo-ritmo-x3-format-exemplar` | raw .insv split pair (Insta360 X3, `_00_` with trailer, `_10_`) | 2 files | n/a | 464,299,277 + 461,373,440 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | RITMO, University of Oslo |
| `commons-kasidetma-x3-72mp` | equirect_image (JPEG, Insta360 X3), order 331 | 11968x5984 | n/a | 6,758,721 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | kasidetma |
| `commons-teotihuacan-oners-sunny` | equirect_image (JPEG, Insta360 ONE RS), order 331 | 6528x3264 | n/a | 5,068,589 | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Fuzheado |
| `commons-tashkent-oners-sunny` | equirect_image (JPEG, Insta360 ONE RS), order 331 | 6528x3264 | n/a | 12,879,550 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Aleksey Chalabyan |
| `commons-hof-insta360-x6-7680` | equirect_video (WebM), Insta360 X6, order 334 | 7680x3840 | n/a | 1,633,356,717 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | PantheraLeo1359531 |
| `commons-gunsan-hirotsu-house-69-80` | 12 equirect_image JPEGs, order 334 (pano_sfm negative case) | 7680x3840 | n/a | 12 files | KOGL Type 1 | Korea Heritage Service |

Source pages, which state each license:

- https://commons.wikimedia.org/wiki/File:Moscow_metro_train_Sokolniki_interior_shot_on_spherical_camera_2023-03.MP4.webm
- https://commons.wikimedia.org/wiki/File:3-mins-in-360_on_The_Old_Ghost_Road.webm
- https://commons.wikimedia.org/wiki/File:Norah_Head_Insta360_X5_Virtual_Tour_OHNE_TON.webm
- https://commons.wikimedia.org/wiki/File:Hundra_knektars_marsch_utanf%C3%B6r_Kapitelhusg%C3%A5rden.webm
- https://zenodo.org/records/21611765 (the X3 pair, from `format-exemplars.zip`, added by order 336; `verify: true` with `source_kind: insv`, used by pano_stitch and not by `verify.py`'s equirect reconstruction)
- https://commons.wikimedia.org/wiki/File:Teotihuacan_Mexico_20251126_panorama_360.jpg, https://commons.wikimedia.org/wiki/File:360_panorama_near_State_Museum_of_History_of_Uzbekistan.jpg and the kasidetma X3 file on Commons (the three order-331 environment stills)

SHA-256:

```
e90506bb9e3f7a12d4fe7e6a53271a73225a51db14fbe2e9c2df32ae5fa941c4  commons-moscow-metro-interior-2023.webm
4b1264a6c5965742bf70517560dc59a7818c4d9c6e210a260c70d8b19385fafc  commons-old-ghost-road-walkaround.webm
0b34bdc77060d8ec151d1ce50d33b80978440a785695d17d363f3254e2ee6fa3  commons-norah-head-insta360-x5.webm
f042289cd46a2d15c472ace95751ab1f4fb10ee8be0fdc16b9c6477744ce7818  commons-visby-march-theta.webm
89370525a01e0b91fb060f3458fec176c70816d03f1a70533d98f8e6b893fdeb  commons-visby-march-theta-reframe-yaw34.5-pitch-28.1.mp4
8c53b316f7ae90deed96614f7194a0b24663ccdb72a73b6086238a5be2d9ff51  zenodo-ritmo-x3-format-exemplar_00.insv
f7e3dab8e8f1e955cabb8c83553541c6c9618ebd11a5a8b27eef0d4047cd601f  zenodo-ritmo-x3-format-exemplar_10.insv
59d0ed2d747e5d3dd4c11b27a72e44ac9689ba0c98b2f440d074fb96f55ae032  commons-kasidetma-x3-72mp.jpg
1657528b1cfa9f8c9f3712df7078663baf41e56086742f4222e29389be716512  commons-teotihuacan-oners-sunny.jpg
8b2b366a28cc81f07e080a0eabe9d1906bac0fc86249783ab0e106b730bac67f  commons-tashkent-oners-sunny.jpg
```

They are WebM, not MP4, so the `equirect_video` content sniff accepts the EBML
magic (`1A 45 DF A3`) as well as an ISO BMFF `ftyp` box.

`commons-visby-march-theta` is a street procession with many full-body people. The man in a white shirt right of centre sits at yaw 34.5, pitch -28.1 (C3) for the first 20 s, which the `/video-to-motion` click-to-pick UI (order 342) is checked against. Its `-reframe` sibling is the ffmpeg `v360` view of that person (`derived_with` in the manifest), kept as `verify: false`.

The shared manifest also lists the equirect stills that order 332 added for
model-panodepth. Those are marked `verify: false` and this harness skips them.

## Adding a fixture

```
GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
python3 fixtures/mirror_fixture.py --id <kebab-id> --url <direct file URL> \
  --page-url <license page> --license "<name>" --license-url <url> \
  --author "<name>" --camera-model "<model>" --source-kind equirect_video \
  --content-type video/webm --verify --added-by <order>
93f00dd71a133b2c8ecb627fafd9b509d7b999b6e1eb50a31a93fbf27f49461e  commons-hof-insta360-x6-7680.webm
```

The manifest merge is guarded by the object's generation, so concurrent writers
cannot drop each other's entries. Only use files whose license allows
redistribution (CC0, CC BY, CC BY-SA), and give attribution here.
