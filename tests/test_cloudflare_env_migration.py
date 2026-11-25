"""Configuration parsing and cross-language transport checks; no remote calls."""

import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("migration", ROOT / "scripts/migrate-cloudflare-env.py")
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class EnvironmentMigrationTests(unittest.TestCase):
    def test_secret_references_keep_cross_project_and_pinned_versions(self):
        aliases = migration.secret_aliases({"run.googleapis.com/secrets": "alias:projects/other/secrets/db"})
        self.assertEqual(migration.reference({
            "name": "DATABASE_URL", "valueFrom": {"secretKeyRef": {"name": "alias", "key": "17"}},
        }, "source", aliases), "projects/other/secrets/db/versions/17")
        self.assertEqual(migration.reference({
            "name": "API_KEY", "valueSource": {"secretKeyRef": {"secret": "key", "version": "latest"}},
        }, "source", {}), "projects/source/secrets/key/versions/latest")

    def test_container_selection_rejects_ambiguous_sidecars(self):
        service = {"template": {"containers": [{"name": "api"}, {"name": "proxy"}]}}
        with self.assertRaises(migration.MigrationError):
            migration.select_container(service, None)
        selected, _, _ = migration.select_container(service, "api")
        self.assertEqual(selected["name"], "api")

    def test_platform_names_and_explicit_exclusions_are_skipped(self):
        selected, skipped = migration.environment_entries({"env": [
            {"name": "PORT", "value": "8080"},
            {"name": "PUBLIC_APP_ORIGIN", "value": "https://three.ws"},
            {"name": "API_KEY", "value": "text"},
            {"name": "DATABASE_URL", "value": "text"},
        ]}, {"DATABASE_URL"})
        self.assertEqual([item["name"] for item in selected], ["API_KEY"])
        self.assertEqual(set(skipped), {"PORT", "PUBLIC_APP_ORIGIN", "DATABASE_URL"})

    def test_private_urls_are_reported_by_name_only(self):
        self.assertEqual(migration.private_endpoint_names({
            "REDIS_URL": "redis://user:password@10.0.0.4:6379",
            "DATABASE_URL": "postgresql://db.internal/database",
            "PUBLIC_URL": "https://example.com",
        }), ["REDIS_URL", "DATABASE_URL"])

    def test_python_chunks_are_decoded_exactly_by_the_worker(self):
        values = {"MULTILINE": "first\nsecond\n", "UNICODE": "café 🌎" * 2000, "EMPTY": ""}
        bindings = migration.bundle(values)
        self.assertGreater(int(bindings[migration.COUNT_KEY]), 1)
        self.assertTrue(all(len(value.encode("utf-8")) <= 4500 for value in bindings.values()))
        result = subprocess.run([
            "node", "--input-type=module", "-e",
            "import { runtimeEnvironment } from './deploy/cloudflare/runtime-env.mjs';"
            "let input = ''; for await (const chunk of process.stdin) input += chunk;"
            "process.stdout.write(JSON.stringify(runtimeEnvironment(JSON.parse(input), 'https://example.com')));",
        ], input=json.dumps(bindings), text=True, capture_output=True, check=True, cwd=ROOT)
        expected = {**values, "NODE_ENV": "production", "PORT": "8080", "PUBLIC_APP_ORIGIN": "https://example.com"}
        self.assertEqual(json.loads(result.stdout), expected)

    def test_oversized_bundle_is_rejected_before_upload(self):
        with self.assertRaises(migration.MigrationError):
            migration.bundle({"LARGE": "x" * (4500 * 95)})


if __name__ == "__main__":
    unittest.main()
