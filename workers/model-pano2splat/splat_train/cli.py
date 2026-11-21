"""Command line for the splat_train stage (contract C1).

    python -m splat_train --colmap <dir> --out <dir> [--iterations 30000]
        [--max-gaussians 3000000] [--preview-video] [--holdout-every 8]

Progress goes to stdout as JSON lines {"stage": ..., "progress": 0..1}. On any non-zero exit the
last line of stderr is {"error": "<code>", "message": "<sentence>"}.
"""
import argparse
import json
import os
import sys
import time
import traceback

from . import errors

PRESETS = {
    'preview': {'iterations': 7000, 'max_gaussians': 3_000_000},
    'standard': {'iterations': 30000, 'max_gaussians': 3_000_000},
    'high': {'iterations': 30000, 'max_gaussians': 6_000_000},
}
MIN_PSNR = 18.0


def emit(stage, progress):
    sys.stdout.write(json.dumps({'stage': stage, 'progress': round(max(0.0, min(1.0, progress)), 4)}) + '\n')
    sys.stdout.flush()


def fail(err):
    sys.stderr.write(json.dumps({'error': err.code, 'message': err.message}) + '\n')
    sys.stderr.flush()
    return err.exit_code


class _JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write(json.dumps({'error': 'invalid_arguments', 'message': 'The command line was not understood: ' + message + '.'}) + '\n')
        sys.exit(errors.EXIT_UNSUPPORTED)


def build_parser():
    p = _JsonArgumentParser(prog='python -m splat_train', description='Train a Gaussian splat from a COLMAP dataset.')
    p.add_argument('--colmap', required=True, help='COLMAP dataset directory (images/, optional masks/, sparse/0/)')
    p.add_argument('--out', required=True, help='output directory')
    p.add_argument('--preset', choices=sorted(PRESETS), help='quality preset; explicit flags override it')
    p.add_argument('--iterations', type=int, help='training iterations (default 30000)')
    p.add_argument('--max-gaussians', type=int, help='Gaussian cap (default 3000000)')
    p.add_argument('--preview-video', action='store_true', help='also render preview.mp4 and poster.jpg')
    p.add_argument('--holdout-every', type=int, default=8, help='hold out one image per N for PSNR/SSIM (0 disables)')
    p.add_argument('--max-image-side', type=int, default=1600, help='longest training image side in pixels')
    p.add_argument('--sh-degree', type=int, default=3, choices=[0, 1, 2, 3])
    p.add_argument('--appearance-embedding', action='store_true', help='per-image appearance embedding (off by default)')
    p.add_argument('--scale-reg', type=float, default=0.01)
    p.add_argument('--aniso-reg', type=float, default=0.1)
    p.add_argument('--scene-radius-factor', type=float, default=3.0, help='prune Gaussians beyond this many robust scene radii')
    p.add_argument('--no-gravity-align', action='store_true')
    p.add_argument('--seed', type=int, default=42)
    return p


def resolve(args):
    preset = PRESETS[args.preset or 'standard']
    iterations = args.iterations if args.iterations is not None else preset['iterations']
    cap = args.max_gaussians if args.max_gaussians is not None else preset['max_gaussians']
    if iterations < 100 or cap < 1000:
        raise errors.UnsupportedInput('Training needs at least 100 iterations and a cap of 1000 Gaussians.', 'invalid_arguments')
    return iterations, cap


def run(args):
    t_start = time.time()
    iterations, cap = resolve(args)
    if not os.path.isdir(args.colmap):
        raise errors.CorruptInput('The COLMAP dataset folder does not exist.', 'missing_colmap_model')
    os.makedirs(args.out, exist_ok=True)

    from . import dataset, export, trainer
    emit('load', 0.0)
    ds = dataset.load_dataset(args.colmap, max_side=args.max_image_side, holdout_every=args.holdout_every,
                              align_up=not args.no_gravity_align)
    emit('load', 1.0)

    cfg = trainer.TrainConfig(
        iterations=iterations, max_gaussians=cap, sh_degree=args.sh_degree, scale_reg=args.scale_reg,
        aniso_reg=args.aniso_reg, scene_radius_factor=args.scene_radius_factor,
        appearance_embedding=args.appearance_embedding, seed=args.seed)
    model, stats = trainer.train(ds, cfg, lambda p: emit('train', p))
    emit('eval', 0.0)
    result, fin = trainer.finalize(model, ds, cfg)
    emit('eval', 1.0)

    train_json = {
        'iterations': iterations,
        'gaussians': len(model),
        'psnr_holdout': round(result.psnr, 3),
        'ssim_holdout': round(result.ssim, 4),
        'duration_s': 0.0,
        'bytes_ply': 0,
        'bytes_spz': 0,
        'holdout_images': len(ds.holdout),
        'eval_on_train_views': fin['eval_on_train_views'],
        'psnr_holdout_unpruned': round(fin['psnr_unpruned'], 3),
        'pruned_far': fin['pruned_far'],
        'train_seconds': round(stats['train_seconds'], 1),
        'peak_gpu_gb': round(stats['peak_gpu_gb'], 2),
        'images': ds.info['images'],
        'image_side': ds.info['image_side'],
        'masked_images': ds.info['masked_images'],
        'sparse_points': ds.info['points3d'],
        'appearance_embedding': bool(args.appearance_embedding),
        'transform': ds.transform,
    }

    def write_train_json():
        train_json['duration_s'] = round(time.time() - t_start, 1)
        with open(os.path.join(args.out, 'train.json'), 'w') as f:
            json.dump(train_json, f, indent=2)

    if result.psnr < MIN_PSNR:
        write_train_json()
        raise errors.QualityFailure(
            f'The scene did not reconstruct well enough ({result.psnr:.1f} dB on held-out views, '
            f'minimum {MIN_PSNR:.0f} dB). Re-shoot while moving slowly through the space, keep the camera '
            'steady and the lighting even, and avoid motion blur and large moving objects.')

    emit('export', 0.0)
    arrays = model.to_numpy()
    ply_path = os.path.join(args.out, 'scene.ply')
    spz_path = os.path.join(args.out, 'scene.spz')
    train_json['bytes_ply'] = export.write_ply(ply_path, **arrays)
    train_json['bytes_spz'] = export.write_spz(ply_path, spz_path)
    from PIL import Image
    poster = Image.fromarray(result.best_render)
    poster.thumbnail((1280, 1280))
    poster.save(os.path.join(args.out, 'poster.jpg'), quality=92)
    emit('export', 1.0)

    if args.preview_video:
        from . import preview
        info = preview.render_preview(model, ds, os.path.join(args.out, 'preview.mp4'), lambda p: emit('preview', p))
        train_json['preview'] = info
        emit('preview', 1.0)
    write_train_json()
    return 0


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except errors.SplatTrainError as e:
        return fail(e)
    except MemoryError:
        return fail(errors.SplatTrainError('The machine ran out of memory training this scene. Try a shorter capture.', 'out_of_memory'))
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return fail(errors.SplatTrainError('Training failed unexpectedly. Please try again, and contact support if it keeps happening.', 'internal_error'))
