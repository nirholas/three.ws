"""Summarise a `trivy image --format json` report for the NGC validation record.

Usage: python3 scan_summary.py report.json

Prints HIGH and CRITICAL counts per result target and class, how many have a
fixed version available, and the first CRITICAL ids, so before/after scans of
the NGC candidate image can be compared line for line.
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
    for line in sorted(criticals, key=lambda s: (not s.startswith('lang-pkgs'), s)):
        print(f"CRITICAL {line}")


if __name__ == "__main__":
    main(sys.argv[1])
