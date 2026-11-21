"""Reader for the binary trailer appended to Insta360 .insv and .insp files.

Layout (community documentation: freeKC/raw360-formats docs/insta360.md, MIT, and the
telemetry-parser Insta360 notes, Apache-2.0 or MIT; confirmed here on real X3 and X5
files). The last 72 bytes hold 32 reserved bytes, the trailer size (u32 LE), a version
(u32 LE) and a 32 byte ASCII magic. The payload before them is a run of records, each a
payload followed by a 6 byte footer (format u8, id u8, length u32 LE). Newer cameras end
the payload with an index record (id 0) of 10 byte entries (id, format, length, offset
from the start of the trailer payload) because their records are padded.
"""

import struct
from dataclasses import dataclass, field

from .errors import CorruptInput

MAGIC = b"8db42d694ccc418790edff439fe026bf"
TAIL = 72
FOOTER = 6
INDEX_ENTRY = 10

REC_INDEX = 0
REC_METADATA = 1
REC_PREVIEW = 2
REC_IMU = 3
REC_EXPOSURE = 4


@dataclass
class Trailer:
    """Records of one file by id, plus the decoded metadata protobuf."""

    records: dict = field(default_factory=dict)
    metadata: "Metadata | None" = None

    def record(self, rec_id):
        return self.records.get(rec_id)


@dataclass
class Metadata:
    serial: str = ""
    model: str = ""
    firmware: str = ""
    calibration_v1: str = ""
    calibration_v3: str = ""
    calibration_v6: str = ""
    width: int = 0
    height: int = 0
    crop: tuple = ()  # (srcW, srcH, dstW, dstH, offX, offY) of field 27
    imu_packed: bool = False  # field 62: 20 byte samples
    accel_range_g: float = 0.0
    gyro_range_dps: float = 0.0
    file_layout: int = 0  # field 79
    track_order: int = 0  # field 80
    stream_layout: int = 0  # field 131
    image_category: int = 0  # field 129
    first_frame_us: int = 0  # field 24
    gyro_offset_ms: float = 0.0  # field 28, set when field 29 says it is valid


def read_varint(buf, pos):
    shift = 0
    value = 0
    while True:
        if pos >= len(buf):
            raise ValueError("truncated varint")
        b = buf[pos]
        pos += 1
        value |= (b & 0x7F) << shift
        if not b & 0x80:
            return value, pos
        shift += 7
        if shift > 70:
            raise ValueError("varint too long")


def parse_protobuf(buf):
    """Decode a protobuf message without a schema: {field: first value}.

    Values are int (varint), bytes (length delimited), or float tuples never; fixed32 and
    fixed64 come back as raw little-endian bytes so callers pick float or int."""
    out = {}
    pos = 0
    n = len(buf)
    while pos < n:
        try:
            key, pos = read_varint(buf, pos)
            num, wire = key >> 3, key & 7
            if wire == 0:
                val, pos = read_varint(buf, pos)
            elif wire == 1:
                val = bytes(buf[pos : pos + 8])
                pos += 8
            elif wire == 2:
                length, pos = read_varint(buf, pos)
                val = bytes(buf[pos : pos + length])
                pos += length
            elif wire == 5:
                val = bytes(buf[pos : pos + 4])
                pos += 4
            else:
                break
        except ValueError:
            break
        out.setdefault(num, val)
    return out


def _text(val):
    return val.decode("utf-8", "replace").strip("\x00") if isinstance(val, bytes) else ""


def _sub_ints(val, names):
    if not isinstance(val, bytes):
        return {}
    sub = parse_protobuf(val)
    return {name: sub.get(i + 1, 0) for i, name in enumerate(names)}


def _scalar(val):
    """A range field is a varint on older firmware and a float on newer."""
    if isinstance(val, int):
        return float(val)
    if isinstance(val, bytes) and len(val) == 4:
        return struct.unpack("<f", val)[0]
    if isinstance(val, bytes) and len(val) == 8:
        return struct.unpack("<d", val)[0]
    return 0.0


def decode_metadata(buf):
    fields = parse_protobuf(buf)
    md = Metadata()
    md.serial = _text(fields.get(1))
    md.model = _text(fields.get(2))
    md.firmware = _text(fields.get(3))
    md.calibration_v1 = _text(fields.get(17)) or _text(fields.get(5))
    md.calibration_v3 = _text(fields.get(56)) or _text(fields.get(54))
    md.calibration_v6 = _text(fields.get(112)) or _text(fields.get(111))
    size = _sub_ints(fields.get(19), ("w", "h"))
    md.width, md.height = size.get("w", 0), size.get("h", 0)
    crop = _sub_ints(fields.get(27), ("sw", "sh", "dw", "dh", "ox", "oy"))
    if crop:
        md.crop = tuple(crop[k] for k in ("sw", "sh", "dw", "dh", "ox", "oy"))
    md.imu_packed = bool(fields.get(62, 0)) if isinstance(fields.get(62, 0), int) else False
    rng = fields.get(65)
    if isinstance(rng, bytes):
        sub = parse_protobuf(rng)
        md.accel_range_g = _scalar(sub.get(1))
        md.gyro_range_dps = _scalar(sub.get(2))
    for name, num in (("file_layout", 79), ("track_order", 80), ("stream_layout", 131), ("image_category", 129)):
        val = fields.get(num, 0)
        setattr(md, name, val if isinstance(val, int) else 0)
    md.first_frame_us = fields.get(24, 0) if isinstance(fields.get(24, 0), int) else 0
    if fields.get(29, 0) == 1 and isinstance(fields.get(28), bytes) and len(fields[28]) == 8:
        md.gyro_offset_ms = struct.unpack("<d", fields[28])[0]
    return md


def decode_imu(buf, md):
    """Decode the IMU record to (t_s, accel_g (N,3), gyro_dps (N,3)) in the camera IMU axes.

    Packed firmware (field 62) stores 20 byte samples: u64 microseconds then six u16
    offset binary values scaled by the ranges of field 65. Older firmware stores 56 byte
    samples: i64 milliseconds then six doubles (accel in g, gyro in rad/s)."""
    import numpy as np

    if md is not None and md.imu_packed and md.accel_range_g and md.gyro_range_dps:
        n = len(buf) // 20
        if n == 0:
            return None
        raw = np.frombuffer(buf[: n * 20], dtype=np.dtype([("t", "<u8"), ("v", "<u2", 6)]))
        centred = (raw["v"].astype(np.float64) - 32768.0) / 32768.0
        accel = centred[:, :3] * md.accel_range_g
        gyro = centred[:, 3:] * md.gyro_range_dps
        return raw["t"].astype(np.float64) * 1e-6, accel, gyro
    n = len(buf) // 56
    if n == 0:
        return None
    raw = np.frombuffer(buf[: n * 56], dtype=np.dtype([("t", "<i8"), ("v", "<f8", 6)]))
    return raw["t"].astype(np.float64) * 1e-3, raw["v"][:, :3].copy(), np.degrees(raw["v"][:, 3:])


def decode_exposure(buf):
    """Per frame (timestamp_s, exposure) pairs of the exposure record."""
    import numpy as np

    n = len(buf) // 16
    if n == 0:
        return None
    raw = np.frombuffer(buf[: n * 16], dtype=np.dtype([("t", "<i8"), ("e", "<f8")]))
    return raw["t"].astype(np.float64) * 1e-6, raw["e"].copy()


def read_tail(f, size):
    f.seek(size - TAIL)
    tail = f.read(TAIL)
    if len(tail) != TAIL or tail[40:72] != MAGIC:
        return None
    trailer_size, version = struct.unpack("<II", tail[32:40])
    if trailer_size < TAIL or trailer_size > size:
        raise CorruptInput("corrupt_trailer", "The Insta360 trailer at the end of the file has an impossible size.")
    return trailer_size, version


def has_trailer(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            if size < TAIL:
                return False
            f.seek(size - TAIL)
            return f.read(TAIL)[40:72] == MAGIC
    except OSError:
        return False


def _walk_records(payload):
    """Walk records backwards from the end of the payload (X3 and older firmware)."""
    records = {}
    pos = len(payload)
    while pos >= FOOTER:
        fmt, rec_id, length = struct.unpack("<BBI", payload[pos - FOOTER : pos])
        start = pos - FOOTER - length
        if start < 0:
            break
        records.setdefault(rec_id, payload[start : pos - FOOTER])
        pos = start
    return records


def _indexed_records(payload):
    """Read records through the index record that closes the payload (X4 and later)."""
    if len(payload) < FOOTER:
        return None
    fmt, rec_id, length = struct.unpack("<BBI", payload[-FOOTER:])
    if rec_id != REC_INDEX or fmt != 0 or length % INDEX_ENTRY or length > len(payload) - FOOTER:
        return None
    directory = payload[len(payload) - FOOTER - length : len(payload) - FOOTER]
    records = {}
    for i in range(0, length, INDEX_ENTRY):
        rid, rfmt, rlen, off = struct.unpack("<BBII", directory[i : i + INDEX_ENTRY])
        if rlen == 0 and off == 0 and rid == 0:
            continue
        if off + rlen > len(payload):
            continue
        records.setdefault(rid, payload[off : off + rlen])
    return records


def parse_payload(payload):
    records = _indexed_records(payload)
    if records is None:
        records = _walk_records(payload)
    return records


def read_trailer(path):
    """Return the Trailer of a file, or None when the file carries none."""
    try:
        f = open(path, "rb")
    except OSError as exc:
        raise CorruptInput("unreadable_input", f"The file {path} could not be opened: {exc.strerror}.") from exc
    with f:
        f.seek(0, 2)
        size = f.tell()
        if size < TAIL:
            return None
        found = read_tail(f, size)
        if found is None:
            return None
        trailer_size, _version = found
        f.seek(size - trailer_size)
        payload = f.read(trailer_size - TAIL)
    trailer = Trailer(records=parse_payload(payload))
    meta = trailer.records.get(REC_METADATA)
    if meta:
        trailer.metadata = decode_metadata(meta)
    return trailer


def parse_calibration_string(text):
    """Split an underscore joined calibration string into floats."""
    try:
        return [float(tok) for tok in text.split("_") if tok != ""]
    except ValueError as exc:
        raise CorruptInput("corrupt_calibration", "The camera calibration in the file could not be read.") from exc
