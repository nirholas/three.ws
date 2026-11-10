from scan_summary import by_package, summarise


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


def test_by_package_groups_high_and_critical_with_fix_versions():
    report = {
        "Results": [
            {
                "Target": "Python",
                "Class": "lang-pkgs",
                "Vulnerabilities": [
                    {"Severity": "CRITICAL", "FixedVersion": "13.0.0", "VulnerabilityID": "CVE-A", "PkgName": "pillow", "InstalledVersion": "12.3.0"},
                    {"Severity": "HIGH", "FixedVersion": "12.4.0, 13.0.0", "VulnerabilityID": "CVE-B", "PkgName": "pillow", "InstalledVersion": "12.3.0"},
                    {"Severity": "HIGH", "FixedVersion": "", "VulnerabilityID": "CVE-C", "PkgName": "torch", "InstalledVersion": "2.6.0"},
                    {"Severity": "MEDIUM", "FixedVersion": "9", "VulnerabilityID": "CVE-D", "PkgName": "torch", "InstalledVersion": "2.6.0"},
                ],
            }
        ]
    }
    assert by_package(report) == [
        ("lang-pkgs", "pillow", "12.3.0", 1, 1, "12.4.0, 13.0.0"),
        ("lang-pkgs", "torch", "2.6.0", 0, 1, "no-fix"),
    ]
