# KTX2 test textures

`2d_etc1s.ktx2` and `2d_uastc.ktx2` are the two Basis Universal encodings
(ETC1S and UASTC) that `KHR_texture_basisu` allows. They are copied unchanged
from the three.js examples (`examples/textures/ktx2/`, MIT license,
https://github.com/mrdoob/three.js).

Used by `tests/office-glb.test.js` to prove that `api/_lib/ktx2-decode.js`
decodes both encodings and that the Office-safe GLB pass replaces KTX2 textures
with PNG or JPEG.
