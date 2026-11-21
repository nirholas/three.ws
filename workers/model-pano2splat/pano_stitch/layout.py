"""Work out what the input files are: camera model, lens layout, streams and frame timing."""

import json
import os
import re
import subprocess
from dataclasses import dataclass, field

from . import trailer as trailer_mod
from .errors import CorruptInput, UnsupportedInput

LAYOUT_TWO_TRACK = "two_track"
LAYOUT_SIDE_BY_SIDE = "side_by_side"
LAYOUT_SPLIT_PAIR = "split_pair"

# Dual fisheye Insta360 bodies. Single lens bodies (GO, Ace, Flow) are not 360 cameras.
SUPPORTED_MODEL = re.compile(r"\b(one\s?x2?|one\s?rs?|x[2-9])\b", re.IGNORECASE)
SPLIT_NAME = re.compile(r"^(?P<head>.*?)_(?P<lens>00|10)_(?P<tail>[^/]*)$")
PHOTO_EXT = {".insp", ".jpg", ".jpeg"}


@dataclass
class StreamInfo:
    width: int
    height: int
    pix_fmt: str
    fps: float
    frames: int
    duration_s: float

    @property
    def ten_bit(self):
        return "10" in self.pix_fmt or "12" in self.pix_fmt


@dataclass
class Source:
    layout: str
    photo: bool
    files: list  # one path, or two for a split pair (lens 0 first)
    trailer: trailer_mod.Trailer
    model: str
    streams: list = field(default_factory=list)  # per lens StreamInfo, index = lens
    # (file index, video stream index) per lens
    lens_inputs: list = field(default_factory=list)
    has_audio: bool = False
    audio_file: int = 0


def split_paths(arg):
    return [p.strip() for p in arg.split(",") if p.strip()]


def pair_split_files(paths):
    """Order a split pair so lens 0 comes first, checking the two names belong together.

    ONE X2 and X3 write each recording as VID_<date>_<time>_00_<n>.insv (lens 0) and
    VID_<date>_<time>_10_<n>.insv (lens 1). Names must match apart from the 00 or 10."""
    if len(paths) != 2:
        raise UnsupportedInput("bad_pair", "A split pair needs exactly two files, one _00_ and one _10_.")
    parsed = []
    for p in paths:
        m = SPLIT_NAME.match(os.path.basename(p))
        if not m:
            raise UnsupportedInput("bad_pair", f"{os.path.basename(p)} does not follow the _00_ or _10_ naming of a split pair.")
        parsed.append(m)
    lenses = sorted(m.group("lens") for m in parsed)
    if lenses != ["00", "10"]:
        raise UnsupportedInput("bad_pair", "A split pair needs one _00_ file and one _10_ file.")
    if parsed[0].group("head") != parsed[1].group("head") or parsed[0].group("tail").split(".")[0][-3:] != parsed[1].group("tail").split(".")[0][-3:]:
        raise UnsupportedInput("bad_pair", "The _00_ and _10_ files carry different recording timestamps, so they are not one recording.")
    return [p for _, p in sorted(zip((m.group("lens") for m in parsed), paths))]


def pair_by_trailer(paths):
    """Pair files whose names were lost (a download renames them): the lens 0 file of a
    split pair is the one with the trailer."""
    has = [trailer_mod.has_trailer(p) for p in paths]
    if sum(has) != 1:
        raise UnsupportedInput("bad_pair", "A split pair needs one _00_ file with the Insta360 trailer and one _10_ file without it.")
    return [paths[has.index(True)], paths[has.index(False)]]


def find_sibling(path):
    """For a lone _00_ file, find the _10_ file the camera wrote next to it."""
    m = SPLIT_NAME.match(os.path.basename(path))
    if not m or m.group("lens") != "00":
        return None
    sibling = os.path.join(os.path.dirname(path), f"{m.group('head')}_10_{m.group('tail')}")
    return sibling if os.path.isfile(sibling) else None


def ffprobe(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
            capture_output=True, text=True, timeout=120,
        )
    except FileNotFoundError as exc:
        raise UnsupportedInput("ffmpeg_missing", "ffprobe is not installed on this machine.") from exc
    if out.returncode != 0:
        raise CorruptInput("corrupt_input", f"ffprobe could not read {os.path.basename(path)}: {out.stderr.strip()[:200]}")
    return json.loads(out.stdout)


def _fps(rate):
    num, _, den = (rate or "0/1").partition("/")
    try:
        return float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0


def _stream_info(s, fmt):
    duration = float(s.get("duration") or fmt.get("duration") or 0)
    fps = _fps(s.get("avg_frame_rate")) or _fps(s.get("r_frame_rate"))
    frames = int(s.get("nb_frames") or round(duration * fps))
    return StreamInfo(int(s["width"]), int(s["height"]), s.get("pix_fmt", "yuv420p"), fps, frames, duration)


def check_camera(model):
    if not model:
        raise UnsupportedInput("unsupported_camera", "The file names no camera model, so its lens layout is unknown.")
    if not SUPPORTED_MODEL.search(model):
        raise UnsupportedInput(
            "unsupported_camera",
            f"The camera model found in the file is '{model}'. Only the dual lens Insta360 ONE X, ONE X2, ONE R, ONE RS and X2 to X6 are supported.",
        )


def open_source(paths):
    if not paths:
        raise UnsupportedInput("no_input", "No input file was given.")
    ext = os.path.splitext(paths[0])[1].lower()
    for p in paths:
        if not os.path.isfile(p):
            raise CorruptInput("unreadable_input", f"The input file {p} does not exist.")
    if len(paths) == 1 and ext not in PHOTO_EXT:
        sibling = find_sibling(paths[0])
        if sibling:
            paths = [paths[0], sibling]
    if len(paths) == 2:
        try:
            paths = pair_split_files(paths)
        except UnsupportedInput:
            paths = pair_by_trailer(paths)
    elif len(paths) > 2:
        raise UnsupportedInput("bad_pair", "At most two input files are accepted.")

    trailers = [trailer_mod.read_trailer(p) for p in paths]
    carrier = next((t for t in trailers if t is not None and t.metadata is not None), None)
    if carrier is None:
        raise UnsupportedInput("no_insta360_trailer", "The file carries no Insta360 trailer, so its lens calibration is unknown.")
    model = carrier.metadata.model
    check_camera(model)

    photo = ext in PHOTO_EXT
    src = Source(LAYOUT_SIDE_BY_SIDE, photo, list(paths), carrier, model)
    if photo:
        info = ffprobe(paths[0])
        v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
        if v is None:
            raise CorruptInput("corrupt_input", "The photo has no image data.")
        src.streams = [StreamInfo(int(v["width"]), int(v["height"]), "yuvj420p", 0.0, 1, 0.0)] * 2
        return src

    if len(paths) == 2:
        src.layout = LAYOUT_SPLIT_PAIR
        for i, p in enumerate(paths):
            info = ffprobe(p)
            vs = [s for s in info["streams"] if s["codec_type"] == "video"]
            if not vs:
                raise CorruptInput("corrupt_input", f"{os.path.basename(p)} has no video stream.")
            src.streams.append(_stream_info(vs[0], info["format"]))
            src.lens_inputs.append((i, 0))
        src.has_audio = any(s["codec_type"] == "audio" for s in ffprobe(paths[0])["streams"])
        return src

    info = ffprobe(paths[0])
    vs = [s for s in info["streams"] if s["codec_type"] == "video"]
    src.has_audio = any(s["codec_type"] == "audio" for s in info["streams"])
    if len(vs) >= 2:
        src.layout = LAYOUT_TWO_TRACK
        md = carrier.metadata
        order = (1, 0) if md.track_order == 1 else (0, 1)  # field 80: 1 means track 0 holds lens 1
        info0, info1 = _stream_info(vs[0], info["format"]), _stream_info(vs[1], info["format"])
        src.streams = [info0, info1] if order == (0, 1) else [info1, info0]
        src.lens_inputs = [(0, 0), (0, 1)] if order == (0, 1) else [(0, 1), (0, 0)]
        return src
    if len(vs) == 1:
        s = _stream_info(vs[0], info["format"])
        if s.width != 2 * s.height:
            raise UnsupportedInput("unsupported_layout", f"A single video stream of {s.width}x{s.height} is not two fisheyes side by side.")
        half = StreamInfo(s.width // 2, s.height, s.pix_fmt, s.fps, s.frames, s.duration_s)
        src.streams = [half, half]
        src.lens_inputs = [(0, 0), (0, 0)]
        return src
    raise CorruptInput("corrupt_input", "The file has no video stream.")
