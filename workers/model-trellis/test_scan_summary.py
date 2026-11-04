from scan_summary import summarise


def _report():
    return {
        "Results": [
            {
                "Target": "ubuntu 22.04",
                "Class": "os-pkgs",
                "Vulnerabilities": [
                    {"Severity": "HIGH", "FixedVersion": "1.2", "VulnerabilityID": "CVE-1", "PkgName": "a", "InstalledVersion": "1.1"},
                    {"Severity": "CRITICAL", "FixedVersion": "", "VulnerabilityID": "CVE-2", "PkgName": "b", "InstalledVersion": "2.0"},
                    {"Severity": "LOW", "FixedVersion": "9", "VulnerabilityID": "CVE-3", "PkgName": "c", "InstalledVersion": "1"},
                ],
            },
            {"Target": "python-pkg", "Class": "lang-pkgs", "Vulnerabilities": None},
        ]
    }


def test_counts_only_high_and_critical():
    rows, totals, fixable, criticals = summarise(_report())
    assert rows == [("ubuntu 22.04", "os-pkgs", 1, 1, 1)]
    assert totals["HIGH"] == 1 and totals["CRITICAL"] == 1
    assert fixable["HIGH"] == 1 and fixable["CRITICAL"] == 0
    assert criticals == ["os-pkgs CVE-2 b 2.0 -> no-fix"]


def test_empty_report():
    rows, totals, _, criticals = summarise({})
    assert rows == [] and not totals and criticals == []
