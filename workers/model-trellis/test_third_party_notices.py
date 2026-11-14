"""The image's license bundle: what third_party_notices.py writes into /licenses.

The pure-logic tests run anywhere. The image tests run inside the built
image (the Dockerfile build gate), after the bundle has been generated, and
prove the redistribution conditions of the use-restricted components hold.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import third_party_notices as tpn  # noqa: E402

LICENSES = Path("/licenses")
SOURCES = Path("/opt/licenses-src")
in_image = pytest.mark.skipif(
    not (LICENSES / "THIRD_PARTY_NOTICES.md").is_file(), reason="runs inside the built image"
)


class FakeMeta(dict):
    def get_all(self, key):
        value = self.get(key)
        return value if isinstance(value, list) else None


def test_declared_license_prefers_expression_then_field_then_classifier():
    assert tpn.declared_license(FakeMeta({"License-Expression": "MIT", "License": "BSD"})) == "MIT"
    assert tpn.declared_license(FakeMeta({"License": "BSD-3-Clause"})) == "BSD-3-Clause"
    meta = FakeMeta({"License": "UNKNOWN", "Classifier": ["License :: OSI Approved :: Apache Software License"]})
    assert tpn.declared_license(meta) == "Apache Software License"
    assert tpn.declared_license(FakeMeta({})) == "not declared in package metadata"


def test_declared_license_keeps_only_the_title_of_a_pasted_license_text():
    pasted = "Copyright (c) 2020 Someone\n\nPermission is hereby granted, free of charge, ..."
    assert tpn.declared_license(FakeMeta({"License": pasted})) == "Copyright (c) 2020 Someone"
    long_line = "x" * 300
    assert len(tpn.declared_license(FakeMeta({"License": long_line}))) == 120


@pytest.mark.parametrize(
    "text, phrase",
    [
        ("may be used or intended for use non-commercially", "intended for use non-commercially"),
        ("for research or evaluation purposes only and not for any direct", "research or evaluation purposes only"),
        ("Licensed for Non-Commercial use only.", "non-commercial use only"),
        ("free for commercial and non-commercial use", ""),
        ("allowed only occasionally and noncommercially", ""),
        ("research and/or\n evaluation purposes   only", "research and/or evaluation purposes only"),
        ("Permission is hereby granted, free of charge", ""),
    ],
)
def test_restrictive_phrase(text, phrase):
    assert tpn.restrictive_phrase(text) == phrase


def test_parse_dpkg_status_keeps_installed_packages_only():
    status = (
        "Package: libc6\nStatus: install ok installed\nVersion: 2.39-0ubuntu8\nDescription: GNU C\n multi\n\n"
        "Package: gone\nStatus: deinstall ok config-files\nVersion: 1.0\n\n"
        "Package: zlib1g\nStatus: install ok installed\nVersion: 1:1.3\n"
    )
    assert tpn.parse_dpkg_status(status) == [("libc6", "2.39-0ubuntu8"), ("zlib1g", "1:1.3")]


def test_every_use_restricted_component_quotes_its_clause():
    restricted = {c.key for c in tpn.SOURCE_COMPONENTS if c.restriction}
    assert restricted == {"nvdiffrast", "diff-gaussian-rasterization"}


def test_collect_sources_refuses_a_component_without_its_license(tmp_path):
    for comp in tpn.SOURCE_COMPONENTS:
        d = tmp_path / "src" / comp.key
        d.mkdir(parents=True)
        (d / "COMMIT").write_text("0123456789abcdef\n")
        if comp.key != "nvdiffrast":
            (d / "LICENSE").write_text(f"{comp.license}\n")
    with pytest.raises(SystemExit, match="nvdiffrast"):
        tpn.collect_sources(tmp_path / "src", tmp_path / "out")


def test_render_puts_restrictions_first_and_lists_everything(tmp_path):
    for comp in tpn.SOURCE_COMPONENTS:
        d = tmp_path / "src" / comp.key
        d.mkdir(parents=True)
        (d / "COMMIT").write_text("0123456789abcdef\n")
        (d / "LICENSE.txt").write_text(f"{comp.license}\n")
    sources = tpn.collect_sources(tmp_path / "src", tmp_path / "out")
    pkg = tpn.PythonPackage("torch", "2.6.0", "BSD-3-Clause", ["python/torch/LICENSE"])
    flagged = tpn.PythonPackage("oddpkg", "1.0", "Custom", [], flagged="non-commercial")
    out = tpn.render(sources, [pkg, flagged], [("libc6", "2.39")], ["/NGC-DL-CONTAINER-LICENSE"], list(tpn.BAKED_WEIGHTS))
    restrictions = out.index("## Use restrictions")
    assert restrictions < out.index("## Components built")
    assert out.index("nvdiffrast", restrictions) < out.index("## Components built")
    assert "| oddpkg | 1.0 | Custom | non-commercial |" in out
    assert "| torch | 2.6.0 | BSD-3-Clause | `python/torch/LICENSE` |" in out
    assert "dinov2_vitl14_reg4_pretrain.pth" in out
    assert "| libc6 | 2.39 |" in out
    assert (tmp_path / "out" / "source" / "nvdiffrast" / "LICENSE.txt").is_file()


@in_image
@pytest.mark.parametrize("comp", [c for c in tpn.SOURCE_COMPONENTS], ids=lambda c: c.key)
def test_image_ships_each_source_license_verbatim(comp):
    saved = sorted(p for p in (SOURCES / comp.key).iterdir() if tpn.LICENSE_FILE_RE.match(p.name))
    assert saved, f"builder saved no license for {comp.key}"
    for src in saved:
        shipped = LICENSES / "source" / comp.key / src.name
        assert shipped.read_bytes() == src.read_bytes()


@in_image
def test_image_notices_name_the_restricted_components_and_the_real_packages():
    notices = (LICENSES / "THIRD_PARTY_NOTICES.md").read_text()
    head = notices[: notices.index("## Components built")]
    for key in ("nvdiffrast", "diff-gaussian-rasterization"):
        assert key in head
    for pkg in ("torch", "kaolin", "xformers", "spconv-cu126", "fastapi"):
        assert f"| {pkg} |" in notices, pkg
    assert "dinov2_vitl14_reg4_pretrain.pth" in notices


@in_image
def test_image_leaves_out_diffoctreerast():
    # Research-only (Inria / MPII derivative) and never loaded: it only renders
    # Octree samples and main.py decodes gaussian and mesh. See the Dockerfile.
    assert importlib.util.find_spec("diffoctreerast") is None
