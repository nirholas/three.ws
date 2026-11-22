"""H.264 encoding of the flythrough through the system ffmpeg."""
import subprocess

import numpy as np

WIDTH = 1920
HEIGHT = 1080
FPS = 30
MAX_SECONDS = 20
# Web playback budget for the full 20 s at 1080p30. On the measured garden flythrough
# 12 Mbps gave 30 MB at SSIM 0.92 against CRF 18 (86.5 MB); 8 Mbps smeared the grass (0.89).
MAX_BITRATE = 12_000_000
BUFFER_BITS = 24_000_000


def open_encoder(path, width=WIDTH, height=HEIGHT, fps=FPS):
    """Start ffmpeg reading raw RGB frames on stdin. yuv420p + faststart plays in every
    browser and imports into Premiere; High profile level 4.1 covers 1080p30 on hardware decoders.
    CRF 23 under a VBV cap keeps a dense 3M-Gaussian flythrough near 30 MB instead of 85."""
    cmd = [
        'ffmpeg', '-v', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-maxrate', str(MAX_BITRATE), '-bufsize', str(BUFFER_BITS),
        '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-movflags', '+faststart', '-an', path,
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)


def write_frame(proc, frame):
    """frame: uint8 array (H, W, 3)."""
    proc.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())


def close_encoder(proc):
    proc.stdin.close()
    err = proc.stderr.read().decode('utf-8', 'replace')
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f'ffmpeg failed to encode the preview video: {err.strip()[-300:]}')


def encode_frames(path, frames, width=WIDTH, height=HEIGHT, fps=FPS):
    proc = open_encoder(path, width, height, fps)
    try:
        for f in frames:
            write_frame(proc, f)
    except BrokenPipeError:
        pass
    close_encoder(proc)
