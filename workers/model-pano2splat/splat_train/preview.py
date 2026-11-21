"""Flythrough preview: render the trained splat along the smoothed capture path."""
import math

import numpy as np

from . import scene, video


def preview_intrinsics(width=video.WIDTH, height=video.HEIGHT, hfov_deg=75.0):
    f = (width / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)
    return np.array([[f, 0, width / 2.0], [0, f, height / 2.0], [0, 0, 1]], dtype=np.float32)


def preview_frame_count(n_images):
    seconds = float(np.clip(n_images / 8.0, 8.0, video.MAX_SECONDS))
    return int(round(seconds * video.FPS))


def render_preview(model, ds, out_path, report):
    """Render and encode preview.mp4 (1920x1080, 30 fps, at most 20 s). Returns path info."""
    import torch
    c2ws = np.stack([f.c2w for f in ds.frames])
    n = preview_frame_count(len(ds.frames))
    poses, info = scene.plan_flythrough(c2ws, n)
    K = torch.as_tensor(preview_intrinsics(), device='cuda')[None]
    proc = video.open_encoder(out_path)
    try:
        with torch.no_grad():
            for i, pose in enumerate(poses):
                c2w = torch.as_tensor(pose, dtype=torch.float32, device='cuda')[None]
                out, _, _ = model.render(c2w, K, video.WIDTH, video.HEIGHT)
                frame = (out[0].clamp(0, 1).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
                video.write_frame(proc, frame)
                if i % 15 == 0:
                    report(i / n)
    except BaseException:
        proc.kill()
        raise
    video.close_encoder(proc)
    info['frames'] = n
    info['seconds'] = n / video.FPS
    return info
