"""MoMask sampler adapter.

Thin wrapper around EricGuo5513/momask-codes (MIT) that turns a text prompt
into SMPL-skeleton motion: per-frame local joint rotations (axis-angle, 22
joints) plus a root translation, the exact same contract `mdm_sampler.
MdmSampler.sample()` returns, so `main.py` can dispatch to either backend
through one `_generate_motion()` call. Everything torch/momask-specific is
imported lazily inside `_load()` so this module imports cleanly in
environments without the GPU stack (the worker's pure conversion path +
tests). Loaded once per container by main.py's `_load_model()`.

The momask-codes repo is cloned into the image (see Dockerfile) and put on
PYTHONPATH; checkpoints are mounted from the weights bucket at `model_dir`.

Pipeline (matches upstream's own `gen_t2m.py` exactly): a masked transformer
("M-Transformer") autoregressively predicts base-layer RVQ motion tokens from
the text + a target token length, a residual transformer predicts the
remaining five quantizer layers' tokens conditioned on the first, and the RVQ
decoder turns the full token stack back into HumanML3D's 263-dim motion
feature vector. That feature vector is the same representation MDM's
diffusion sampler produces, so the position→rotation decode below reuses
`motion_decode`'s shared, pure-NumPy IK: see mdm_sampler.py's
`_positions_to_local_quats` docstring for why a joint's local rotation has to
be recovered from its children's measured directions rather than its own
position.

Namespace note: momask-codes and motion-diffusion-model both ship a top-level
`utils` package with unrelated contents. If both repos' directories are on
PYTHONPATH in the same long-lived container (one warm instance serving both
backends over its lifetime), whichever repo imported `utils` first would
poison the other's `from utils.X import Y`. `_load()` guards against this by
purging any cached `utils*` modules and pinning momask's repo to the front of
`sys.path` before importing, the one-time cost of resolving the right
`utils` package, paid again by whichever backend loads second.
"""

from __future__ import annotations

import logging

import numpy as np

from motion_decode import _parents_from_kinematic_chain, _positions_to_local_quats, _quat_to_axis_angle, _resample

log = logging.getLogger("text2motion.momask")

# HumanML3D motion is sampled at 20 fps, same as MDM; we resample to the
# requested fps in the worker via the clip times.
HUMANML_FPS = 20
MAX_MOTION_LEN = 196
UNIT_LENGTH = 4  # RVQ token stride: one token covers 4 motion frames.

# The released HumanML3D checkpoint set (momask-codes' own
# prepare/download_models.sh names these exact directories), fixed by what
# the upstream authors published, not a per-request choice.
VQ_NAME = "rvq_nq6_dc512_nc512_noshare_qdp0.2"
T2M_NAME = "t2m_nlayer8_nhead6_ld384_ff1024_cdp0.1_rvq6ns"
RES_NAME = "tres_nlayer8_ld384_ff1024_rvq6ns_cdp0.2_sw"

# Generation hyperparameters: upstream's own EvalT2MOptions CLI defaults
# (options/eval_option.py), not tuned here.
TIME_STEPS = 18
COND_SCALE = 4
TEMPERATURE = 1.0
TOPK_FILTER_THRES = 0.9
RES_COND_SCALE = 5


class MomaskSampler:
    def __init__(self, model_dir: str, device: str = "cuda"):
        self.model_dir = model_dir
        self.device = device
        self._vq_model = None
        self._t2m_transformer = None
        self._res_model = None
        self._mean = None
        self._std = None
        self._recover_from_ric = None
        self._parents = None
        self._rest_dirs = None
        self._load()

    def _load(self) -> None:
        # Imports are GPU-only (and momask-repo-only), kept here so the
        # module imports without torch or the cloned repo present.
        import os
        import sys

        import torch

        momask_repo = "/opt/momask"
        for name in list(sys.modules):
            if name == "utils" or name.startswith("utils."):
                del sys.modules[name]
        if momask_repo in sys.path:
            sys.path.remove(momask_repo)
        sys.path.insert(0, momask_repo)

        from models.mask_transformer.transformer import MaskTransformer, ResidualTransformer
        from models.vq.model import RVQVAE
        from utils.get_opt import get_opt
        from utils.motion_process import recover_from_ric
        from utils.paramUtil import t2m_kinematic_chain, t2m_raw_offsets

        device = torch.device(self.device)

        vq_opt_path = os.path.join(self.model_dir, "t2m", VQ_NAME, "opt.txt")
        vq_opt = get_opt(vq_opt_path, device=device)
        vq_opt.dim_pose = 263

        vq_model = RVQVAE(
            vq_opt,
            vq_opt.dim_pose,
            vq_opt.nb_code,
            vq_opt.code_dim,
            vq_opt.output_emb_width,
            vq_opt.down_t,
            vq_opt.stride_t,
            vq_opt.width,
            vq_opt.depth,
            vq_opt.dilation_growth_rate,
            vq_opt.vq_act,
            vq_opt.vq_norm,
        )
        vq_ckpt = torch.load(
            os.path.join(vq_opt.checkpoints_dir, vq_opt.dataset_name, vq_opt.name, "model", "net_best_fid.tar"),
            map_location="cpu",
        )
        vq_model.load_state_dict(vq_ckpt["vq_model" if "vq_model" in vq_ckpt else "net"])
        vq_model.to(device)
        vq_model.eval()

        model_opt_path = os.path.join(self.model_dir, "t2m", T2M_NAME, "opt.txt")
        model_opt = get_opt(model_opt_path, device=device)
        model_opt.num_tokens = vq_opt.nb_code
        model_opt.num_quantizers = vq_opt.num_quantizers
        model_opt.code_dim = vq_opt.code_dim

        t2m_transformer = MaskTransformer(
            code_dim=model_opt.code_dim,
            cond_mode="text",
            latent_dim=model_opt.latent_dim,
            ff_size=model_opt.ff_size,
            num_layers=model_opt.n_layers,
            num_heads=model_opt.n_heads,
            dropout=model_opt.dropout,
            clip_dim=512,
            cond_drop_prob=model_opt.cond_drop_prob,
            clip_version="ViT-B/32",
            opt=model_opt,
        )
        t2m_ckpt = torch.load(
            os.path.join(model_opt.checkpoints_dir, model_opt.dataset_name, model_opt.name, "model", "latest.tar"),
            map_location="cpu",
        )
        model_key = "t2m_transformer" if "t2m_transformer" in t2m_ckpt else "trans"
        missing, unexpected = t2m_transformer.load_state_dict(t2m_ckpt[model_key], strict=False)
        assert not unexpected, f"unexpected t2m_transformer keys: {unexpected}"
        assert all(k.startswith("clip_model.") for k in missing), f"unexpected missing keys: {missing}"
        t2m_transformer.to(device)
        t2m_transformer.eval()

        res_opt_path = os.path.join(self.model_dir, "t2m", RES_NAME, "opt.txt")
        res_opt = get_opt(res_opt_path, device=device)
        res_opt.num_quantizers = vq_opt.num_quantizers
        res_opt.num_tokens = vq_opt.nb_code

        res_model = ResidualTransformer(
            code_dim=vq_opt.code_dim,
            cond_mode="text",
            latent_dim=res_opt.latent_dim,
            ff_size=res_opt.ff_size,
            num_layers=res_opt.n_layers,
            num_heads=res_opt.n_heads,
            dropout=res_opt.dropout,
            clip_dim=512,
            shared_codebook=vq_opt.shared_codebook,
            cond_drop_prob=res_opt.cond_drop_prob,
            share_weight=res_opt.share_weight,
            clip_version="ViT-B/32",
            opt=res_opt,
        )
        res_ckpt = torch.load(
            os.path.join(res_opt.checkpoints_dir, res_opt.dataset_name, res_opt.name, "model", "net_best_fid.tar"),
            map_location="cpu",
        )
        missing, unexpected = res_model.load_state_dict(res_ckpt["res_transformer"], strict=False)
        assert not unexpected, f"unexpected res_transformer keys: {unexpected}"
        assert all(k.startswith("clip_model.") for k in missing), f"unexpected missing keys: {missing}"
        res_model.to(device)
        res_model.eval()

        mean = np.load(os.path.join(self.model_dir, "t2m", VQ_NAME, "meta", "mean.npy"))
        std = np.load(os.path.join(self.model_dir, "t2m", VQ_NAME, "meta", "std.npy"))

        self._vq_model = vq_model
        self._t2m_transformer = t2m_transformer
        self._res_model = res_model
        self._mean = mean
        self._std = std
        self._device = device
        self._recover_from_ric = recover_from_ric
        self._parents = _parents_from_kinematic_chain(t2m_kinematic_chain, 22)
        self._rest_dirs = np.asarray(t2m_raw_offsets, dtype=np.float64)
        log.info("MoMask checkpoints loaded from %s", self.model_dir)

    def sample(self, prompt: str, n_frames: int):
        """Text → (poses (T,22,3) axis-angle, trans (T,3)).

        Generates HumanML3D motion tokens for `prompt` at a target length,
        decodes them to the HumanML3D feature vector, recovers joint
        positions via upstream's `recover_from_ric`, then this worker's own
        position→rotation IK (shared with MDM), and resamples to `n_frames`.
        """
        import torch

        if self._vq_model is None:
            raise RuntimeError("MoMask model not loaded")

        token_len = max(1, min(MAX_MOTION_LEN // UNIT_LENGTH, int(round(n_frames / UNIT_LENGTH))))
        token_lens = torch.LongTensor([token_len]).to(self._device)
        captions = [prompt]

        with torch.no_grad():
            mids = self._t2m_transformer.generate(
                captions,
                token_lens,
                timesteps=TIME_STEPS,
                cond_scale=COND_SCALE,
                temperature=TEMPERATURE,
                topk_filter_thres=TOPK_FILTER_THRES,
                gsample=False,
            )
            mids = self._res_model.generate(mids, captions, token_lens, temperature=1, cond_scale=RES_COND_SCALE)
            pred_motions = self._vq_model.forward_decoder(mids)

        data = pred_motions.detach().cpu().numpy()
        data = data * self._std + self._mean  # inv_transform, same as upstream gen_t2m.py
        m_length = int(token_len * UNIT_LENGTH)
        feats = data[0][:m_length]

        positions = self._recover_from_ric(torch.from_numpy(feats).float(), 22)
        positions = positions.cpu().numpy().astype(np.float64)  # (T, 22, 3)

        local_quat = _positions_to_local_quats(positions, self._parents, self._rest_dirs)
        poses = _quat_to_axis_angle(local_quat)  # (T, 22, 3)
        trans = positions[:, 0, :]
        poses = np.asarray(poses, dtype=np.float64)
        trans = np.asarray(trans, dtype=np.float64)
        poses, trans = _resample(poses, trans, n_frames)
        return poses, trans
