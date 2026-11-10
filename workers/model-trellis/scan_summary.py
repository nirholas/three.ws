"""Summarise a `trivy image --format json` report for the NGC validation record.

Usage: python3 scan_summary.py report.json

Prints HIGH and CRITICAL counts per result target and class, how many have a
fixed version available, a per-package rollup naming the versions that fix
each package, and every CRITICAL id, so before/after scans of the NGC
candidate image can be compared line for line.
"""
import json
import sys
from collections import Counter


def summarise(report):
    rows = []
    totals = Counter()
    fixable = Counter()
    criticals = []
    for result in report.get("Results") or []:
        counts = Counter()
        fix = 0
        for vuln in result.get("Vulnerabilities") or []:
            sev = vuln.get("Severity")
            if sev not in ("HIGH", "CRITICAL"):
                continue
            counts[sev] += 1
            totals[sev] += 1
            if vuln.get("FixedVersion"):
                fix += 1
                fixable[sev] += 1
            if sev == "CRITICAL":
                fixed = vuln.get("FixedVersion") or "no-fix"
                criticals.append(
                    f'{result.get("Class")} {vuln.get("VulnerabilityID")} {vuln.get("PkgName")} '
                    f'{vuln.get("InstalledVersion")} -> {fixed}'
                )
        if counts:
            rows.append((result.get("Target"), result.get("Class"), counts["CRITICAL"], counts["HIGH"], fix))
    return rows, totals, fixable, criticals


def _fix_key(version):
    return tuple(int(part) if part.isdigit() else 0 for part in version.replace("-", ".").split("."))


def by_package(report):
    """HIGH and CRITICAL findings rolled up per installed package.

    Returns (class, package, installed, critical, high, fixed_versions) rows,
    where fixed_versions joins every distinct fix trivy offers (or "no-fix"),
    so the next dependency bump can be read straight off the list.
    """
    groups = {}
    for result in report.get("Results") or []:
        for vuln in result.get("Vulnerabilities") or []:
            sev = vuln.get("Severity")
            if sev not in ("HIGH", "CRITICAL"):
                continue
            key = (result.get("Class"), vuln.get("PkgName"), vuln.get("InstalledVersion"))
            entry = groups.setdefault(key, {"CRITICAL": 0, "HIGH": 0, "fixes": set()})
            entry[sev] += 1
            for fix in (vuln.get("FixedVersion") or "").split(","):
                if fix.strip():
                    entry["fixes"].add(fix.strip())
    rows = []
    for (klass, pkg, installed), entry in groups.items():
        fixes = ", ".join(sorted(entry["fixes"], key=_fix_key)) or "no-fix"
        rows.append((klass, pkg, installed, entry["CRITICAL"], entry["HIGH"], fixes))
    return sorted(rows, key=lambda r: (-r[3], -r[4], r[1]))


def main(path):
    with open(path) as fh:
        report = json.load(fh)
    rows, totals, fixable, criticals = summarise(report)
    print(f'ARTIFACT {report.get("ArtifactName")}')
    print("TARGET | CLASS | CRITICAL | HIGH | WITH_FIX")
    for target, klass, crit, high, fix in rows:
        print(f"{target} | {klass} | {crit} | {high} | {fix}")
    print(
        f'TOTAL critical={totals["CRITICAL"]} high={totals["HIGH"]} '
        f'critical_fixable={fixable["CRITICAL"]} high_fixable={fixable["HIGH"]}'
    )
    print("PACKAGE | INSTALLED | CRITICAL | HIGH | FIXED_IN")
    for klass, pkg, installed, crit, high, fixes in by_package(report):
        print(f"{klass} {pkg} | {installed} | {crit} | {high} | {fixes}")
    for line in sorted(criticals, key=lambda s: (not s.startswith('lang-pkgs'), s)):
        print(f"CRITICAL {line}")


if __name__ == "__main__":
    main(sys.argv[1])
