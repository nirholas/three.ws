FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

# devel base: MDM's dependency stack (and optional CUDA ops) build cleanly with
# nvcc present. TORCH_CUDA_ARCH_LIST targets the Cloud Run L4 (cc 8.9).
# PYTHONPATH only covers MDM: mdm_sampler.py relies on it being set at import
# time. momask_sampler.py manages its own sys.path at runtime instead (see its
# module docstring) specifically so momask-codes' repo dir is never a static,
# always-first PYTHONPATH entry: both repos ship an unrelated top-level
# `utils` package, and whichever was first on a static path would permanently
# shadow the other's in a long-lived container serving both backends.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    TORCH_CUDA_ARCH_LIST="8.9+PTX" \
    PYTHONPATH=/opt/mdm

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3.10-dev python3-pip \
        git curl wget build-essential ninja-build unzip \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && pip install --upgrade pip setuptools wheel

# torch first (cached layer), matching the CUDA 12.1 base.
RUN pip install torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121

# MDM (Motion Diffusion Model, MIT) is not a pip package — clone it and put it
# on PYTHONPATH (mdm_sampler.py imports from it). The repo ships an
# `environment.yml` (conda, Python 3.7 / torch 1.7 / cuda 11.0), not a
# `requirements.txt` — pinning that stack would conflict with the torch 2.3.1
# /cu121 install above, so this installs the actual pip-importable surface
# `mdm_sampler.py` touches (create_model_and_diffusion → model.mdm → CLIP +
# model.rotation2xyz → model.smpl → smplx; diffusion.*; data_loaders.humanml.*
# → scipy/tqdm). spacy is NOT installed: it's part of MDM's HumanML3D dataset
# *training* pipeline (text tokenization for building the dataset cache), which
# this inference-only worker never imports — confirmed by walking every
# module-level import reachable from `create_model_and_diffusion`.
RUN git clone --depth 1 https://github.com/GuyTevet/motion-diffusion-model.git /opt/mdm \
    && pip install scipy tqdm smplx \
    && pip install git+https://github.com/openai/CLIP.git

# MoMask (EricGuo5513/momask-codes, MIT) is the stronger baseline (published
# FID 0.045 on HumanML3D vs. MDM-era T2M-GPT's 0.141): a residual-VQ tokenizer
# plus a masked + residual transformer, selected per request via
# `model: "momask"` (see momask_sampler.py). Not put on a static PYTHONPATH
# (see the ENV block above): momask_sampler.py inserts /opt/momask itself at
# load time. Every transitive import momask_sampler.py's `_load()` reaches
# (models.vq.model, models.vq.residual_vq, models.vq.quantizer,
# models.mask_transformer.transformer/tools, utils.get_opt,
# utils.motion_process, utils.paramUtil, common.skeleton, common.quaternion,
# utils.word_vectorizer) was walked against momask-codes' own source; the only
# dependency beyond what MDM's layer above already installs (torch, CLIP,
# scipy) is einops. momask's own requirements.txt additionally lists chumpy,
# matplotlib, scikit-learn, trimesh, gdown, vector-quantize-pytorch: those
# back its training/visualization/eval scripts and its OWN (unused, commented-
# out) VectorQuantize import, none are reachable from the inference path
# this worker calls.
RUN git clone --depth 1 https://github.com/EricGuo5513/momask-codes.git /opt/momask \
    && pip install einops

# MDM auxiliary data (glove, evaluators) and the trained checkpoint are mounted
# at runtime from the weights bucket (MOTION_MODEL_DIR=/weights/mdm). The real
# SMPL body model (`body_models/smpl/SMPL_NEUTRAL.pkl`) is NOT staged: it is
# gated behind SMPL's own registration/license (smpl.is.tue.mpg.de) and this
# worker never needs it — `model.mdm.MDM` eagerly constructs a
# `Rotation2xyz`/`SMPL` submodule that loads it, but that submodule's OUTPUT
# (SMPL vertex/joint xyz) is never consumed here: motion comes back from the
# diffusion sampler as HumanML3D feature vectors, decoded via `recover_from_ric`
# + this worker's own direction-alignment IK (see mdm_sampler.py's
# `_positions_to_local_quats`). `mdm_sampler.py` monkeypatches
# `model.mdm.Rotation2xyz` to a real (but license-file-free) `nn.Module` stand-in
# before constructing the model, purely so `.to(device)`/`.eval()` — which walk
# into `self.rot2xyz.smpl_model` — have a real module to call, never a mock of
# actual generation output.

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

WORKDIR /app
COPY worker_security.py /app/worker_security.py
COPY smpl_to_clip.py /app/smpl_to_clip.py
COPY motion_decode.py /app/motion_decode.py
COPY mdm_sampler.py /app/mdm_sampler.py
COPY momask_sampler.py /app/momask_sampler.py
COPY main.py /app/main.py

EXPOSE 8080

CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "300"]
