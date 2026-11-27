"""
Geometry-based part segmentation for triangle meshes.

Why geometry, not a learned model
---------------------------------
A learned 3D part-segmentation network (e.g. PartField / SAM-3D via a GPU
worker) can attach human labels ("head", "arm") but it brings a hard GPU
dependency, non-determinism, and an external-availability risk — and it still
fails on the long tail of stylised, low-poly, or non-organic meshes the forge
pipeline produces. Convex decomposition (CoACD/VHACD) over-fragments organic
shapes into dozens of convex shards that are not the parts a human would name.

We instead segment on the geometry the mesh already carries, which is fast,
deterministic, GPU-free (consistent with the CPU remesh worker), and works on
any topology:

  1. Connected components first. Anything physically disjoint — wheels, eyes,
     a weapon, loose accessories — separates immediately and perfectly.

  2. The minima rule within each connected component. Human shape perception
     segments objects at concave creases (Hoffman & Richards, 1984). We cut the
     face-adjacency graph along strong concave edges, then take the connected
     components of what remains. This finds the natural seam between a limb and
     a torso, a handle and a body, a wheel-arch and a fender.

  3. Cleanup. Tiny shards are merged back into their largest neighbour, and the
     part count is capped by repeatedly merging the smallest part into its
     largest neighbour — so the output is a handful of meaningful parts, not a
     thousand crease fragments.

All topology runs on a copy welded by position, so the vertex splits a texture
atlas puts on every UV seam never read as part seams. Parts are then cut from
the original mesh, so each part keeps its UVs and material. Fragments fold
into the nearest region, never into a catch-all lump.

Parts are named by their spatial region (top / lower-left / core …) so the
labels read meaningfully in the viewer. An untextured mesh is tinted a
distinct hue per part so the split is visible; a textured one keeps its look
and carries the hue in the manifest only. A model with nothing to split is
flagged `single_part` with a plain-language `note`.
"""

from __future__ import annotations

import colorsys
import heapq
import math
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


class SegmentInputError(ValueError):
    """A caller's fault, described in terms the caller can act on.

    Distinct from a bare ValueError so the service can echo THESE messages
    verbatim while keeping every unexpected failure opaque. A library-internal
    ValueError must never reach a client; "part 'part_99' not found. Available:
    ..." always should.
    """


class SegmentTimeout(RuntimeError):
    """Raised when segmentation exceeds its wall-clock budget.

    A segmentation nobody is still waiting for is worse than a failure: the
    caller has long since given up, but the job keeps a worker slot and its
    memory pinned. We stop and say so instead.
    """


def _check_deadline(deadline: Optional[float], stage: str) -> None:
    if deadline is not None and time.monotonic() > deadline:
        raise SegmentTimeout(
            f"segmentation exceeded its time budget during {stage}; "
            "retry with a lower max_parts, a higher min_part_faces, or a "
            "decimated mesh"
        )

# A perceptually spread palette — distinct adjacent hues, golden-ratio stepped
# so even 20+ parts stay visually separable.
_GOLDEN = 0.61803398875


def _palette(n: int) -> list[tuple[int, int, int]]:
    colors = []
    h = 0.08
    for _ in range(max(n, 1)):
        r, g, b = colorsys.hsv_to_rgb(h % 1.0, 0.62, 0.95)
        colors.append((int(r * 255), int(g * 255), int(b * 255)))
        h += _GOLDEN
    return colors


@dataclass
class Part:
    index: int
    name: str
    mesh: "trimesh.Trimesh"
    color: tuple[int, int, int]
    region: str

    def manifest(self) -> dict:
        b = self.mesh.bounds  # (2,3) min,max
        centroid = self.mesh.centroid
        return {
            "id": f"part_{self.index:02d}",
            "name": self.name,
            "region": self.region,
            "face_count": int(len(self.mesh.faces)),
            "vertex_count": int(len(self.mesh.vertices)),
            "bbox": {
                "min": [float(x) for x in b[0]],
                "max": [float(x) for x in b[1]],
            },
            "centroid": [float(x) for x in centroid],
            "volume": float(abs(self.mesh.volume)) if self.mesh.is_volume else 0.0,
            "color": "#%02x%02x%02x" % self.color,
        }


@dataclass
class SegmentationResult:
    parts: list[Part]
    source_faces: int
    method: str
    warnings: list[str] = field(default_factory=list)
    single_part: bool = False
    note: Optional[str] = None


# ── mesh loading / normalisation ──────────────────────────────────────────────


def load_concatenated(data: bytes, suffix: str) -> "trimesh.Trimesh":
    """Load a mesh or scene and return a single Trimesh.

    A glTF scene's own node split is *not* a reliable part split — exporters
    routinely emit a whole character as one node, or shatter it into per-material
    nodes. We concatenate to a single mesh and re-derive parts from geometry so
    the result is consistent regardless of how the source was authored.
    """
    import io

    loaded = trimesh.load(
        io.BytesIO(data),
        file_type=suffix.lstrip("."),
        force="mesh",
        process=True,
    )
    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise SegmentInputError("no triangle geometry found in the model")
        mesh = trimesh.util.concatenate(meshes)
    else:
        mesh = loaded
    if mesh.faces is None or len(mesh.faces) == 0:
        raise SegmentInputError("mesh has no faces to segment")
    mesh.merge_vertices()
    return mesh


# ── core segmentation ─────────────────────────────────────────────────────────


def _crease_labels(mesh: "trimesh.Trimesh", crease_angle_rad: float) -> np.ndarray:
    """Label faces by minima-rule region growing.

    Faces stay connected across an edge unless that edge is concave and its
    dihedral angle exceeds the threshold; the connected components of the
    surviving graph are the regions.
    """
    n_faces = len(mesh.faces)
    adjacency = mesh.face_adjacency  # (E, 2)
    if len(adjacency) == 0:
        return np.zeros(n_faces, dtype=np.int64)

    angles = mesh.face_adjacency_angles  # (E,) radians, unsigned
    convex = mesh.face_adjacency_convex  # (E,) bool, True where the edge bulges out

    # The minima rule: cut only at *concave* creases sharper than the threshold.
    cut = (~convex) & (angles > crease_angle_rad)
    keep = adjacency[~cut]

    if len(keep) == 0:
        # Every interior edge is a sharp concave crease — nothing to grow.
        return np.arange(n_faces, dtype=np.int64)

    rows = np.concatenate([keep[:, 0], keep[:, 1]])
    cols = np.concatenate([keep[:, 1], keep[:, 0]])
    data = np.ones(len(rows), dtype=np.uint8)
    graph = coo_matrix((data, (rows, cols)), shape=(n_faces, n_faces))
    _, labels = connected_components(graph, directed=False)
    return labels


def _label_adjacency(mesh: "trimesh.Trimesh", labels: np.ndarray) -> dict[int, set[int]]:
    """Which labels touch which, via the full face-adjacency graph.

    Vectorised: the unique boundary label-pairs are computed in numpy, so the
    Python loop runs once per distinct pair rather than once per boundary edge.
    """
    neighbours: dict[int, set[int]] = {}
    fa = mesh.face_adjacency
    if len(fa) == 0:
        return neighbours
    la = labels[fa[:, 0]]
    lb = labels[fa[:, 1]]
    diff = la != lb
    if not diff.any():
        return neighbours
    lo = np.minimum(la[diff], lb[diff])
    hi = np.maximum(la[diff], lb[diff])
    pairs = np.unique(np.stack([lo, hi], axis=1), axis=0)
    for a, b in pairs:
        neighbours.setdefault(int(a), set()).add(int(b))
        neighbours.setdefault(int(b), set()).add(int(a))
    return neighbours


def _merge_small_and_cap(
    mesh: "trimesh.Trimesh",
    labels: np.ndarray,
    min_part_faces: int,
    max_parts: int,
    deadline: Optional[float] = None,
    *,
    island_floor: Optional[int] = None,
    nearest=None,
    stats: Optional[dict] = None,
) -> np.ndarray:
    """Merge sub-threshold parts into their largest neighbour, then cap count.

    Islands (regions that share no edge with any other region, e.g. a loose
    fragment or a separate shell) cannot have a "largest neighbour". When a
    `nearest(root, alive_roots, sizes, find)` callback is supplied, an island
    below `island_floor` faces is folded into the spatially nearest region, and
    the cap pass folds islands the same way, so a capped run joins pieces that
    sit side by side instead of piling unrelated ones together. Without the
    callback the original policy holds (islands parked, then folded into the
    largest region). `stats["cap_merges"]` counts merges the cap forced.

    Both passes preserve the same policy the segmenter has always applied:
    always dissolve the SMALLEST offending region first, always into its
    LARGEST neighbour. Only the bookkeeping changed.

    The obvious implementation of that policy is accidentally cubic, and it
    took production down: it rebuilt the whole label-adjacency map and rescanned
    the full label array on every single merge, so a mesh with R crease regions
    paid O(R) merges x O(F + E) rebuild. Measured on a noisy sphere: 5 k faces
    took 7 s, 20 k faces took 328 s, and real forge meshes (100 k+ faces, tens
    of thousands of crease shards) ran for 2.9 to 4 HOURS per job, long past any
    caller's patience, and pushed the 16 GiB instance into repeated OOM kills.

    Instead we keep the regions in a union-find, keep their neighbour sets
    incrementally (small-set-into-large, so the total set work stays near
    linear), and drive both passes off one lazily-invalidated min-heap. The
    label array is rewritten exactly ONCE, at the end. Same output, and the
    20 k-face case drops from 328 s to well under a second.
    """
    labels = np.asarray(labels)
    # Work in a dense 0..K-1 label space so sizes and parents can be arrays.
    uniq, compact = np.unique(labels, return_inverse=True)
    compact = compact.reshape(-1).astype(np.int64)
    k = int(len(uniq))
    if k <= 1:
        return compact

    sizes = np.bincount(compact, minlength=k).astype(np.int64)
    adjacency = _label_adjacency(mesh, compact)
    adj: dict[int, set[int]] = {i: adjacency.get(i, set()) for i in range(k)}

    parent = list(range(k))

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:  # path compression
            parent[x], x = root, parent[x]
        return root

    alive = set(range(k))
    heap: list[tuple[int, int]] = [(int(sizes[i]), i) for i in range(k)]
    heapq.heapify(heap)

    def largest(candidates) -> int:
        """The biggest region among `candidates`, ties broken by lowest label.

        The tie-break is not cosmetic. Picking the winner by iterating a Python
        set makes the choice depend on hash order, so two runs over the same
        mesh could return differently grouped parts. Segmentation is a user
        visible result; it has to be reproducible.
        """
        return max(candidates, key=lambda c: (int(sizes[c]), -c))

    def live_neighbours(root: int) -> set[int]:
        """Neighbour roots of `root`, resolved through the union-find.

        Stale entries are rewritten in place, so each one is only ever
        resolved once and repeated reads stay cheap.
        """
        resolved = {find(n) for n in adj[root]}
        resolved.discard(root)
        adj[root] = resolved
        return resolved

    def merge(src: int, dst: int) -> None:
        """Fold region `src` into `dst`; `dst` survives."""
        parent[src] = dst
        sizes[dst] += sizes[src]
        sizes[src] = 0
        alive.discard(src)
        src_adj = adj.pop(src)
        dst_adj = adj[dst]
        # Union the smaller set into the larger one so the total work across
        # all merges stays near linear rather than quadratic.
        if len(src_adj) > len(dst_adj):
            src_adj, dst_adj = dst_adj, src_adj
        for n in src_adj:
            root = find(n)
            if root != dst:
                dst_adj.add(root)
        dst_adj.discard(dst)
        adj[dst] = dst_adj
        heapq.heappush(heap, (int(sizes[dst]), dst))

    def pop_smallest_live() -> Optional[tuple[int, int]]:
        """Smallest live region as (size, label), skipping stale heap entries.

        Every merge pushes a fresh entry for the survivor, so a live region has
        exactly one current entry: any popped entry that disagrees with the
        live size, or names an absorbed region, is stale and discarded.
        """
        while heap:
            size, label = heapq.heappop(heap)
            if label in alive and size == int(sizes[label]):
                return size, label
        return None

    # Regions with no neighbour left to merge into: parked so the passes below
    # can never spin on them.
    stuck: set[int] = set()

    def park(entry: tuple[int, int]) -> None:
        stuck.add(entry[1])

    # Pass 1: dissolve shards below the face floor, smallest first.
    while len(alive) - len(stuck) > 1:
        _check_deadline(deadline, "small-part merge")
        entry = pop_smallest_live()
        if entry is None:
            break
        size, label = entry
        if label in stuck:
            continue
        if size >= min_part_faces:
            heapq.heappush(heap, entry)  # nothing smaller is left to dissolve
            break
        neighbours = live_neighbours(label)
        if not neighbours:
            if nearest is not None and island_floor is not None and size < island_floor:
                target = nearest(label, alive, sizes, find)
                if target is not None:
                    merge(label, target)
                    continue
            park(entry)
            continue
        merge(label, largest(neighbours))

    # Islands parked above still count against the cap, so give them back to
    # the heap before pass 2 can be asked to fold them.
    for label in stuck:
        heapq.heappush(heap, (int(sizes[label]), label))
    stuck.clear()

    # Pass 2: cap the part count, again smallest into largest neighbour.
    cap_merges = 0
    while len(alive) > max_parts:
        _check_deadline(deadline, "part-count cap")
        entry = pop_smallest_live()
        if entry is None:
            break
        _, label = entry
        neighbours = live_neighbours(label)
        if neighbours:
            merge(label, largest(neighbours))
            cap_merges += 1
            continue
        others = alive - {label}
        if not others:
            break
        # An island with no shared edge: fold it into the region beside it
        # when we can measure that, else the largest region overall, so the
        # cap still converges.
        target = nearest(label, alive, sizes, find) if nearest is not None else None
        merge(label, target if target is not None else largest(others))
        cap_merges += 1
    if stats is not None:
        stats["cap_merges"] = cap_merges

    roots = np.fromiter((find(i) for i in range(k)), dtype=np.int64, count=k)
    return roots[compact]


def _region_name(centroid: np.ndarray, bounds: np.ndarray) -> str:
    """A human-readable spatial label from a part centroid within the bbox.

    Y is up (glTF convention). Vertical band dominates the name (top/lower/…);
    a left/right/front/back qualifier is added when the part sits clearly off
    the central axis.
    """
    span = bounds[1] - bounds[0]
    span[span == 0] = 1.0
    rel = (centroid - bounds[0]) / span  # 0..1 per axis

    y = rel[1]
    if y >= 0.78:
        vert = "top"
    elif y >= 0.58:
        vert = "upper"
    elif y >= 0.42:
        vert = "mid"
    elif y >= 0.22:
        vert = "lower"
    else:
        vert = "bottom"

    quals = []
    x = rel[0]
    if x <= 0.34:
        quals.append("left")
    elif x >= 0.66:
        quals.append("right")
    z = rel[2]
    if z <= 0.30:
        quals.append("back")
    elif z >= 0.70:
        quals.append("front")

    return "-".join([vert, *quals]) if quals else ("core" if vert == "mid" else vert)


def _unique_names(regions: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    counts = {r: regions.count(r) for r in regions}
    for r in regions:
        if counts[r] == 1:
            out.append(r)
        else:
            seen[r] = seen.get(r, 0) + 1
            out.append(f"{r}-{seen[r]}")
    return out


# A single part is an honest answer, not an error: say why in words the user
# can act on.
SINGLE_PART_NOTE = (
    "This model is one continuous surface with no separate pieces and no deep "
    "creases between regions, so there is nothing meaningful to split it into. "
    "Try the Crease method with a finer angle, or keep it as one piece."
)


def _welded(mesh: "trimesh.Trimesh") -> "trimesh.Trimesh":
    """A copy whose vertices are merged by POSITION ONLY, for topology.

    A textured GLB duplicates every vertex on a UV chart border (and every
    vertex with split normals), so in the mesh as loaded two faces on either
    side of a seam share no vertex index and look disconnected. A TRELLIS go-kart
    measured 1 056 "connected components" that way against 5 real shells. Parts
    are found on this welded copy; the face order is unchanged, so its face
    labels index the original textured mesh directly.
    """
    welded = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices).copy(),
        faces=np.asarray(mesh.faces).copy(),
        process=False,
    )
    welded.merge_vertices(merge_tex=True, merge_norm=True)
    return welded


def _nearest_region_fn(welded: "trimesh.Trimesh", compact: np.ndarray, k: int):
    """Build the merge pass's `nearest` callback over face centres.

    Returns the live region closest to `root` (by face-centre distance). Among
    regions that are equally near, the smaller one wins (then the lower label),
    so a capped run pairs neighbours evenly instead of growing one long chain.
    """
    from scipy.spatial import cKDTree

    centers = np.asarray(welded.triangles_center)
    n_faces = len(centers)
    tree = cKDTree(centers)
    order = np.argsort(compact, kind="stable")
    bounds = np.searchsorted(compact[order], np.arange(k + 1))
    faces_of = [order[bounds[i]: bounds[i + 1]] for i in range(k)]
    scale = float(np.linalg.norm(welded.bounds[1] - welded.bounds[0])) or 1.0

    def nearest(root, alive, sizes, find):
        roots = np.fromiter((find(i) for i in range(k)), dtype=np.int64, count=k)
        members = np.nonzero(roots == root)[0]
        face_idx = np.concatenate([faces_of[m] for m in members])
        if len(face_idx) > 512:
            face_idx = face_idx[np.linspace(0, len(face_idx) - 1, 512).astype(np.int64)]
        pts = centers[face_idx]
        kq = 8
        while True:
            kk = min(kq, n_faces)
            dist, idx = tree.query(pts, k=kk)
            dist = np.asarray(dist).reshape(-1)
            idx = np.asarray(idx).reshape(-1)
            owners = roots[compact[idx]]
            mask = owners != root
            if mask.any():
                d = dist[mask]
                o = owners[mask]
                dmin = float(d.min())
                near = np.unique(o[d <= dmin + 1e-6 * scale])
                return int(min(near, key=lambda c: (int(sizes[c]), int(c))))
            if kk >= n_faces:
                return None
            if kq >= 2048:
                # Far from everything: compare region centres instead of
                # widening the neighbour search further.
                here = pts.mean(axis=0)
                best = None
                for other in alive:
                    if other == root:
                        continue
                    sel = np.concatenate([faces_of[m] for m in np.nonzero(roots == other)[0]])
                    dd = float(np.linalg.norm(centers[sel].mean(axis=0) - here))
                    key = (dd, int(sizes[other]), int(other))
                    if best is None or key < best[0]:
                        best = (key, int(other))
                return None if best is None else best[1]
            kq *= 4

    return nearest


def segment(
    mesh: "trimesh.Trimesh",
    *,
    method: str = "auto",
    max_parts: int = 24,
    min_part_faces: int = 64,
    crease_angle_deg: float = 40.0,
    time_budget_s: Optional[float] = None,
) -> SegmentationResult:
    """Split `mesh` into named parts.

    method:
      - "connected": split only at physically disconnected shells.
      - "crease":    minima-rule crease segmentation over the whole mesh.
      - "auto":      connected components, then crease-split any component large
                     enough to plausibly contain multiple parts. Best default.

    Guarantees: the parts partition the input (every face lands in exactly one
    part, none invented), each part keeps the source's texture and material,
    loose fragments are folded into the part beside them, and the count never
    exceeds `max_parts`. `time_budget_s` bounds the whole run; exceeding it
    raises `SegmentTimeout`.
    """
    source_faces = int(len(mesh.faces))
    warnings: list[str] = []
    crease_rad = math.radians(max(5.0, min(170.0, crease_angle_deg)))
    deadline = None if time_budget_s is None else time.monotonic() + time_budget_s

    welded = _welded(mesh)
    _check_deadline(deadline, "welding")

    # Step 1: connected components of the welded surface are always honoured;
    # they are unambiguous parts (wheels, eyes, a loose prop).
    comp = trimesh.graph.connected_component_labels(
        welded.face_adjacency, node_count=source_faces
    ).astype(np.int64)

    if method == "connected":
        labels = comp
    else:
        # Step 2: the minima rule. Crease regions never cross a component
        # boundary (no shared edge), so they refine the component labels.
        crease = _crease_labels(welded, crease_rad).astype(np.int64)
        _check_deadline(deadline, "crease labelling")
        if method == "auto":
            # Small shells are obviously one part already: keep them whole.
            sizes = np.bincount(comp)
            small = sizes[comp] < max(min_part_faces * 2, 200)
            crease = np.where(small, -1 - comp, crease)
        _, labels = np.unique(np.stack([comp, crease], axis=1), axis=0, return_inverse=True)
        labels = labels.reshape(-1).astype(np.int64)

    _, compact = np.unique(labels, return_inverse=True)
    compact = compact.reshape(-1).astype(np.int64)
    k = int(compact.max()) + 1 if len(compact) else 0

    # Step 3: cleanup. Crease shards fold into their largest neighbour; loose
    # fragments (below a floor scaled to the mesh, so a low-poly model keeps its
    # small but real pieces) fold into the region beside them; then the cap.
    island_floor = min(min_part_faces, max(8, int(math.ceil(0.002 * source_faces))))
    stats: dict = {}
    if k > 1:
        compact = _merge_small_and_cap(
            welded,
            compact,
            min_part_faces,
            max_parts,
            deadline=deadline,
            island_floor=island_floor,
            nearest=_nearest_region_fn(welded, compact, k),
            stats=stats,
        )
    if stats.get("cap_merges"):
        warnings.append(
            f"capped to {max_parts} parts; {stats['cap_merges']} smaller pieces were "
            "merged into the part beside them"
        )

    textured = bool(getattr(mesh.visual, "defined", False))
    region_meshes: list["trimesh.Trimesh"] = []
    for lbl in np.unique(compact):
        _check_deadline(deadline, "part extraction")
        face_idx = np.nonzero(compact == lbl)[0]
        # Cut from the ORIGINAL mesh so each part keeps its UVs and material.
        sub = mesh.submesh([face_idx], append=True, repair=False)
        if isinstance(sub, list):
            sub = sub[0] if sub else None
        if sub is not None and len(sub.faces) > 0:
            region_meshes.append(sub)

    if not region_meshes:
        region_meshes = [mesh]

    # Order parts top to bottom, then larger to smaller, so the list reads naturally.
    overall_bounds = mesh.bounds
    region_meshes.sort(key=lambda m: (-(m.centroid[1]), -len(m.faces)))

    regions = [_region_name(m.centroid, overall_bounds) for m in region_meshes]
    names = _unique_names(regions)
    colors = _palette(len(region_meshes))

    parts: list[Part] = []
    for i, (m, name, region, color) in enumerate(zip(region_meshes, names, regions, colors)):
        if not textured:
            # An untextured mesh is tinted so the split is visible; a textured
            # one keeps its look and carries the tint in the manifest only.
            m.visual = trimesh.visual.ColorVisuals(
                mesh=m, face_colors=np.tile([*color, 255], (len(m.faces), 1))
            )
        parts.append(Part(index=i + 1, name=name, mesh=m, color=color, region=region))

    single = len(parts) == 1
    return SegmentationResult(
        parts=parts,
        source_faces=source_faces,
        method=method,
        warnings=warnings,
        single_part=single,
        note=SINGLE_PART_NOTE if single else None,
    )


def build_scene(parts: list[Part]) -> "trimesh.Scene":
    """A scene whose node names are the part ids — so a GLB consumer can address,
    hide, recolour or export each part by name."""
    scene = trimesh.Scene()
    for p in parts:
        node_name = f"part_{p.index:02d}"
        scene.add_geometry(p.mesh, geom_name=node_name, node_name=node_name)
    return scene


def manifest(result: SegmentationResult) -> dict:
    return {
        "method": result.method,
        "source_faces": result.source_faces,
        "part_count": len(result.parts),
        "parts": [p.manifest() for p in result.parts],
        "warnings": result.warnings,
        "single_part": result.single_part,
        "note": result.note,
    }
