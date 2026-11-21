"""Video path: decode both lenses with ffmpeg, stitch every frame, encode with ffmpeg."""

import json
import math
import os
import subprocess
import sys

import numpy as np

from . import imu as imu_mod
from . import trailer as trailer_mod
from .calibration import calibration_from_metadata
from .errors import CorruptInput, StitchError
from .layout import LAYOUT_SIDE_BY_SIDE
from .stitch import CpuBackend, GainState, Geometry, pick_backend


def emit_progress(stage, progress):
    sys.stdout.write(json.dumps({"stage": stage, "progress": round(float(progress), 4)}) + "\n")
    sys.stdout.flush()


def plan_size(source, max_width):
    side = source.streams[0].height
    native = 2 * side
    out_w = min(native, int(max_width)) // 2 * 2
    out_h = out_w // 2
    return native, out_w, out_h


def trim_window(source, trim_start, trim_end):
    total = min(s.duration_s for s in source.streams)
    start = max(0.0, float(trim_start or 0.0))
    end = total - max(0.0, float(trim_end or 0.0))
    if end - start <= 0.05:
        raise StitchError("bad_trim", f"The trim leaves no video: the clip is {total:.2f} s long.")
    return start, end - start


def _decode_cmd(path, stream, start, duration, width, height, pix):
    return [
        "ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start:.6f}", "-i", path, "-map", f"0:v:{stream}", "-t", f"{duration:.6f}",
        "-vf", f"scale={width}:{height}:flags=area:in_color_matrix=bt709", "-pix_fmt", pix, "-f", "rawvideo", "-",
    ]


class Reader:
    """Yields [lens0, lens1] frames as arrays."""

    def __init__(self, source, start, duration, lens_side, ten_bit):
        self.pix = "rgb48le" if ten_bit else "rgb24"
        self.dtype = np.uint16 if ten_bit else np.uint8
        self.side = lens_side
        self.sbs = source.layout == LAYOUT_SIDE_BY_SIDE
        self.bytes_per = lens_side * lens_side * 3 * (2 if ten_bit else 1)
        self.procs = []
        if self.sbs:
            cmd = _decode_cmd(source.files[0], 0, start, duration, 2 * lens_side, lens_side, self.pix)
            self.procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        else:
            for file_idx, stream in source.lens_inputs:
                cmd = _decode_cmd(source.files[file_idx], stream, start, duration, lens_side, lens_side, self.pix)
                self.procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE))

    def _read(self, proc, count):
        buf = proc.stdout.read(count)
        while buf is not None and len(buf) < count:
            more = proc.stdout.read(count - len(buf))
            if not more:
                return None
            buf += more
        return buf

    def frames(self):
        side = self.side
        while True:
            if self.sbs:
                raw = self._read(self.procs[0], self.bytes_per * 2)
                if raw is None:
                    return
                both = np.frombuffer(raw, self.dtype).reshape(side, 2 * side, 3)
                yield [np.ascontiguousarray(both[:, :side]), np.ascontiguousarray(both[:, side:])]
            else:
                raws = [self._read(p, self.bytes_per) for p in self.procs]
                if any(r is None for r in raws):
                    return
                yield [np.frombuffer(r, self.dtype).reshape(side, side, 3) for r in raws]

    def close(self):
        errors = []
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            err = p.stderr.read().decode("utf-8", "replace").strip()
            if err:
                errors.append(err)
            p.stdout.close()
            p.stderr.close()
            p.wait()
        return errors


def encoder_plan(ten_bit, backend_name):
    """H.265 10-bit for 10-bit sources, else H.264; the GPU encoder when ffmpeg has one and a GPU is present."""
    codecs = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    use_gpu = backend_name == "cuda"
    if ten_bit:
        if use_gpu and "hevc_nvenc" in codecs:
            return ["-c:v", "hevc_nvenc", "-preset", "p5", "-cq", "21", "-pix_fmt", "p010le", "-profile:v", "main10"], "hevc_nvenc"
        return ["-c:v", "libx265", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1"], "libx265"
    if use_gpu and "h264_nvenc" in codecs:
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19", "-pix_fmt", "yuv420p"], "h264_nvenc"
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"], "libx264"


def open_encoder(out_path, source, start, duration, out_w, out_h, fps, ten_bit, backend_name):
    codec_args, codec = encoder_plan(ten_bit, backend_name)
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le" if ten_bit else "rgb24",
        "-s", f"{out_w}x{out_h}", "-r", f"{fps:.6f}", "-i", "-",
    ]
    audio = source.has_audio
    if audio:
        cmd += ["-ss", f"{start:.6f}", "-t", f"{duration:.6f}", "-i", source.files[0]]
    cmd += ["-map", "0:v:0"]
    if audio:
        cmd += ["-map", "1:a:0?", "-c:a", "aac", "-b:a", "192k"]
    cmd += [
        "-vf", "scale=out_color_matrix=bt709:out_range=tv", *codec_args,
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-movflags", "+faststart", "-shortest", out_path,
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE), codec


def frame_times(trailer, start_frame, count, fps, warnings):
    """Camera clock time (s) of each output frame, from the per frame exposure record."""
    rec = trailer.record(trailer_mod.REC_EXPOSURE)
    exposure = trailer_mod.decode_exposure(rec) if rec else None
    if exposure is not None and len(exposure[0]) >= start_frame + count:
        return exposure[0][start_frame : start_frame + count]
    md = trailer.metadata
    if exposure is not None and len(exposure[0]):
        base = exposure[0][0]
    else:
        base = md.first_frame_us * 1e-6
        warnings.append("frame_timestamps_missing: the exposure record is absent, so the first frame time of the metadata is used to sync the gyro")
    return base + (start_frame + np.arange(count)) / fps


def build_rotations(source, times, level, warnings):
    """(per frame view to body matrices, imu sample count, whether levelled)."""
    count = len(times)
    if not level:
        return imu_mod.static_rotations(count), 0, False
    md = source.trailer.metadata
    rec = source.trailer.record(trailer_mod.REC_IMU)
    decoded = trailer_mod.decode_imu(rec, md) if rec else None
    if decoded is None or len(decoded[0]) < 100:
        warnings.append("no_imu: the file carries no usable gyro and accelerometer record, so the horizon was not levelled")
        return imu_mod.static_rotations(count), 0, False
    t, accel, gyro = decoded
    t = t - md.gyro_offset_ms * 1e-3
    if times[-1] < t[0] or times[0] > t[-1]:
        warnings.append("imu_out_of_range: the gyro record does not overlap the video in time, so the horizon was not levelled")
        return imu_mod.static_rotations(count), len(t), False
    if times[0] < t[0] - 0.5 or times[-1] > t[-1] + 0.5:
        warnings.append("imu_partial: the gyro record covers only part of the video, the orientation is held at its first or last value outside it")
    _, quats = imu_mod.track_orientation(t, accel, gyro)
    return imu_mod.frame_rotations(times, t, quats), len(t), True


def stitch_video(source, out_dir, max_width, level, trim_start, trim_end, backend_pref="auto"):
    warnings = []
    cal = calibration_from_metadata(source.trailer.metadata)
    native, out_w, out_h = plan_size(source, max_width)
    start, duration = trim_window(source, trim_start, trim_end)
    info = source.streams[0]
    fps = info.fps or 30.0
    ten_bit = info.ten_bit
    scale = out_w / native
    lens_side = max(64, int(round(info.height * min(1.0, scale) / 2.0)) * 2)
    expected = max(1, int(math.floor(duration * fps + 1e-6)))
    start_frame = int(round(start * fps))
    times = frame_times(source.trailer, start_frame, expected, fps, warnings)
    rotations, imu_samples, levelled = build_rotations(source, times, level, warnings)

    backend = pick_backend(backend_pref)
    geo = Geometry(out_w, out_h)
    gains = GainState()
    peak = 65535 if ten_bit else 255
    reader = Reader(source, start, duration, lens_side, ten_bit)
    out_path = os.path.join(out_dir, "equirect.mp4")
    encoder, codec = open_encoder(out_path, source, start, duration, out_w, out_h, fps, ten_bit, backend.name)
    frames_done = 0
    static = not levelled
    coarse_static = None
    try:
        for pair in reader.frames():
            if frames_done >= expected:
                break
            if static and coarse_static is not None:
                coarse = coarse_static
            else:
                coarse = geo.coarse_maps(cal, [(lens_side, lens_side)] * 2, rotations[min(frames_done, len(rotations) - 1)])
                if static:
                    coarse_static = coarse
            out = backend.compose(pair, coarse, geo, gains, peak)
            try:
                encoder.stdin.write(out.tobytes())
            except BrokenPipeError:
                break
            frames_done += 1
            if frames_done % 5 == 0 or frames_done == expected:
                emit_progress("stitch", frames_done / expected)
    finally:
        decode_errors = reader.close()
        try:
            encoder.stdin.close()
        except BrokenPipeError:
            pass
        enc_err = encoder.stderr.read().decode("utf-8", "replace").strip()
        code = encoder.wait()
    if frames_done == 0:
        raise CorruptInput("corrupt_input", "No video frames could be decoded: " + (decode_errors[0][:200] if decode_errors else "the stream is empty."))
    if code != 0:
        raise StitchError("encode_failed", f"ffmpeg ({codec}) failed: {enc_err[-300:]}")
    if decode_errors:
        warnings.append("decode_warning: " + decode_errors[0][:200])
    if frames_done < expected * 0.98:
        warnings.append(f"short_decode: {frames_done} of {expected} expected frames were decoded")
    if level and not levelled and not any(w.startswith(("no_imu", "imu_out")) for w in warnings):
        warnings.append("not_levelled: the horizon was not levelled")
    return {
        "width": out_w, "height": out_h, "fps": round(fps, 4), "duration_s": round(frames_done / fps, 3), "frames": frames_done,
        "horizon_leveled": levelled, "imu_samples": imu_samples, "calibration_model": cal.model, "warnings": warnings,
        "backend": backend.name, "encoder": codec,
    }
