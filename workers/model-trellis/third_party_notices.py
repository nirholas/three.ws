"""Write the image's third-party license bundle: /licenses plus THIRD_PARTY_NOTICES.md.

The NGC Container EULA (public/legal/nvidia-ngc-eula.html, section 4) promises a
complete component and license listing inside the image, and two components
this image compiles from source (nvdiffrast and diff-gaussian-rasterization)
allow redistribution only when a complete copy of their license travels with
the distribution. This script makes both true from
the real image contents at build time, so the listing can never drift from what
ships:

  * every Python distribution installed in the virtualenv, with its declared
    license and a copy of each license file it ships;
  * every component built from a git checkout, from the license file and commit
    the builder stage saved (SOURCE_COMPONENTS below says what each one is);
  * the model weights baked into the image;
  * every Ubuntu package, pointing at its Debian copyright file;
  * the NVIDIA CUDA base image license files.

Components whose license limits use to research, evaluation or non-commercial
purposes are listed first, with the operative clause quoted, so nobody running
the image can miss them. Output is sorted and carries no timestamp, so the copy
committed beside this file diffs cleanly between builds.

    python3 third_party_notices.py --sources /opt/licenses-src --out /licenses
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path


@dataclass(frozen=True)
class SourceComponent:
    """A component the builder compiled or checked out from git."""

    key: str  # directory name under --sources
    name: str
    url: str
    license: str
    role: str
    restriction: str = ""  # operative clause, quoted from the license, when use is limited


SOURCE_COMPONENTS: tuple[SourceComponent, ...] = (
    SourceComponent(
        key="nvdiffrast",
        name="nvdiffrast",
        url="https://github.com/NVlabs/nvdiffrast",
        license="NVIDIA Source Code License (1-Way Commercial)",
        role="CUDA rasteriser used by the TRELLIS GLB texture bake and mesh renderer.",
        restriction=(
            'Section 3.3: "The Work and any derivative works thereof only may be used or '
            "intended for use non-commercially. [...] As used herein, \"non-commercially\" "
            'means for research or evaluation purposes only and not for any direct or '
            'indirect monetary gain." Commercial use is reserved to NVIDIA and its affiliates.'
        ),
    ),
    SourceComponent(
        key="diff-gaussian-rasterization",
        name="diff-gaussian-rasterization (mip-splatting fork)",
        url="https://github.com/autonomousvision/mip-splatting",
        license="Gaussian-Splatting License (Inria / MPII)",
        role="CUDA Gaussian splat rasteriser used to render the views the texture bake projects.",
        restriction=(
            'Section 3: "The Software may be used "non-commercially", i.e., for research '
            'and/or evaluation purposes only." Section 5: "THE USER CANNOT USE, EXPLOIT OR '
            'DISTRIBUTE THE SOFTWARE FOR COMMERCIAL PURPOSES WITHOUT PRIOR AND EXPLICIT '
            'CONSENT OF LICENSORS."'
        ),
    ),
    SourceComponent(
        key="TRELLIS",
        name="Microsoft TRELLIS",
        url="https://github.com/microsoft/TRELLIS",
        license="MIT",
        role="Image-to-3D pipeline source, imported from /app/TRELLIS.",
    ),
    SourceComponent(
        key="flexicubes",
        name="FlexiCubes (TRELLIS submodule)",
        url="https://github.com/MaxtirError/FlexiCubes",
        license="Apache-2.0",
        role="Mesh extractor vendored by TRELLIS at trellis/representations/mesh/flexicubes.",
    ),
    SourceComponent(
        key="utils3d",
        name="utils3d",
        url="https://github.com/EasternJournalist/utils3d",
        license="MIT",
        role="3D math and rasterisation helpers used by the TRELLIS postprocess.",
    ),
    SourceComponent(
        key="dinov2",
        name="DINOv2 (code and the dinov2_vitl14_reg4 checkpoint)",
        url="https://github.com/facebookresearch/dinov2",
        license="Apache-2.0",
        role="Image conditioner. Code at /opt/dinov2; weights at /opt/torch/hub/checkpoints.",
    ),
)

# Model weights that ship inside the image (everything else is mounted by the user).
BAKED_WEIGHTS: tuple[tuple[str, str, str], ...] = (
    (
        "/opt/torch/hub/checkpoints/dinov2_vitl14_reg4_pretrain.pth",
        "DINOv2 ViT-L/14 with registers, Meta AI",
        "Apache-2.0 (facebookresearch/dinov2 LICENSE covers code and model weights)",
    ),
)

CUDA_BASE_LICENSES: tuple[str, ...] = ("/NGC-DL-CONTAINER-LICENSE", "/usr/local/cuda/EULA.txt")

LICENSE_FILE_RE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE|COPYRIGHT)", re.IGNORECASE)

# Phrases that mark a use-limited license. A match puts the package in the
# "flagged for review" list so a surprise in a future dependency is visible.
# Bare "noncommercial" is deliberately absent: the GPL text bundled by numpy and
# scipy ("allowed only occasionally and noncommercially") and OpenSSL-style
# notices ("free for commercial and non-commercial use") would match it.
RESTRICTIVE_PHRASES: tuple[str, ...] = (
    "non-commercial use only",
    "noncommercial use only",
    "for non-commercial purposes only",
    "used non-commercially",
    "intended for use non-commercially",
    "research purposes only",
    "research or evaluation purposes only",
    "research and/or evaluation purposes only",
    "not for any direct or indirect monetary gain",
    "for commercial purposes without prior",
)


@dataclass
class PythonPackage:
    name: str
    version: str
    license: str
    license_files: list[str] = field(default_factory=list)
    flagged: str = ""


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def declared_license(meta) -> str:
    """The license a distribution declares, as one short line."""
    expression = (meta.get("License-Expression") or "").strip()
    if expression:
        return expression
    raw = (meta.get("License") or "").strip()
    if raw and raw.upper() != "UNKNOWN":
        first = raw.splitlines()[0].strip()
        # Some packages paste the whole license text into the field; keep the title.
        return first if len(first) <= 120 else first[:117] + "..."
    classifiers = [
        c.split("::")[-1].strip()
        for c in (meta.get_all("Classifier") or [])
        if c.startswith("License ::")
    ]
    if classifiers:
        return "; ".join(sorted(set(classifiers)))
    return "not declared in package metadata"


def restrictive_phrase(text: str) -> str:
    lowered = " ".join(text.lower().split())
    for phrase in RESTRICTIVE_PHRASES:
        if phrase in lowered:
            return phrase
    return ""


def parse_dpkg_status(text: str) -> list[tuple[str, str]]:
    """(package, version) for every installed entry in /var/lib/dpkg/status."""
    packages = []
    for stanza in text.split("\n\n"):
        fields = {}
        for line in stanza.splitlines():
            if line and not line[0].isspace() and ":" in line:
                key, _, value = line.partition(":")
                fields[key] = value.strip()
        if fields.get("Package") and fields.get("Status", "").endswith(" installed"):
            packages.append((fields["Package"], fields.get("Version", "")))
    return sorted(set(packages))


def collect_python(out: Path, path: list[str] | None = None) -> list[PythonPackage]:
    seen: dict[str, PythonPackage] = {}
    for dist in metadata.distributions(path=path) if path is not None else metadata.distributions():
        name = dist.metadata.get("Name")
        if not name or normalize(name) in seen:
            continue
        pkg = PythonPackage(name=name, version=dist.version, license=declared_license(dist.metadata))
        dest = out / "python" / normalize(name)
        texts = [pkg.license]
        for entry in dist.files or []:
            if not LICENSE_FILE_RE.match(Path(str(entry)).name):
                continue
            src = Path(dist.locate_file(entry))
            if not src.is_file():
                continue
            rel = Path(str(entry))
            # Keep the path below dist-info so two files named LICENSE never collide.
            parts = [p for p in rel.parts if not p.endswith(".dist-info")]
            target = dest.joinpath(*parts) if parts else dest / rel.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, target)
            pkg.license_files.append(str(target.relative_to(out)))
            texts.append(src.read_text(errors="replace"))
        pkg.license_files.sort()
        pkg.flagged = restrictive_phrase("\n".join(texts))
        seen[normalize(name)] = pkg
    return sorted(seen.values(), key=lambda p: normalize(p.name))


def collect_sources(sources: Path, out: Path) -> list[tuple[SourceComponent, str, list[str]]]:
    """Copy each source component's saved license files; fail if any are missing."""
    rows = []
    for comp in SOURCE_COMPONENTS:
        src_dir = sources / comp.key
        commit_file = src_dir / "COMMIT"
        files = sorted(p for p in src_dir.glob("*") if p.is_file() and LICENSE_FILE_RE.match(p.name))
        if not files or not commit_file.is_file():
            raise SystemExit(
                f"third_party_notices: {comp.key} has no saved license file or COMMIT in {src_dir}; "
                "the builder stage must save both before deleting the checkout"
            )
        dest = out / "source" / comp.key
        dest.mkdir(parents=True, exist_ok=True)
        copied = []
        for f in files:
            shutil.copyfile(f, dest / f.name)
            copied.append(str((dest / f.name).relative_to(out)))
        rows.append((comp, commit_file.read_text().strip(), copied))
    return rows


def md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render(
    sources: list[tuple[SourceComponent, str, list[str]]],
    python: list[PythonPackage],
    debs: list[tuple[str, str]],
    cuda_files: list[str],
    weights: list[tuple[str, str, str]],
) -> str:
    restricted = [(c, commit) for c, commit, _ in sources if c.restriction]
    flagged = [p for p in python if p.flagged]
    lines = [
        "# Third-party notices: three.ws TRELLIS Mesh Server",
        "",
        "Generated at image build time by `third_party_notices.py` from the packages actually",
        "installed in the image. Inside the container this file is",
        "`/licenses/THIRD_PARTY_NOTICES.md` and every license text it references is under",
        "`/licenses/`. The three.ws serving code is Apache-2.0; the NGC Container EULA is at",
        "https://three.ws/legal/nvidia-ngc-eula. Where a component's own license conflicts",
        "with the EULA, that component's license governs it.",
        "",
        "## Use restrictions: read first",
        "",
        "These components are redistributed under their own licenses, which limit use to",
        "research, evaluation or other non-commercial purposes. The image cannot run inference",
        "without them, so the image as a whole inherits their limits: commercial use of the",
        "image requires the rights holders' permission.",
        "",
        "| Component | License | Operative clause | License text |",
        "|---|---|---|---|",
    ]
    by_key = {c.key: files for c, _, files in sources}
    for comp, commit in restricted:
        lines.append(
            f"| [{comp.name}]({comp.url}) at `{commit[:12]}` | {md_cell(comp.license)} | "
            f"{md_cell(comp.restriction)} | {', '.join(f'`{f}`' for f in by_key[comp.key])} |"
        )
    lines += ["", "### Python packages flagged for review", ""]
    if flagged:
        lines += [
            "Their license metadata or files contain a phrase that usually signals a use limit.",
            "",
            "| Package | Version | Declared license | Matched phrase |",
            "|---|---|---|---|",
        ]
        lines += [
            f"| {md_cell(p.name)} | {p.version} | {md_cell(p.license)} | {p.flagged} |" for p in flagged
        ]
    else:
        lines.append("None: no Python package's license metadata or files match a use-limit phrase.")
    lines += [
        "",
        "## Components built or checked out from source",
        "",
        "| Component | Commit | License | Role | License text |",
        "|---|---|---|---|---|",
    ]
    for comp, commit, files in sources:
        lines.append(
            f"| [{comp.name}]({comp.url}) | `{commit[:12]}` | {md_cell(comp.license)} | "
            f"{md_cell(comp.role)} | {', '.join(f'`{f}`' for f in files)} |"
        )
    lines += [
        "",
        "## Model weights included in the image",
        "",
        "The TRELLIS weights are not included; you mount them. Only this conditioner checkpoint",
        "is baked in, so the model load never depends on a network call.",
        "",
        "| File | Model | License |",
        "|---|---|---|",
    ]
    lines += [f"| `{path}` | {md_cell(model)} | {md_cell(lic)} |" for path, model, lic in weights]
    lines += [
        "",
        f"## Python packages ({len(python)})",
        "",
        "| Package | Version | Declared license | License files |",
        "|---|---|---|---|",
    ]
    for p in python:
        files = ", ".join(f"`{f}`" for f in p.license_files) or "none shipped in the distribution"
        lines.append(f"| {md_cell(p.name)} | {p.version} | {md_cell(p.license)} | {files} |")
    lines += [
        "",
        "## NVIDIA CUDA base image",
        "",
        "The image is built on `nvidia/cuda` (runtime flavour). NVIDIA's CUDA and container",
        "license terms ship in the image at:",
        "",
    ]
    lines += [f"- `{f}`" for f in cuda_files] or ["- (no NVIDIA license file found at the standard paths)"]
    lines += [
        "",
        f"## Ubuntu packages ({len(debs)})",
        "",
        "Each package's copyright and license terms are at `/usr/share/doc/<package>/copyright`.",
        "",
        "| Package | Version |",
        "|---|---|",
    ]
    lines += [f"| {name} | {version} |" for name, version in debs]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dpkg-status", type=Path, default=Path("/var/lib/dpkg/status"))
    args = parser.parse_args(argv)

    args.out.mkdir(parents=True, exist_ok=True)
    sources = collect_sources(args.sources, args.out)
    python = collect_python(args.out)
    debs = parse_dpkg_status(args.dpkg_status.read_text()) if args.dpkg_status.is_file() else []
    cuda_files = [f for f in CUDA_BASE_LICENSES if Path(f).is_file()]
    weights = [w for w in BAKED_WEIGHTS if Path(w[0]).is_file()]
    notices = render(sources, python, debs, cuda_files, weights)
    (args.out / "THIRD_PARTY_NOTICES.md").write_text(notices)
    print(
        f"third_party_notices: {len(sources)} source components, {len(python)} Python packages, "
        f"{len(debs)} Ubuntu packages, {sum(1 for c, _, _ in sources if c.restriction)} use-restricted"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
