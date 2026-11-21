"""Gaussian splat training on gsplat (Apache-2.0) with the MCMC densification strategy.

Follows gsplat's reference trainer (examples/simple_trainer.py, v1.5.3, Apache-2.0) and its
MCMC benchmark settings, with: a Gaussian cap, anti-aliased rasterisation, masked losses,
scale and anisotropy regularisation against needle artefacts, optional per-image appearance
embeddings, holdout PSNR/SSIM, and far-Gaussian pruning (sky and floaters) at the end.
"""
import math
import random
import time
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from . import scene
from .errors import GpuUnavailable

SH_C0 = 0.28209479177387814


@dataclass
class TrainConfig:
    iterations: int = 30000
    max_gaussians: int = 3_000_000
    sh_degree: int = 3
    sh_degree_interval: int = 1000
    ssim_lambda: float = 0.2
    opacity_reg: float = 0.01
    scale_reg: float = 0.01
    aniso_reg: float = 0.1
    aniso_max_ratio: float = 10.0
    scene_radius_factor: float = 3.0
    appearance_embedding: bool = False
    seed: int = 42
    init_opacity: float = 0.5
    init_scale: float = 0.1
    near_plane: float = 0.01
    far_plane: float = 1e10
    means_lr: float = 1.6e-4
    scales_lr: float = 5e-3
    opacities_lr: float = 5e-2
    quats_lr: float = 1e-3
    sh0_lr: float = 2.5e-3
    shN_lr: float = 2.5e-3 / 20


@dataclass
class EvalResult:
    psnr: float
    ssim: float
    per_image_psnr: list
    names: list
    best_index: int
    best_render: np.ndarray


class AppearanceModule:
    """Per-image appearance embedding (gsplat examples/utils.py AppearanceOptModule, Apache-2.0)."""

    def __new__(cls, n, feature_dim, embed_dim=16, sh_degree=3, mlp_width=64, mlp_depth=2):
        import torch
        import torch.nn.functional as F
        from gsplat.cuda._torch_impl import _eval_sh_bases_fast

        class _Module(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.embed_dim = embed_dim
                self.sh_degree = sh_degree
                self.embeds = torch.nn.Embedding(n, embed_dim)
                layers = [torch.nn.Linear(embed_dim + feature_dim + (sh_degree + 1) ** 2, mlp_width), torch.nn.ReLU(inplace=True)]
                for _ in range(mlp_depth - 1):
                    layers += [torch.nn.Linear(mlp_width, mlp_width), torch.nn.ReLU(inplace=True)]
                layers.append(torch.nn.Linear(mlp_width, 3))
                self.color_head = torch.nn.Sequential(*layers)

            def forward(self, features, embed_ids, dirs, sh_degree):
                C, N = dirs.shape[:2]
                if embed_ids is None:
                    embeds = torch.zeros(C, self.embed_dim, device=features.device)
                else:
                    embeds = self.embeds(embed_ids)
                embeds = embeds[:, None, :].expand(-1, N, -1)
                features = features[None, :, :].expand(C, -1, -1)
                dirs = F.normalize(dirs, dim=-1)
                used = (sh_degree + 1) ** 2
                bases = torch.zeros(C, N, (self.sh_degree + 1) ** 2, device=features.device)
                bases[:, :, :used] = _eval_sh_bases_fast(used, dirs)
                return self.color_head(torch.cat([embeds, features, bases], dim=-1))

        return _Module()


def _knn_scales(points, k=3):
    tree = cKDTree(points)
    d, _ = tree.query(points, k=k + 1)
    return d[:, 1:].mean(axis=1)


def init_points(ds, cfg, rng):
    """Initial Gaussian centres and colours from the sparse points, capped at max_gaussians;
    falls back to a random cloud inside the camera bounds when the model has no usable points."""
    pts, cols = ds.points, ds.colors.astype(np.float32) / 255.0
    if len(pts) < 100:
        centres = np.stack([f.c2w[:3, 3] for f in ds.frames])
        lo, hi = centres.min(0) - 1.0, centres.max(0) + 1.0
        n = min(100_000, cfg.max_gaussians)
        pts = rng.uniform(lo, hi, size=(n, 3))
        cols = rng.uniform(0.0, 1.0, size=(n, 3)).astype(np.float32)
    if len(pts) > cfg.max_gaussians:
        keep = rng.choice(len(pts), cfg.max_gaussians, replace=False)
        pts, cols = pts[keep], cols[keep]
    return pts.astype(np.float32), cols.astype(np.float32)


def build_strategy(cfg):
    from gsplat.strategy import MCMCStrategy
    f = cfg.iterations / 30000.0
    return MCMCStrategy(
        cap_max=cfg.max_gaussians,
        refine_start_iter=max(1, int(500 * f)),
        refine_stop_iter=max(2, int(25000 * f)),
        refine_every=max(1, int(100 * f)),
        verbose=False)


class SplatModel:
    """Trained Gaussians on the GPU, with the renderer used for evaluation and the preview."""

    def __init__(self, splats, cfg, app=None):
        self.splats = splats
        self.cfg = cfg
        self.app = app

    def __len__(self):
        return int(self.splats['means'].shape[0])

    def colors(self, c2w, sh_degree, embed_id=None):
        import torch
        if self.app is not None:
            dirs = self.splats['means'][None, :, :] - c2w[:, None, :3, 3]
            ids = None if embed_id is None else embed_id
            col = self.app(self.splats['features'], ids, dirs, sh_degree) + self.splats['colors']
            return torch.sigmoid(col), None
        return torch.cat([self.splats['sh0'], self.splats['shN']], 1), sh_degree

    def render(self, c2w, K, width, height, sh_degree=None, embed_id=None, grad=False, packed=False):
        import torch
        from gsplat.rendering import rasterization
        sh = self.cfg.sh_degree if sh_degree is None else sh_degree
        s = self.splats
        colors, sh_arg = self.colors(c2w, sh, embed_id)
        out, alpha, info = rasterization(
            means=s['means'], quats=s['quats'], scales=torch.exp(s['scales']),
            opacities=torch.sigmoid(s['opacities']), colors=colors,
            viewmats=torch.linalg.inv(c2w), Ks=K, width=width, height=height,
            sh_degree=sh_arg, near_plane=self.cfg.near_plane, far_plane=self.cfg.far_plane,
            rasterize_mode='antialiased', packed=packed, absgrad=False)
        return out, alpha, info

    def prune_outside(self, centre, radius):
        import torch
        keep = (torch.linalg.norm(self.splats['means'] - torch.as_tensor(centre, device=self.splats['means'].device, dtype=torch.float32), dim=1) <= radius)
        removed = int((~keep).sum().item())
        for k in list(self.splats.keys()):
            self.splats[k] = torch.nn.Parameter(self.splats[k].detach()[keep].contiguous(), requires_grad=False)
        return removed

    def to_numpy(self):
        s = self.splats
        if self.app is not None:
            import torch
            with torch.no_grad():
                dirs = torch.zeros_like(s['means'])[None]
                rgb = torch.sigmoid(self.app(s['features'], None, dirs, 0) + s['colors']).squeeze(0)
            sh0 = ((rgb - 0.5) / SH_C0)[:, None, :]
            shN = torch.zeros((rgb.shape[0], (self.cfg.sh_degree + 1) ** 2 - 1, 3), device=rgb.device)
        else:
            sh0, shN = s['sh0'], s['shN']
        f = lambda t: t.detach().float().cpu().numpy()  # noqa: E731
        return dict(means=f(s['means']), scales=f(s['scales']), quats=f(s['quats']),
                    opacities=f(s['opacities']), sh0=f(sh0), shN=f(shN))


def _psnr(pred, gt, mask):
    import torch
    if mask is None:
        mse = torch.mean((pred - gt) ** 2)
    else:
        m = mask[..., None].float()
        mse = (((pred - gt) * m) ** 2).sum() / (m.sum() * 3 + 1e-8)
    return float(-10.0 * torch.log10(mse.clamp_min(1e-10)))


def _ssim(pred, gt, mask):
    from torchmetrics.functional.image import structural_similarity_index_measure as ssim
    if mask is not None:
        m = mask[..., None].float()
        pred, gt = pred * m, gt * m
    return ssim(pred.permute(0, 3, 1, 2), gt.permute(0, 3, 1, 2), data_range=1.0)


def evaluate(model, ds, indices, device):
    """PSNR and SSIM (masked pixels excluded) over the given frames."""
    import torch
    psnrs, ssims, names = [], [], []
    best, best_render = -1, None
    with torch.no_grad():
        for i in indices:
            fr = ds.frames[i]
            c2w = torch.as_tensor(fr.c2w, dtype=torch.float32, device=device)[None]
            K = torch.as_tensor(fr.K, dtype=torch.float32, device=device)[None]
            out, _, _ = model.render(c2w, K, fr.width, fr.height, embed_id=None)
            pred = out.clamp(0, 1)
            gt = torch.from_numpy(fr.image).to(device).float()[None] / 255.0
            mask = torch.from_numpy(fr.mask).to(device)[None] if fr.mask is not None else None
            p = _psnr(pred, gt, mask)
            psnrs.append(p)
            ssims.append(float(_ssim(pred, gt, mask)))
            names.append(fr.name)
            if best < 0 or p > psnrs[best]:
                best = len(psnrs) - 1
                best_render = (pred[0].cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
    return EvalResult(float(np.mean(psnrs)), float(np.mean(ssims)), psnrs, names, best, best_render)


def train(ds, cfg, report):
    """Train and return (SplatModel, stats dict). `report(progress)` receives 0..1."""
    import torch
    import torch.nn.functional as F

    if not torch.cuda.is_available():
        raise GpuUnavailable('A GPU is required to train a splat and none is available on this machine.')
    device = 'cuda'
    random.seed(cfg.seed)
    np.random.seed(cfg.seed)
    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)

    pts, cols = init_points(ds, cfg, rng)
    dist = np.maximum(_knn_scales(pts), 1e-7)
    centres = np.stack([f.c2w[:3, 3] for f in ds.frames])
    scene_scale = 1.1 * float(np.linalg.norm(centres - centres.mean(0), axis=1).max())

    n = len(pts)
    pts_t = torch.from_numpy(pts)
    rgb_t = torch.from_numpy(cols)
    params = [
        ('means', pts_t, cfg.means_lr * scene_scale),
        ('scales', torch.log(torch.from_numpy(dist * cfg.init_scale)).float()[:, None].repeat(1, 3), cfg.scales_lr),
        ('quats', torch.rand(n, 4), cfg.quats_lr),
        ('opacities', torch.logit(torch.full((n,), cfg.init_opacity)), cfg.opacities_lr),
    ]
    feature_dim = 32 if cfg.appearance_embedding else None
    if feature_dim is None:
        sh = torch.zeros((n, (cfg.sh_degree + 1) ** 2, 3))
        sh[:, 0, :] = (rgb_t - 0.5) / SH_C0
        params += [('sh0', sh[:, :1, :], cfg.sh0_lr), ('shN', sh[:, 1:, :], cfg.shN_lr)]
    else:
        params += [('features', torch.rand(n, feature_dim), cfg.sh0_lr), ('colors', torch.logit(rgb_t.clamp(1e-3, 1 - 1e-3)), cfg.sh0_lr)]
    splats = torch.nn.ParameterDict({k: torch.nn.Parameter(v) for k, v, _ in params}).to(device)
    optimizers = {k: torch.optim.Adam([{'params': splats[k], 'lr': lr, 'name': k}], eps=1e-15, betas=(0.9, 0.999))
                  for k, _, lr in params}

    app = None
    app_opts = []
    if cfg.appearance_embedding:
        app = AppearanceModule(len(ds.frames), feature_dim, 16, cfg.sh_degree).to(device)
        torch.nn.init.zeros_(app.color_head[-1].weight)
        torch.nn.init.zeros_(app.color_head[-1].bias)
        app_opts = [torch.optim.Adam(app.embeds.parameters(), lr=1e-3 * 10.0, weight_decay=1e-6),
                    torch.optim.Adam(app.color_head.parameters(), lr=1e-3)]

    model = SplatModel(splats, cfg, app)
    strategy = build_strategy(cfg)
    strategy.check_sanity(splats, optimizers)
    state = strategy.initialize_state()
    scheduler = torch.optim.lr_scheduler.ExponentialLR(optimizers['means'], gamma=0.01 ** (1.0 / cfg.iterations))
    packed = cfg.max_gaussians > 2_000_000

    order = list(ds.train)
    cursor = len(order)
    t0 = time.time()
    last_report = -1
    for step in range(cfg.iterations):
        if cursor >= len(order):
            rng.shuffle(order)
            cursor = 0
        fi = order[cursor]
        cursor += 1
        fr = ds.frames[fi]
        c2w = torch.as_tensor(fr.c2w, dtype=torch.float32, device=device)[None]
        K = torch.as_tensor(fr.K, dtype=torch.float32, device=device)[None]
        gt = torch.from_numpy(fr.image).to(device, non_blocking=True).float()[None] / 255.0
        mask = torch.from_numpy(fr.mask).to(device)[None] if fr.mask is not None else None
        sh_deg = min(step // cfg.sh_degree_interval, cfg.sh_degree)

        out, _alpha, info = model.render(c2w, K, fr.width, fr.height, sh_degree=sh_deg,
                                         embed_id=torch.tensor([fi], device=device) if app is not None else None,
                                         packed=packed)
        strategy.step_pre_backward(params=splats, optimizers=optimizers, state=state, step=step, info=info)
        pred = out
        if mask is not None:
            m = mask[..., None].float()
            l1 = (torch.abs(pred - gt) * m).sum() / (m.sum() * 3 + 1e-8)
        else:
            l1 = F.l1_loss(pred, gt)
        ssim_loss = 1.0 - _ssim(pred, gt, mask)
        loss = l1 * (1.0 - cfg.ssim_lambda) + ssim_loss * cfg.ssim_lambda
        loss = loss + cfg.opacity_reg * torch.sigmoid(splats['opacities']).mean()
        sc = torch.exp(splats['scales'])
        loss = loss + cfg.scale_reg * sc.mean()
        if cfg.aniso_reg > 0:
            ratio = sc.max(dim=-1).values / sc.min(dim=-1).values.clamp_min(1e-10)
            loss = loss + cfg.aniso_reg * torch.relu(ratio - cfg.aniso_max_ratio).mean()
        loss.backward()
        if not torch.isfinite(loss):
            raise RuntimeError('training diverged (non-finite loss)')

        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)
        for opt in app_opts:
            opt.step()
            opt.zero_grad(set_to_none=True)
        scheduler.step()
        strategy.step_post_backward(params=splats, optimizers=optimizers, state=state, step=step, info=info,
                                    lr=scheduler.get_last_lr()[0])
        pct = (step + 1) * 100 // cfg.iterations
        if pct != last_report and pct % 2 == 0:
            last_report = pct
            report((step + 1) / cfg.iterations)

    torch.cuda.synchronize()
    stats = {'train_seconds': time.time() - t0, 'scene_scale': scene_scale,
             'peak_gpu_gb': torch.cuda.max_memory_allocated() / 1024 ** 3}
    for p in splats.values():
        p.requires_grad_(False)
    return model, stats


def finalize(model, ds, cfg):
    """Evaluate, prune far Gaussians, evaluate again. Returns (final EvalResult, stats)."""
    import torch
    device = 'cuda'
    eval_idx = ds.holdout
    on_train = False
    if not eval_idx:
        k = min(8, len(ds.train))
        eval_idx = [ds.train[int(i)] for i in np.linspace(0, len(ds.train) - 1, k)]
        on_train = True
    before = evaluate(model, ds, eval_idx, device)
    centres = np.stack([f.c2w[:3, 3] for f in ds.frames])
    c, r = scene.scene_radius(ds.points, centres, cfg.scene_radius_factor)
    removed = model.prune_outside(c, r)
    after = evaluate(model, ds, eval_idx, device) if removed else before
    return after, {'psnr_unpruned': before.psnr, 'pruned_far': removed, 'scene_radius': r,
                   'eval_on_train_views': on_train, 'eval_images': len(eval_idx)}
