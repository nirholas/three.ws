"""stitch.json: the record of what a run produced (contract C1)."""

import json
import os

KEYS = (
    "camera_model", "lens_layout", "calibration_model", "width", "height", "fps", "duration_s", "frames",
    "horizon_leveled", "imu_samples", "warnings",
)


def build_report(source, result):
    report = {
        "camera_model": source.model,
        "lens_layout": source.layout,
        "calibration_model": result["calibration_model"],
        "width": int(result["width"]),
        "height": int(result["height"]),
        "fps": float(result["fps"]),
        "duration_s": float(result["duration_s"]),
        "frames": int(result["frames"]),
        "horizon_leveled": bool(result["horizon_leveled"]),
        "imu_samples": int(result["imu_samples"]),
        "warnings": list(result["warnings"]),
    }
    return report


def write_report(out_dir, report):
    path = os.path.join(out_dir, "stitch.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    return path
