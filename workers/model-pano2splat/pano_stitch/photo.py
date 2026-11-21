"""Photo path: an .insp holds both fisheyes side by side plus the trailer; write a GPano JPEG."""

import os

import numpy as np

from . import imu as imu_mod
from .calibration import calibration_from_metadata
from .errors import CorruptInput
from .stitch import GainState, Geometry, pick_backend

GPANO_XMP = (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">'
    "<GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>"
    "<GPano:ProjectionType>equirectangular</GPano:ProjectionType>"
    "<GPano:CroppedAreaImageWidthPixels>{w}</GPano:CroppedAreaImageWidthPixels>"
    "<GPano:CroppedAreaImageHeightPixels>{h}</GPano:CroppedAreaImageHeightPixels>"
    "<GPano:FullPanoWidthPixels>{w}</GPano:FullPanoWidthPixels>"
    "<GPano:FullPanoHeightPixels>{h}</GPano:FullPanoHeightPixels>"
    "<GPano:CroppedAreaLeftPixels>0</GPano:CroppedAreaLeftPixels>"
    "<GPano:CroppedAreaTopPixels>0</GPano:CroppedAreaTopPixels>"
    "<GPano:PoseHeadingDegrees>0</GPano:PoseHeadingDegrees>"
    "</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end='w'?>"
)


def gpano_packet(width, height):
    return GPANO_XMP.format(w=width, h=height)


def stitch_photo(source, out_dir, max_width, level):
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    warnings = []
    path = source.files[0]
    try:
        img = Image.open(path)
        img.load()
    except Exception as exc:
        raise CorruptInput("corrupt_input", f"The photo could not be decoded: {exc}") from exc
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    if w != 2 * h:
        raise CorruptInput("corrupt_input", f"The photo is {w}x{h}, not two square fisheyes side by side.")
    cal = calibration_from_metadata(source.trailer.metadata)
    out_w = min(2 * h, int(max_width)) // 2 * 2
    out_h = out_w // 2
    side = h
    if out_w < 2 * h:
        import cv2

        side = max(64, int(round(h * out_w / (2 * h) / 2.0)) * 2)
        rgb = cv2.resize(rgb, (2 * side, side), interpolation=cv2.INTER_AREA)
    lenses = [np.ascontiguousarray(rgb[:, :side]), np.ascontiguousarray(rgb[:, side:])]
    if level:
        warnings.append("photo_not_levelled: a photo carries no gyro record, so the view keeps the camera's own up direction")
    geo = Geometry(out_w, out_h)
    coarse = geo.coarse_maps(cal, [(side, side)] * 2, imu_mod.static_rotations(1)[0], photo=True)
    out = pick_backend("cpu").compose(lenses, coarse, geo, GainState(), 255)

    exif = img.getexif()
    exif[0x0112] = 1
    for tag in (0x0100, 0x0101, 0xA002, 0xA003):
        exif.pop(tag, None)
    result = Image.fromarray(out)
    out_path = os.path.join(out_dir, "equirect.jpg")
    result.save(out_path, "JPEG", quality=95, subsampling=0, exif=exif.tobytes(), xmp=gpano_packet(out_w, out_h).encode("utf-8"))
    return {
        "width": out_w, "height": out_h, "fps": 0, "duration_s": 0, "frames": 1, "horizon_leveled": False,
        "imu_samples": 0, "calibration_model": cal.model, "warnings": warnings, "backend": "cpu", "encoder": "jpeg",
    }
