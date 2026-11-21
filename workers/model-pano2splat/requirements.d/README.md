One `<package>.txt` per stage package (`pano_sfm.txt`, `splat_train.txt`, `pano_stitch.txt`).
The Dockerfile installs every `*.txt` here after `requirements.txt`, in the CUDA build stage,
so CUDA extensions such as gsplat are compiled once and copied into the runtime image.
