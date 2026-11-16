import io

import av
import numpy as np
import pytest

import control


def make_video(frames: list[np.ndarray], codec="libvpx", fmt="webm", fps=30) -> bytes:
    buf = io.BytesIO()
    with av.open(buf, mode="w", format=fmt) as out:
        stream = out.add_stream(codec, rate=fps)
        stream.width, stream.height = frames[0].shape[1], frames[0].shape[0]
        stream.pix_fmt = "yuv420p"
        for arr in frames:
            for packet in stream.encode(av.VideoFrame.from_ndarray(arr, format="rgb24")):
                out.mux(packet)
        for packet in stream.encode():
            out.mux(packet)
    return buf.getvalue()


def box_frames(n=12, w=320, h=240):
    frames = []
    for i in range(n):
        img = np.zeros((h, w, 3), dtype=np.uint8)
        x = 40 + i * 4
        img[60:180, x : x + 100] = 255
        frames.append(img)
    return frames


def test_resample_indices_spreads_and_repeats():
    assert control.resample_indices(5, 5) == [0, 1, 2, 3, 4]
    assert control.resample_indices(3, 5) == [0, 0, 1, 2, 2]
    picks = control.resample_indices(100, 33)
    assert picks[0] == 0 and picks[-1] == 99 and len(picks) == 33


def test_fit_frame_center_crops_to_16_9():
    frame = np.zeros((480, 480, 3), dtype=np.uint8)
    assert control.fit_frame(frame, 832, 480).shape == (480, 832, 3)


def test_edge_mode_from_webm():
    hints = control.control_videos_for(make_video(box_frames()), "edge", num_frames=33, width=832, height=480)
    frames = hints["edge"]
    assert len(frames) == 33 and frames[0].size == (832, 480)
    arr = np.asarray(frames[0])
    assert set(np.unique(arr)) <= {0, 255} and arr.mean() > 0


def test_depth_mode_keeps_gradient():
    grad = [np.tile(np.linspace(0, 255, 320, dtype=np.uint8)[None, :, None], (240, 1, 3)) for _ in range(6)]
    frames = control.control_videos_for(make_video(grad), "depth", num_frames=33, width=832, height=480)["depth"]
    arr = np.asarray(frames[0])
    assert arr[:, :, 0].std() > 20 and (arr[:, :, 0] == arr[:, :, 1]).all()


def test_blank_render_is_refused():
    blank = [np.zeros((240, 320, 3), dtype=np.uint8) for _ in range(6)]
    with pytest.raises(control.ControlError, match="no edges"):
        control.control_videos_for(make_video(blank), "edge", num_frames=33, width=832, height=480)
    with pytest.raises(control.ControlError, match="flat"):
        control.control_videos_for(make_video(blank), "depth", num_frames=33, width=832, height=480)


def test_garbage_bytes_are_a_control_error():
    with pytest.raises(control.ControlError):
        control.decode_frames(b"not a video at all")
