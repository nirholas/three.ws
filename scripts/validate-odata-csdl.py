#!/usr/bin/env python3
"""Validate the usage feed's $metadata against the OASIS OData v4.0 CSDL schemas.

    python3 scripts/validate-odata-csdl.py [metadata.xml]

With no argument, the CSDL is generated from api/_lib/odata/csdl.js through
node, so the check covers exactly what the server sends. The official
edmx.xsd and edm.xsd (OData Version 4.0, OASIS Standard) are downloaded once
into ~/.cache/three-ws-odata-xsd. Exits non-zero, printing every error, when
the document is not schema-valid. Needs lxml (pip install lxml).
"""

import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from lxml import etree

BASE = "https://docs.oasis-open.org/odata/odata/v4.0/os/schemas/"
FILES = ["edmx.xsd", "edm.xsd"]
CACHE = Path.home() / ".cache" / "three-ws-odata-xsd"
ROOT = Path(__file__).resolve().parent.parent


def schemas():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = CACHE / name
        if not target.exists():
            with urllib.request.urlopen(BASE + name, timeout=30) as r:
                target.write_bytes(r.read())
    # The OASIS edmx.xsd imports the edm namespace without a schemaLocation,
    # so a small driver schema imports both by file.
    driver = CACHE / "driver.xsd"
    driver.write_text(
        '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">'
        '<xs:import namespace="http://docs.oasis-open.org/odata/ns/edm" schemaLocation="edm.xsd"/>'
        '<xs:import namespace="http://docs.oasis-open.org/odata/ns/edmx" schemaLocation="edmx.xsd"/>'
        "</xs:schema>"
    )
    return driver


def metadata(argv):
    if len(argv) > 1:
        return Path(argv[1]).read_bytes()
    script = "import('./api/_lib/odata/csdl.js').then(m => process.stdout.write(m.metadataXml()))"
    return subprocess.run(["node", "-e", script], cwd=ROOT, check=True, capture_output=True).stdout


def main(argv):
    edmx = schemas()
    # The driver imports by relative location; parse from the cache dir.
    os.chdir(CACHE)
    schema = etree.XMLSchema(etree.parse(str(edmx)))
    doc = etree.fromstring(metadata(argv))
    if schema.validate(doc):
        sets = doc.findall(".//{http://docs.oasis-open.org/odata/ns/edm}EntitySet")
        types = doc.findall(".//{http://docs.oasis-open.org/odata/ns/edm}EntityType")
        print(f"VALID: $metadata conforms to OData v4.0 CSDL (edmx.xsd + edm.xsd); {len(types)} entity types, {len(sets)} entity sets")
        return 0
    for err in schema.error_log:
        print(f"line {err.line}: {err.message}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
