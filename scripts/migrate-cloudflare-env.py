#!/usr/bin/env python3
"""Copy Cloud Run runtime configuration to an existing Cloudflare staging Worker.

Run in Google Cloud Shell. Default mode inventories names only. --apply resolves
referenced Secret Manager versions and uploads an encrypted configuration bundle.
Values remain in process memory; no environment file is created or printed.
"""

import argparse
import base64
import getpass
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


PREFIX = "THREE_WS_ENV_"
COUNT_KEY = PREFIX + "PARTS"
CHUNK_SIZE = 4500
MAX_PARTS = 95
SKIP = {
    "PORT", "NODE_ENV", "PUBLIC_APP_ORIGIN", "K_SERVICE", "K_REVISION",
    "K_CONFIGURATION", "THREE_WS_INSTANCE", "THREE_WS_SLEEP_MS",
    "GOOGLE_APPLICATION_CREDENTIALS",
}


class MigrationError(Exception):
    """An actionable error whose text never contains an environment value."""


def gcloud(arguments, task):
    environment = dict(os.environ)
    environment["CLOUDSDK_CORE_LOG_HTTP"] = "false"
    environment["CLOUDSDK_CORE_VERBOSITY"] = "error"
    try:
        result = subprocess.run(
            ["gcloud", *arguments, "--quiet"], check=False,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise MigrationError(f"Could not {task}. Check Cloud Shell authentication and retry.") from None
    if result.returncode:
        raise MigrationError(
            f"Could not {task}. Check your Google account, project, and IAM permissions. "
            "Cloud Run Viewer and Secret Manager Secret Accessor are needed."
        )
    return result.stdout


def select_container(service, container_name):
    template = service.get("spec", {}).get("template", {}) or service.get("template", {})
    specification = template.get("spec", template)
    containers = specification.get("containers", [])
    if container_name:
        containers = [item for item in containers if item.get("name") == container_name]
    if len(containers) != 1:
        raise MigrationError("Choose the main API container explicitly with --container NAME.")
    annotations = {
        **service.get("metadata", {}).get("annotations", {}),
        **template.get("metadata", {}).get("annotations", {}),
    }
    return containers[0], annotations, specification.get("volumes", [])


def secret_aliases(annotations):
    raw = annotations.get("run.googleapis.com/secrets", "")
    aliases = {}
    for pair in raw.split(","):
        if ":" in pair:
            alias, target = pair.split(":", 1)
            aliases[alias.strip()] = target.strip()
    return aliases


def reference(entry, project, aliases):
    item = entry.get("valueFrom", {}).get("secretKeyRef")
    if item:
        name, version = item.get("name"), item.get("key")
    else:
        item = entry.get("valueSource", {}).get("secretKeyRef")
        if not item:
            raise MigrationError(f"Unsupported environment source for {entry['name']}.")
        name, version = item.get("secret"), item.get("version")
    name = aliases.get(name, name)
    if not name or not version:
        raise MigrationError(f"Incomplete secret reference for {entry['name']}.")
    if not name.startswith("projects/"):
        name = f"projects/{project}/secrets/{name}"
    if not re.fullmatch(r"projects/[^/]+/secrets/[^/]+", name):
        raise MigrationError(f"Unsupported secret resource for {entry['name']}.")
    return name + "/versions/" + str(version)


def read_secret(resource, variable):
    encoded = gcloud(
        ["secrets", "versions", "access", resource, "--format=get(payload.data)"],
        f"read the referenced secret for {variable}",
    ).strip()
    try:
        return base64.b64decode(
            encoded + b"=" * (-len(encoded) % 4), altchars=b"-_", validate=True,
        ).decode("utf-8")
    except (ValueError, UnicodeError):
        raise MigrationError(f"The referenced secret for {variable} is not UTF-8 text.") from None


def environment_entries(container, excludes):
    selected, skipped = [], []
    seen = set()
    for item in container.get("env", []):
        name = item.get("name", "")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or name in seen:
            raise MigrationError("Cloud Run returned an invalid or duplicate environment name.")
        seen.add(name)
        if name in SKIP or name in excludes:
            skipped.append(name)
        elif name.startswith(PREFIX):
            raise MigrationError("Source configuration uses the reserved THREE_WS_ENV_ namespace.")
        else:
            selected.append(item)
    return selected, skipped


def private_endpoint_names(values):
    private = []
    for name, value in values.items():
        try:
            host = urllib.parse.urlsplit(value).hostname
            if host and (host in {"localhost", "host.docker.internal"} or host.endswith(".internal")):
                private.append(name)
            elif host and ipaddress.ip_address(host).is_private:
                private.append(name)
        except ValueError:
            continue
    return private


def bundle(values):
    # ASCII serialization makes chunk boundaries independent of Unicode bytes.
    data = json.dumps(values, ensure_ascii=True, separators=(",", ":"))
    parts = [data[i:i + CHUNK_SIZE] for i in range(0, len(data), CHUNK_SIZE)]
    if len(parts) > MAX_PARTS:
        raise MigrationError("Configuration is too large for this bundle; select keys with --only/--exclude.")
    result = {COUNT_KEY: str(len(parts))}
    result.update({f"{PREFIX}{i:03d}": part for i, part in enumerate(parts)})
    return result


def cloudflare(account, worker, token, suffix, method="GET", body=None):
    url = (
        "https://api.cloudflare.com/client/v4/accounts/" + account
        + "/workers/scripts/" + urllib.parse.quote(worker, safe="") + suffix
    )
    headers = {"Authorization": "Bearer " + token}
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/merge-patch+json"
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # Remote error bodies may echo submitted values. Never print them.
        code = error.code
        error.close()
        if code == 404:
            raise MigrationError("Target Worker not found. Complete its first deployment and check the account ID.") from None
        raise MigrationError(
            f"Cloudflare returned HTTP {code}. Check token permissions, deployment status, and account limits."
        ) from None
    except (OSError, ValueError):
        raise MigrationError("Cloudflare could not confirm this request. Check its dashboard before retrying.") from None
    if not result.get("success"):
        raise MigrationError("Cloudflare did not confirm success. Check the target Worker's dashboard.")
    return result.get("result")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="aerial-vehicle-466722-p5")
    parser.add_argument("--region", default="us-central1")
    parser.add_argument("--service", default="three-ws-api")
    parser.add_argument("--container")
    parser.add_argument("--worker", default="three-ws-staging")
    parser.add_argument("--account-id")
    parser.add_argument("--exclude", action="append", default=[], metavar="NAME")
    parser.add_argument("--only", action="append", default=[], metavar="NAME")
    parser.add_argument("--apply", action="store_true", help="Read referenced secrets and upload to Cloudflare")
    args = parser.parse_args()
    if not shutil.which("gcloud"):
        raise MigrationError("Run this script in Google Cloud Shell, where gcloud is already installed.")
    if args.apply and not sys.stdin.isatty():
        raise MigrationError("Run the saved script in an interactive terminal so API-token input stays hidden.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", args.worker):
        raise MigrationError("Invalid Cloudflare Worker name.")
    raw = gcloud(
        ["run", "services", "describe", args.service, "--project", args.project,
         "--region", args.region, "--format=json"],
        "read the Cloud Run service configuration",
    )
    try:
        service = json.loads(raw)
    except ValueError:
        raise MigrationError("Cloud Run did not return valid service metadata.") from None
    container, annotations, volumes = select_container(service, args.container)
    entries, skipped = environment_entries(container, set(args.exclude))
    if args.only:
        wanted = set(args.only)
        available = {item["name"] for item in entries}
        if wanted - available:
            raise MigrationError("Some --only names were not found in the source environment.")
        entries = [item for item in entries if item["name"] in wanted]
    print(f"Source: {args.project} / {args.region} / {args.service}")
    print(f"Destination: Cloudflare Worker {args.worker}")
    print(f"Selected {len(entries)} runtime values. Values will not be printed.")
    if skipped:
        print("Skipped platform/origin/file-path or excluded settings: " + ", ".join(sorted(skipped)))
    if any("secret" in item for item in volumes):
        print("Note: Secret volume files are not environment variables and need separate migration.")
    if not entries:
        raise MigrationError("No environment values selected.")
    if not args.apply:
        print("Names: " + ", ".join(sorted(item["name"] for item in entries)))
        print("Inventory only. No Secret Manager values read and no Cloudflare changes made.")
        print("Run again with --apply to copy these values.")
        return

    account = args.account_id or input("Cloudflare account ID (32 characters): ").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
        raise MigrationError("The Cloudflare account ID must contain 32 hexadecimal characters.")
    token = getpass.getpass("Cloudflare API token (input hidden): ").strip()
    if not token:
        raise MigrationError("A Cloudflare API token is required.")
    settings = cloudflare(account, args.worker, token, "/settings")
    bindings = settings.get("bindings", [])
    names = {item["name"] for item in entries}
    collisions = [item["name"] for item in bindings if item.get("name") in names]
    if collisions:
        raise MigrationError(
            "Existing per-variable bindings would override this bundle: " + ", ".join(sorted(collisions))
            + ". Remove those bindings or exclude them from this import."
        )
    aliases = secret_aliases(annotations)
    values, cache = {}, {}
    for item in entries:
        name = item["name"]
        if "value" in item:
            values[name] = item["value"]
        else:
            resource = reference(item, args.project, aliases)
            if resource not in cache:
                cache[resource] = read_secret(resource, name)
            values[name] = cache[resource]
        if not isinstance(values[name], str) or "\0" in values[name]:
            raise MigrationError(f"Runtime value {name} is not valid container text.")
    private = private_endpoint_names(values)
    if private:
        print("Networking follow-up required for private endpoint variables: " + ", ".join(sorted(private)))
    packaged = bundle(values)
    existing = {item["name"] for item in bindings if item.get("type") in {"plain_text", "secret_text"}}
    if len(existing | set(packaged)) > 128:
        raise MigrationError("The imported bundle would exceed the paid Worker's 128-variable limit.")
    body = {"secrets": {
        name: {"name": name, "text": value, "type": "secret_text"}
        for name, value in packaged.items()
    }}
    print(f"Uploading {len(values)} runtime values in {len(packaged)} encrypted bindings...")
    cloudflare(account, args.worker, token, "/secrets-bulk", method="PATCH", body=body)
    verified = cloudflare(account, args.worker, token, "/settings")
    actual = {item.get("name") for item in verified.get("bindings", []) if item.get("type") == "secret_text"}
    if not set(packaged) <= actual:
        raise MigrationError("Upload returned success but verification is incomplete. Check the Worker dashboard.")
    print("Imported and verified secret binding names. GCP was not changed.")
    print("Restart the staging container so the Node process reads the new environment.")
    print("This does not migrate GCP service identity, private networking, secret files, or scheduled jobs.")


if __name__ == "__main__":
    try:
        main()
    except MigrationError as error:
        print("Migration stopped: " + str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Migration cancelled.", file=sys.stderr)
        sys.exit(130)
    except Exception:
        print("Migration stopped unexpectedly. No secret values are included in this error.", file=sys.stderr)
        sys.exit(1)
