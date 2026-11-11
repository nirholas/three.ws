# Bench photo sources

The ten photos the on-device photo check was calibrated and measured on
(`docs/forge-photo-prep.md`). Every file is public domain, so the bench, its
renders and the screenshots built from it can be published. They are kept in
the repository so every run feeds the same bytes to the browser pipeline and to
TRELLIS.2.

| File | Source (Wikimedia Commons) | Author | License | Why it is in the set |
|---|---|---|---|---|
| `backpack.jpg` | [Ubuntu backpack](https://commons.wikimedia.org/wiki/File:Ubuntu_backpack.jpg) | Syced | CC0 | Large phone photo (1.8 MB), one clear subject |
| `chair.jpg` | [Antique Wooden Chair from Bharat](https://commons.wikimedia.org/wiki/File:Antique_Wooden_Chair_from_Bharat.jpg) | Amitbalani | CC0 | Busy indoor background, armrest touches the frame edge |
| `defocused-scooter.jpg` | [Defocused motorcycle](https://commons.wikimedia.org/wiki/File:Defocused_motorcycle.jpg) | Keenken | CC0 | Out of focus and small in a wide shot |
| `garden-gnome.jpg` | [German garden gnome](https://commons.wikimedia.org/wiki/File:German_garden_gnome.jpg) | Colibri1968 | Public domain | Outdoor subject on grass (also `data/x-content/inputs/`) |
| `grass-head-toy.jpg` | [Grass head toy](https://commons.wikimedia.org/wiki/File:Grass_head_toy.jpg) | RobotBlanket | CC0 | Fine, irregular silhouette |
| `lemon.jpg` | [Lemon on black table 01](https://commons.wikimedia.org/wiki/File:Lemon_on_black_table_01.jpg) | TheWikiToby | CC0 | Dark scene, small subject |
| `mug.jpg` | [Mug image](https://commons.wikimedia.org/wiki/File:Mug_image.jpg) | Mohanraj55 | CC0 | Soft phone shot |
| `sneaker.jpg` | [Unpaired gray running shoe](https://commons.wikimedia.org/wiki/File:Imani-bahati-unpaired-gray-nike-running-shoe.jpg) | Imani Bahati | CC0 | Clean product photo, smallest real subject that should pass |
| `teapot.jpg` | [Covered teapot, China, early 19th century](https://commons.wikimedia.org/wiki/File:Covered_teapot,_China,_early_19th_century,_nephrite,_Honolulu_Museum_of_Art.jpg) | Hiart | CC0 | Two objects in one photo |
| `teddy-bear-museum.jpg` | [Teddy bear museum](https://commons.wikimedia.org/wiki/File:Teddy_bear_museum.jpg) | Drivephotographer | CC0 | Soft toy with background clutter |

Licenses were read from the Commons API (`extmetadata.LicenseShortName`) on
2026-11-11. The chair, sneaker and teapot are the same files as
`data/quality-bench/refs/`.
