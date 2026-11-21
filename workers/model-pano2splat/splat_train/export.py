"""PLY and SPZ writers. numpy only, so they are testable without a GPU."""
import os

import numpy as np


def ply_property_names(sh_degree):
    rest = 3 * ((sh_degree + 1) ** 2 - 1)
    names = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2']
    names += [f'f_rest_{i}' for i in range(rest)]
    names += ['opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
    return names


def write_ply(path, means, scales, quats, opacities, sh0, shN):
    """Write the standard 3DGS PLY (the Inria layout read by /splat, SuperSplat and the
    KIRI Blender add-on): binary little endian, float32 properties in the order
    x y z nx ny nz f_dc_* f_rest_* opacity scale_* rot_*.

    means (N,3); scales (N,3) log-space; quats (N,4) w,x,y,z; opacities (N,) logit;
    sh0 (N,1,3); shN (N,K,3). f_rest is channel-major (all red coefficients, then green,
    then blue), as the reference implementation writes it."""
    n = means.shape[0]
    sh_degree = int(round(np.sqrt(shN.shape[1] + 1))) - 1
    names = ply_property_names(sh_degree)
    data = np.zeros((n, len(names)), dtype='<f4')
    data[:, 0:3] = means
    data[:, 6:9] = sh0.reshape(n, 3)
    rest = np.transpose(shN, (0, 2, 1)).reshape(n, -1)
    data[:, 9:9 + rest.shape[1]] = rest
    o = 9 + rest.shape[1]
    q = quats / np.maximum(np.linalg.norm(quats, axis=1, keepdims=True), 1e-12)
    data[:, o] = opacities
    data[:, o + 1:o + 4] = scales
    data[:, o + 4:o + 8] = q
    header = ['ply', 'format binary_little_endian 1.0', f'element vertex {n}']
    header += [f'property float {p}' for p in names]
    header.append('end_header')
    with open(path, 'wb') as f:
        f.write(('\n'.join(header) + '\n').encode('ascii'))
        data.tofile(f)
    return os.path.getsize(path)


def read_ply_header(path):
    """Return (vertex_count, [property names]) of a binary 3DGS PLY."""
    props = []
    n = 0
    with open(path, 'rb') as f:
        if f.readline().strip() != b'ply':
            raise ValueError('not a PLY file')
        while True:
            line = f.readline().decode('ascii').strip()
            if line.startswith('element vertex'):
                n = int(line.split()[-1])
            elif line.startswith('property'):
                props.append(line.split()[-1])
            elif line == 'end_header':
                break
            elif not line:
                raise ValueError('PLY header ends early')
    return n, props


def read_ply_positions(path):
    n, props = read_ply_header(path)
    with open(path, 'rb') as f:
        while f.readline().strip() != b'end_header':
            pass
        arr = np.fromfile(f, dtype='<f4', count=n * len(props)).reshape(n, len(props))
    return arr[:, :3], arr, props


def write_spz(ply_path, spz_path, antialiased=True):
    """Convert the PLY to SPZ with the official library (Niantic, MIT). The PLY is read as
    the 3DGS convention (RDF) and the file stores the SPZ convention (RUB); the library does
    the conversion, so viewers that read SPZ per spec show the scene right side up."""
    import spz

    unpack = spz.UnpackOptions()
    unpack.to_coord = spz.CoordinateSystem.RUB
    cloud = spz.load_splat_from_ply(ply_path, unpack)
    if len(cloud) == 0:
        raise RuntimeError('the SPZ library could not read the PLY it was given')
    cloud.antialiased = antialiased
    pack = spz.PackOptions()
    pack.from_coord = spz.CoordinateSystem.RUB
    if not spz.save_spz(cloud, pack, spz_path):
        raise RuntimeError('the SPZ library could not write the file')
    return os.path.getsize(spz_path)


def read_spz_positions(spz_path):
    """Load an SPZ back into the 3DGS (RDF) convention, returning positions (N,3)."""
    import spz

    unpack = spz.UnpackOptions()
    unpack.to_coord = spz.CoordinateSystem.RDF
    cloud = spz.load_spz(spz_path, unpack)
    return np.asarray(cloud.positions, dtype=np.float32).reshape(-1, 3)
