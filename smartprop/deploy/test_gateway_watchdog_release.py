"""Offline integrity tests for the gateway watchdog release driver."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest import mock

import gateway_watchdog_release as release_driver


HEAD = "a" * 40
BASE = "b" * 40
ARTIFACT_DIGEST = "c" * 64


class GatewayWatchdogReleaseTest(unittest.TestCase):
    def plan(self):
        return {
            "base_identity": {"kind": "git", "value": BASE},
            "source_identity": {"kind": "git", "value": HEAD},
            "deployment": {
                "affected_consumers": ["messaging_gateway"],
                "preserved_consumers": ["main_app", "scraper_worker"],
                "required_smoke": [["smartprop/scripts/gateway-watchdog-verify.py"]],
                "artifacts": {"gateway_watchdog": ARTIFACT_DIGEST},
            },
        }

    def write_plan(self, directory, plan):
        path = Path(directory) / "release-plan.json"
        raw = json.dumps(plan, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        path.write_bytes(raw)
        return path, hashlib.sha256(raw).hexdigest()

    def release_patches(self, fresh):
        remote = mock.Mock()
        patches = mock.patch.multiple(
            release_driver,
            identity=mock.Mock(return_value=HEAD),
            remote=remote,
            release_factory=mock.Mock(
                load_adapter=mock.Mock(return_value=object()),
                plan_release=mock.Mock(return_value=deepcopy(fresh)),
            ),
        )
        return remote, patches

    def test_rejects_wrong_whole_plan_hash_before_any_remote_call(self):
        with TemporaryDirectory() as directory:
            path, _ = self.write_plan(directory, self.plan())
            remote = mock.Mock()
            with mock.patch.object(release_driver, "remote", remote):
                with self.assertRaisesRegex(ValueError, "plan hash mismatch"):
                    release_driver.release(path, "0" * 64)
            remote.assert_not_called()

    def test_rejects_wrong_source_identity_before_any_remote_call(self):
        plan = self.plan()
        plan["source_identity"] = {"kind": "git", "value": "d" * 40}
        with TemporaryDirectory() as directory:
            path, digest = self.write_plan(directory, plan)
            remote, patches = self.release_patches(plan)
            with patches:
                with self.assertRaisesRegex(ValueError, "plan source mismatch"):
                    release_driver.release(path, digest)
            remote.assert_not_called()

    def test_rejects_plan_that_changes_when_recomputed_before_any_remote_call(self):
        plan = self.plan()
        fresh = deepcopy(plan)
        fresh["deployment"]["policy_sha256"] = "e" * 64
        with TemporaryDirectory() as directory:
            path, digest = self.write_plan(directory, plan)
            remote, patches = self.release_patches(fresh)
            with patches:
                with self.assertRaisesRegex(ValueError, "plan does not recompute"):
                    release_driver.release(path, digest)
            remote.assert_not_called()

    def test_rejects_wrong_release_scope_before_any_remote_call(self):
        cases = {
            "affected": ("affected_consumers", ["main_app"]),
            "preserved": ("preserved_consumers", ["scraper_worker"]),
            "smoke": ("required_smoke", [["smartprop/scripts/other-verify.py"]]),
            "artifact": ("artifacts", {"other_artifact": ARTIFACT_DIGEST}),
        }
        for name, (field, value) in cases.items():
            with self.subTest(scope=name), TemporaryDirectory() as directory:
                plan = self.plan()
                plan["deployment"][field] = value
                path, digest = self.write_plan(directory, plan)
                remote, patches = self.release_patches(plan)
                with patches:
                    with self.assertRaisesRegex(ValueError, "unsupported release scope"):
                        release_driver.release(path, digest)
                remote.assert_not_called()

    def test_rejects_materialized_host_executor_that_differs_from_source_before_remote(self):
        plan = self.plan()

        def materialize(_cache, _digest, destination):
            destination.mkdir()
            (destination / "gateway_watchdog_host.py").write_bytes(b"changed executor")
            return {"destination": str(destination)}

        with TemporaryDirectory() as directory:
            path, digest = self.write_plan(directory, plan)
            remote, patches = self.release_patches(plan)
            with patches, mock.patch.object(
                release_driver.artifact_cache, "materialize", side_effect=materialize
            ):
                with self.assertRaisesRegex(ValueError, "host executor does not match source"):
                    release_driver.release(path, digest)
            remote.assert_not_called()

    def test_preserves_failed_remote_rollback_result_without_reporting_success(self):
        plan = self.plan()
        remote_result = {
            "status": "failed",
            "error": "post-apply verification failed",
            "rollback": {"status": "passed", "backup": "/private/backup.json"},
        }
        source_executor = (release_driver.DEPLOY / "gateway_watchdog_host.py").read_bytes()

        def materialize(_cache, _digest, destination):
            destination.mkdir()
            (destination / "gateway_watchdog_host.py").write_bytes(source_executor)
            (destination / "expected.json").write_text(json.dumps({"host": "vmi3201429"}))
            (destination / "watchdog.sh").write_bytes((release_driver.ROOT / "smartprop/scripts/openclaw-gateway-watchdog.sh").read_bytes())
            return {"destination": str(destination)}

        with TemporaryDirectory() as directory:
            path, digest = self.write_plan(directory, plan)
            remote, patches = self.release_patches(plan)
            with patches, mock.patch.object(
                release_driver.artifact_cache, "materialize", side_effect=materialize
            ):
                remote.return_value = remote_result
                result = release_driver.release(path, digest)

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["rollback"], remote_result["rollback"])
        self.assertEqual(result["source"], HEAD)
        self.assertEqual(result["plan"], digest)
        self.assertNotIn("executor_capability", result)


if __name__ == "__main__":
    unittest.main()
