"""Run both validators on an exported asset and return one structured report.

1. usdchecker. Since OpenUSD 25.x the `usdchecker` command is a thin C++
   front end over the UsdValidation framework: it loads every registered
   validator (geometry, shading, skeleton, physics, packaging, composition)
   and runs them over the stage. The pip `usd-core` wheel ships the framework
   and all of its validator plugins but not the CLI binary, so this module
   runs the identical validator set through the Python binding. Same engine,
   same rules, same messages.

2. NVIDIA Asset Validator (`omniverse-asset-validator`, the open-source
   engine behind Omniverse's validation panel and the SimReady checks): the
   full default rule set (40 rules incl. ColliderChecker, MassChecker,
   RigidBodyChecker, SkelBindingAPIAppliedChecker, MaterialUsdPreviewSurfaceChecker,
   NormalMapTextureChecker, KindChecker, DefaultPrimChecker, UsdzPackageValidator).

An export passes when both report zero errors. Warnings are kept in the
report verbatim so they are visible to whoever imports the asset.
"""

from __future__ import annotations

import logging
from importlib.metadata import version

from pxr import Usd, UsdValidation

logging.getLogger("omni.asset_validator").setLevel(logging.WARNING)
logging.getLogger("omni.asset_validator._plugins").setLevel(logging.WARNING)


def _site(err) -> str:
    out = []
    for s in err.GetSites():
        try:
            if s.IsPrim():
                out.append(str(s.GetPrim().GetPath()))
            elif s.IsProperty():
                out.append(str(s.GetProperty().GetPath()))
            elif s.GetLayer():
                out.append(s.GetLayer().identifier.rsplit("/", 1)[-1])
        except Exception:
            continue
    return ", ".join(out)


def run_usdchecker(path: str) -> dict:
    reg = UsdValidation.ValidationRegistry()
    validators = reg.GetOrLoadAllValidators()
    ctx = UsdValidation.ValidationContext(validators)
    stage = Usd.Stage.Open(path)
    errors, warnings = [], []
    for err in ctx.Validate(stage):
        if err.HasNoError():
            continue
        entry = {"rule": str(err.GetIdentifier()), "message": err.GetMessage(), "at": _site(err)}
        kind = err.GetType()
        if kind == UsdValidation.ValidationErrorType.Error:
            errors.append(entry)
        elif kind == UsdValidation.ValidationErrorType.Warn:
            warnings.append(entry)
    return {
        "tool": "usdchecker (OpenUSD UsdValidation)",
        "openusd": ".".join(str(x) for x in Usd.GetVersion()),
        "validators": len(validators),
        "errors": errors,
        "warnings": warnings,
        "passed": not errors,
    }


def run_asset_validator(path: str) -> dict:
    import omni.asset_validator as av

    engine = av.ValidationEngine()
    results = engine.validate(path)
    errors, warnings = [], []
    for issue in results.issues():
        sev = str(getattr(issue.severity, "name", issue.severity)).upper()
        rule = getattr(issue.rule, "__name__", None) or str(issue.rule or issue.requirement or "")
        at = ""
        try:
            at = str(issue.at.as_str()) if issue.at is not None else ""
        except Exception:
            at = str(issue.at) if issue.at is not None else ""
        entry = {"rule": rule, "message": issue.message, "at": at}
        if sev in ("ERROR", "FAILURE"):
            errors.append(entry)
        elif sev == "WARNING":
            warnings.append(entry)
    return {
        "tool": "NVIDIA Asset Validator (omniverse-asset-validator)",
        "version": version("omniverse-asset-validator"),
        "rules": len(engine.rules),
        "errors": errors,
        "warnings": warnings,
        "passed": not errors,
    }


def validate_files(paths: dict) -> dict:
    """paths: {"usd": ..., "usdz": ...}. Both validators run on both files."""
    report = {}
    for kind, p in paths.items():
        report[kind] = {"usdchecker": run_usdchecker(p), "asset_validator": run_asset_validator(p)}
    report["passed"] = all(r["usdchecker"]["passed"] and r["asset_validator"]["passed"]
                           for k, r in report.items() if isinstance(r, dict))
    return report
