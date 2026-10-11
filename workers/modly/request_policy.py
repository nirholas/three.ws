"""Pure request policy for the Modly worker: no GPU, no network, no Modly import.

Everything the front decides about a request before it reaches Modly lives here,
so the build-time gate can prove it without a GPU:

  * which Modly model a request runs (`resolve_model`), from a short alias or a
    full `<extension>/<node>` id, restricted to the models this deployment ships;
  * the generation params Modly receives (`build_generation_params`): tier
    presets, caller overrides clamped to each extension's own params_schema,
    unknown keys dropped, and a concrete seed always chosen so the task record
    can report the exact seed that produced the mesh;
  * the post-process plan (`parse_postprocess`): repair, decimate, smooth, UV
    unwrap and texture bake, validated and returned in the one order they run;
  * how a Modly job status maps to a three.ws task status (`interpret_job`);
  * where a Modly output path may point (`workspace_relative`);
  * transient-fetch retry, shared verbatim with the other image-to-3D workers.
"""

from __future__ import annotations

import math
import random
from typing import Any, Callable, Optional

import httpx

# ── Models ────────────────────────────────────────────────────────────────────
# The extension manifests pinned in the Dockerfile define these params_schema
# bounds; the copies below are what the front clamps to before Modly sees them.
# A Modly id is `<extension id>/<node id>`.
TRIPOSG = "triposg/generate"
HUNYUAN_MINI_TURBO = "hunyuan3d-mini-turbo/generate"

MODEL_ALIASES = {
    "triposg": TRIPOSG,
    "tripo": TRIPOSG,
    "hunyuan3d-mini-turbo": HUNYUAN_MINI_TURBO,
    "hunyuan-mini-turbo": HUNYUAN_MINI_TURBO,
    "hunyuan": HUNYUAN_MINI_TURBO,
}

# Each entry: param id -> spec. `int`/`float` carry inclusive bounds, `choice`
# carries the allowed values. `seed` is handled separately (always concrete).
PARAM_SCHEMAS: dict[str, dict[str, dict[str, Any]]] = {
    TRIPOSG: {
        "num_inference_steps": {"type": "int", "min": 8, "max": 50, "default": 50},
        "guidance_scale": {"type": "float", "min": 0.0, "max": 20.0, "default": 7.0},
        "foreground_ratio": {"type": "float", "min": 0.5, "max": 1.0, "default": 0.85},
        "faces": {"type": "int", "min": -1, "max": 500_000, "default": -1},
        "use_flash_decoder": {
            "type": "choice",
            "options": ("DiffDMC", "Marching Cubes"),
            "default": "DiffDMC",
        },
    },
    HUNYUAN_MINI_TURBO: {
        "num_inference_steps": {"type": "choice", "options": (5, 10, 20), "default": 10},
        "octree_resolution": {"type": "choice", "options": (256, 380, 512), "default": 380},
        "guidance_scale": {"type": "float", "min": 1.0, "max": 10.0, "default": 5.5},
    },
}

# Tiers mirror the other image-to-3D lanes (draft | standard | high | max). Each
# maps to the extension's own quality knobs; caller params still override.
TIER_PRESETS: dict[str, dict[str, dict[str, Any]]] = {
    TRIPOSG: {
        "draft": {"num_inference_steps": 20},
        "standard": {"num_inference_steps": 30},
        "high": {"num_inference_steps": 50},
        "max": {"num_inference_steps": 50},
    },
    HUNYUAN_MINI_TURBO: {
        "draft": {"num_inference_steps": 5, "octree_resolution": 256},
        "standard": {"num_inference_steps": 10, "octree_resolution": 380},
        "high": {"num_inference_steps": 20, "octree_resolution": 512},
        "max": {"num_inference_steps": 20, "octree_resolution": 512},
    },
}
TIERS = ("draft", "standard", "high", "max")
TIER_ALIASES = {"fast": "draft", "balanced": "standard", "quality": "high", "ultra": "max"}

SEED_MAX = 2**32 - 1


class PolicyError(ValueError):
    """A request field is invalid. The message is safe to return to the caller."""


def parse_model_list(raw: str) -> list[str]:
    """MODLY_MODELS env value -> ordered, de-duplicated list of known model ids."""
    out: list[str] = []
    for part in (raw or "").split(","):
        name = part.strip()
        if not name:
            continue
        model = MODEL_ALIASES.get(name.lower(), name)
        if model not in PARAM_SCHEMAS:
            raise PolicyError(f"MODLY_MODELS names an unsupported model: {name}")
        if model not in out:
            out.append(model)
    if not out:
        raise PolicyError("MODLY_MODELS is empty")
    return out


def resolve_model(requested: Optional[str], enabled: list[str], default: str) -> str:
    """Map a caller's `model` field to an enabled Modly model id."""
    if requested is None or not str(requested).strip():
        return default
    name = str(requested).strip()
    model = MODEL_ALIASES.get(name.lower(), name)
    if model not in enabled:
        allowed = ", ".join(sorted({a for a, m in MODEL_ALIASES.items() if m in enabled} | set(enabled)))
        raise PolicyError(f"model '{name}' is not served by this worker (choose one of: {allowed})")
    return model


def normalize_tier(tier: Optional[str]) -> Optional[str]:
    if tier is None:
        return None
    key = str(tier).strip().lower()
    key = TIER_ALIASES.get(key, key)
    return key if key in TIERS else None


def _clamp_param(spec: dict[str, Any], value: Any, name: str) -> Any:
    kind = spec["type"]
    if kind == "choice":
        options = spec["options"]
        if value in options:
            return value
        # Numeric choices accept the nearest option (a caller asking for 12 steps
        # on a 5/10/20 model gets 10, not an error).
        if all(isinstance(o, (int, float)) for o in options):
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise PolicyError(f"params.{name} must be one of {list(options)}") from exc
            if not math.isfinite(number):
                raise PolicyError(f"params.{name} must be one of {list(options)}")
            return min(options, key=lambda o: (abs(o - number), o))
        raise PolicyError(f"params.{name} must be one of {list(options)}")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise PolicyError(f"params.{name} must be a number") from exc
    if not math.isfinite(number):
        raise PolicyError(f"params.{name} must be a finite number")
    number = max(spec["min"], min(spec["max"], number))
    return int(round(number)) if kind == "int" else float(number)


def resolve_seed(seed: Any, rng: Optional[random.Random] = None) -> int:
    """A concrete seed in [0, 2^32-1]. None or -1 draws one, so it can be recorded."""
    if seed is None:
        return (rng or random).randint(0, SEED_MAX)
    try:
        value = int(seed)
    except (TypeError, ValueError) as exc:
        raise PolicyError("seed must be an integer") from exc
    if value == -1:
        return (rng or random).randint(0, SEED_MAX)
    if value < 0 or value > SEED_MAX:
        raise PolicyError(f"seed must be between 0 and {SEED_MAX}")
    return value


def build_generation_params(
    model: str,
    tier: Optional[str],
    params: Optional[dict],
    seed: Any,
    rng: Optional[random.Random] = None,
) -> tuple[dict, list[str]]:
    """Params Modly receives for one job, plus the caller keys that were dropped.

    Order: schema defaults, then the tier preset, then caller params (clamped).
    Unknown keys are dropped rather than forwarded: an extension reads its own
    params dict directly, so forwarding an unvalidated key is forwarding
    unvalidated input into a GPU job.
    """
    schema = PARAM_SCHEMAS[model]
    out = {name: spec["default"] for name, spec in schema.items()}
    preset_tier = normalize_tier(tier)
    if preset_tier:
        out.update(TIER_PRESETS[model][preset_tier])
    dropped: list[str] = []
    for name, value in (params or {}).items():
        if name == "seed":
            if seed is None:
                seed = value
            continue
        spec = schema.get(name)
        if spec is None:
            dropped.append(str(name))
            continue
        out[name] = _clamp_param(spec, value, name)
    out["seed"] = resolve_seed(seed, rng)
    return out, sorted(dropped)


# ── Post-process plan ─────────────────────────────────────────────────────────
POSTPROCESS_ORDER = ("repair", "decimate", "smooth", "uv_unwrap", "bake")
REPAIR_FLAGS = ("remove_duplicates", "remove_degenerate", "fix_non_manifold", "fill_holes")
MAX_HOLE_SIZE_MIN, MAX_HOLE_SIZE_MAX = 10, 10_000
DECIMATE_MIN, DECIMATE_MAX = 100, 1_000_000
SMOOTH_ITER_MIN, SMOOTH_ITER_MAX = 1, 50
SMOOTH_LAMBDA_MIN, SMOOTH_LAMBDA_MAX = 0.1, 1.0
SMOOTH_MODES = ("taubin", "laplacian")
BAKE_SIZES = (256, 512, 1024, 2048, 4096)
DEFAULT_BAKE_SIZE = 1024


def _as_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    raise PolicyError(f"{field} must be true or false")


def _bounded_int(value: Any, field: str, low: int, high: int) -> int:
    if isinstance(value, bool):
        raise PolicyError(f"{field} must be an integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise PolicyError(f"{field} must be an integer") from exc
    if number != value and not (isinstance(value, float) and value.is_integer()):
        raise PolicyError(f"{field} must be an integer")
    if number < low or number > high:
        raise PolicyError(f"{field} must be between {low} and {high}")
    return number


def _parse_repair(value: Any) -> Optional[dict]:
    if value is None or value is False:
        return None
    if value is True:
        return {}
    if not isinstance(value, dict):
        raise PolicyError("postprocess.repair must be true, false or an object")
    out: dict[str, Any] = {}
    for key, raw in value.items():
        if key in REPAIR_FLAGS:
            out[key] = _as_bool(raw, f"postprocess.repair.{key}")
        elif key == "max_hole_size":
            out[key] = _bounded_int(raw, "postprocess.repair.max_hole_size", MAX_HOLE_SIZE_MIN, MAX_HOLE_SIZE_MAX)
        else:
            raise PolicyError(f"postprocess.repair.{key} is not a repair option")
    return out


def _parse_decimate(value: Any) -> Optional[dict]:
    if value is None or value is False:
        return None
    if isinstance(value, dict):
        unknown = set(value) - {"target_faces"}
        if unknown:
            raise PolicyError(f"postprocess.decimate.{sorted(unknown)[0]} is not a decimate option")
        target = value.get("target_faces")
    else:
        target = value
    if target is None:
        raise PolicyError("postprocess.decimate needs target_faces")
    return {"target_faces": _bounded_int(target, "postprocess.decimate.target_faces", DECIMATE_MIN, DECIMATE_MAX)}


def _parse_smooth(value: Any) -> Optional[dict]:
    if value is None or value is False:
        return None
    if value is True:
        return {}
    if not isinstance(value, dict):
        raise PolicyError("postprocess.smooth must be true, false or an object")
    out: dict[str, Any] = {}
    for key, raw in value.items():
        if key == "iterations":
            out[key] = _bounded_int(raw, "postprocess.smooth.iterations", SMOOTH_ITER_MIN, SMOOTH_ITER_MAX)
        elif key in ("lambda_", "lambda", "strength"):
            try:
                number = float(raw)
            except (TypeError, ValueError) as exc:
                raise PolicyError("postprocess.smooth.lambda_ must be a number") from exc
            if not math.isfinite(number) or number < SMOOTH_LAMBDA_MIN or number > SMOOTH_LAMBDA_MAX:
                raise PolicyError(
                    f"postprocess.smooth.lambda_ must be between {SMOOTH_LAMBDA_MIN} and {SMOOTH_LAMBDA_MAX}"
                )
            out["lambda_"] = number
        elif key == "mode":
            if raw not in SMOOTH_MODES:
                raise PolicyError(f"postprocess.smooth.mode must be one of {list(SMOOTH_MODES)}")
            out[key] = raw
        else:
            raise PolicyError(f"postprocess.smooth.{key} is not a smooth option")
    return out


def _parse_bake(value: Any) -> Optional[dict]:
    if value is None or value is False:
        return None
    if value is True:
        return {"texture_size": DEFAULT_BAKE_SIZE}
    if not isinstance(value, dict):
        raise PolicyError("postprocess.bake must be true, false or an object")
    unknown = set(value) - {"texture_size"}
    if unknown:
        raise PolicyError(f"postprocess.bake.{sorted(unknown)[0]} is not a bake option")
    size = value.get("texture_size", DEFAULT_BAKE_SIZE)
    size = _bounded_int(size, "postprocess.bake.texture_size", BAKE_SIZES[0], BAKE_SIZES[-1])
    if size not in BAKE_SIZES:
        raise PolicyError(f"postprocess.bake.texture_size must be one of {list(BAKE_SIZES)}")
    return {"texture_size": size}


def parse_postprocess(raw: Optional[dict]) -> list[tuple[str, dict]]:
    """Validate the `postprocess` object into an ordered plan of (step, params).

    The order is fixed (repair, decimate, smooth, uv_unwrap, bake) whatever the
    caller's key order: each step assumes the one before it ran. A bake needs UVs,
    so asking for a bake schedules the unwrap too.
    """
    if raw is None:
        return []
    if not isinstance(raw, dict):
        raise PolicyError("postprocess must be an object")
    unknown = set(raw) - set(POSTPROCESS_ORDER)
    if unknown:
        raise PolicyError(f"postprocess.{sorted(unknown)[0]} is not a post-process step")
    steps: dict[str, dict] = {}
    repair = _parse_repair(raw.get("repair"))
    if repair is not None:
        steps["repair"] = repair
    decimate = _parse_decimate(raw.get("decimate"))
    if decimate is not None:
        steps["decimate"] = decimate
    smooth = _parse_smooth(raw.get("smooth"))
    if smooth is not None:
        steps["smooth"] = smooth
    unwrap = raw.get("uv_unwrap")
    if unwrap is not None and _as_bool(unwrap, "postprocess.uv_unwrap"):
        steps["uv_unwrap"] = {}
    bake = _parse_bake(raw.get("bake"))
    if bake is not None:
        steps["uv_unwrap"] = {}
        steps["bake"] = bake
    return [(name, steps[name]) for name in POSTPROCESS_ORDER if name in steps]


# ── Modly job status ──────────────────────────────────────────────────────────
MODLY_ACTIVE = frozenset({"pending", "running"})


def interpret_job(job: dict) -> tuple[str, Optional[str]]:
    """Map a Modly JobStatus to ("running" | "done" | "failed", detail).

    For done, detail is the output_url. For failed, detail is a short reason:
    Modly reports a full traceback, which is an internal artefact, so only its
    final line (the exception itself) is kept, bounded in length.
    """
    status = job.get("status")
    if status in MODLY_ACTIVE:
        return "running", job.get("step")
    if status == "done":
        url = job.get("output_url")
        if not url:
            return "failed", "Modly reported success without an output file"
        return "done", url
    if status == "cancelled":
        return "failed", "generation was cancelled"
    if status == "error":
        return "failed", summarize_traceback(job.get("error"))
    return "failed", f"Modly returned an unknown job status: {status!r}"


def summarize_traceback(text: Optional[str], limit: int = 300) -> str:
    lines = [ln.strip() for ln in (text or "").strip().splitlines() if ln.strip()]
    if not lines:
        return "generation failed without an error message"
    last = lines[-1]
    return last if len(last) <= limit else last[: limit - 3] + "..."


def workspace_relative(output_url: str) -> str:
    """`/workspace/<rel>` from Modly -> `<rel>`, refusing anything that escapes."""
    prefix = "/workspace/"
    if not isinstance(output_url, str) or not output_url.startswith(prefix):
        raise PolicyError("Modly output is not a workspace path")
    rel = output_url[len(prefix):]
    parts = rel.split("/")
    if not rel or any(p in ("", ".", "..") for p in parts) or "\\" in rel or "\x00" in rel:
        raise PolicyError("Modly output path is not a plain workspace-relative path")
    return rel


def readiness_problems(models: list[str], all_status: list, errors: dict) -> list[str]:
    """Why Modly cannot serve `models` yet, from /model/all and /extensions/errors.

    Empty list means ready: every configured model is registered, its weights are
    on disk, and its extension loaded without an error.
    """
    problems: list[str] = []
    by_id = {entry.get("id"): entry for entry in all_status if isinstance(entry, dict)}
    for model in models:
        ext = model.split("/", 1)[0]
        err = (errors or {}).get(model) or (errors or {}).get(ext)
        if err:
            problems.append(f"{model}: extension error: {summarize_traceback(str(err))}")
            continue
        entry = by_id.get(model)
        if entry is None:
            problems.append(f"{model}: not registered by Modly")
        elif not entry.get("downloaded"):
            problems.append(f"{model}: weights missing from MODELS_DIR")
    return problems


# ── Transient fetch retry (shared shape with workers/model-trellis2) ─────────
FETCH_ATTEMPTS = 3
FETCH_RETRY_BASE_SECONDS = 1.0

# Upstream status codes worth a second try. Everything else (404, 403, 400) is a
# statement about the URL itself and will fail identically on every attempt.
_RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


def retry_delays(
    attempts: int = FETCH_ATTEMPTS, base: float = FETCH_RETRY_BASE_SECONDS
) -> list[float]:
    """Exponential backoff gaps between attempts (one fewer than `attempts`)."""
    return [base * (2 ** i) for i in range(max(0, attempts - 1))]


def is_transient_fetch_error(exc: BaseException) -> bool:
    """True when re-fetching the same URL could plausibly succeed.

    Timeouts and connection-level failures are the blips this exists for. An
    HTTP error is transient only for the status codes above; a 404 is not going
    to become a 200 on the next attempt.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS
    return isinstance(
        exc, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)
    )


def call_with_retry(
    fn: Callable[[], object],
    *,
    attempts: int = FETCH_ATTEMPTS,
    should_retry: Callable[[BaseException], bool] = is_transient_fetch_error,
    sleep: Callable[[float], None],
    on_retry: Optional[Callable[[int, float, BaseException], None]] = None,
):
    """Call `fn`, retrying with exponential backoff while `should_retry` holds.

    Re-raises the last exception once the attempts are spent or the error is not
    retryable. `sleep` is injected so the policy stays testable without wall
    clock time; `on_retry` receives (attempt_number, delay, exception) for
    logging.
    """
    delays = retry_delays(attempts)
    last: BaseException
    for index in range(max(1, attempts)):
        try:
            return fn()
        except BaseException as exc:  # noqa: BLE001 - re-raised below after the budget
            last = exc
            if index >= len(delays) or not should_retry(exc):
                raise
            delay = delays[index]
            if on_retry:
                on_retry(index + 1, delay, exc)
            sleep(delay)
    raise last
