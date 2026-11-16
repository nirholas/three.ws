"""Unit tests for stage_weights.py: the NGC file list, the checksum gate and the manifest.

Run: python3 -I -m pytest workers/model-cosmos-reason/test_stage_weights.py
     (or python3 -I workers/model-cosmos-reason/test_stage_weights.py)
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stage_weights  # noqa: E402

SHARD = b"\x00\x01safetensors-bytes" * 64
CONFIG = b'{"architectures": ["Qwen3VLForConditionalGeneration"]}'


def b64sha(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def make_opener(files: dict[str, bytes], corrupt: str | None = None):
    listing = {
        "modelFiles": [{"path": p, "sizeInBytes": len(b), "sha256_base64": b64sha(b)} for p, b in files.items()]
        + [{"path": ".gitattributes", "sizeInBytes": 1, "sha256_base64": b64sha(b"x")},
           {"path": ".cache/huggingface/x.lock", "sizeInBytes": 1, "sha256_base64": b64sha(b"x")}]
    }
    seen = []

    def opener(req, timeout=None):
        url = req.full_url
        seen.append((url, req.get_header("Authorization")))
        if url.endswith("/files"):
            return FakeResp(json.dumps(listing).encode())
        name = url.split("/files/", 1)[1]
        data = files[name]
        if name == corrupt:
            data = data[:-1] + b"!"
        return FakeResp(data)

    opener.seen = seen
    return opener


class StageWeightsTest(unittest.TestCase):
    def setUp(self):
        os.environ["NGC_API_KEY"] = "nvapi-test"
        self.files = {"config.json": CONFIG, "model-00001-of-00001.safetensors": SHARD}

    def test_stages_verifies_and_writes_manifest(self):
        opener = make_opener(self.files)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            manifest = stage_weights.stage("hf-0303", out, opener)
            self.assertEqual(manifest["revision"], "hf-0303")
            self.assertEqual(set(manifest["files"]), set(self.files))
            self.assertEqual(manifest["files"]["config.json"]["sha256"], hashlib.sha256(CONFIG).hexdigest())
            self.assertEqual((out / "REVISION").read_text(), "hf-0303\n")
            self.assertEqual(json.loads((out / "MANIFEST.json").read_text()), manifest)
            self.assertFalse((out / ".gitattributes").exists())
        self.assertTrue(all(auth == "Bearer nvapi-test" for _, auth in opener.seen))

    def test_refuses_a_file_whose_checksum_drifted(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit) as ctx:
                stage_weights.stage("hf-0303", Path(d), make_opener(self.files, corrupt="model-00001-of-00001.safetensors"))
            self.assertIn("sha256", str(ctx.exception))
            self.assertFalse((Path(d) / "REVISION").exists())

    def test_refuses_a_tree_without_shards(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                stage_weights.stage("hf-0303", Path(d), make_opener({"config.json": CONFIG}))

    def test_requires_a_key(self):
        del os.environ["NGC_API_KEY"]
        with self.assertRaises(SystemExit):
            stage_weights.ngc_files("hf-0303", make_opener(self.files))


if __name__ == "__main__":
    unittest.main()
