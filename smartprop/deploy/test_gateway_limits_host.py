"""Offline contract tests for the gateway host cgroup cap operation."""

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest import mock

import gateway_limits_host


HIGH = 1_073_741_824
MAX = 2_147_483_648


class GatewayLimitsHostTest(unittest.TestCase):
    def snapshot(self):
        return {
            "host": "vmi3201429",
            "machine_id": "bfb5b1b8859546f9aac39a4c5bafa616",
            "source": "8c9a61053e76860b5ed7ca11331ed6e5a4cac57c",
            "config_sha256": "b" * 64,
            "persisted": {"MemoryHigh": "infinity", "MemoryMax": "infinity"},
            "unit": {
                "ActiveState": "active",
                "SubState": "running",
                "MainPID": "123",
                "InvocationID": "a" * 32,
                "MemoryCurrent": "450000000",
                "MemoryHigh": "infinity",
                "MemoryMax": "infinity",
                "ControlGroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/gateway.service",
                "Restart": "always",
                "NRestarts": "0",
            },
            "cgroup": {"memory.high": "max", "memory.max": "max"},
        }

    def expected(self):
        snapshot = self.snapshot()
        return {
            key: snapshot[key]
            for key in ("host", "machine_id", "source", "config_sha256")
        } | {
            "unit": {
                key: snapshot["unit"][key]
                for key in ("MainPID", "InvocationID", "MemoryHigh", "MemoryMax")
            }
        }

    def capped_snapshot(self):
        after = self.snapshot()
        after["unit"].update({"MemoryHigh": str(HIGH), "MemoryMax": str(MAX)})
        after["cgroup"] = {"memory.high": str(HIGH), "memory.max": str(MAX)}
        after["persisted"] = {"MemoryHigh": str(HIGH), "MemoryMax": str(MAX)}
        return after

    def assert_unsafe_before(self, mutate):
        snapshot = self.snapshot()
        expected = self.expected()
        mutate(snapshot, expected)
        with self.assertRaises(ValueError):
            gateway_limits_host.validate_before(snapshot, expected)

    def test_validate_before_accepts_exact_safe_snapshot(self):
        proof = gateway_limits_host.validate_before(self.snapshot(), self.expected())
        self.assertTrue(proof)

    def test_validate_before_rejects_changed_bound_identity_and_unit_values(self):
        cases = {
            "source": lambda snapshot, expected: snapshot.__setitem__("source", "c" * 40),
            "config": lambda snapshot, expected: snapshot.__setitem__("config_sha256", "c" * 64),
            "pid": lambda snapshot, expected: snapshot["unit"].__setitem__("MainPID", "456"),
            "invocation": lambda snapshot, expected: snapshot["unit"].__setitem__("InvocationID", "c" * 32),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                self.assert_unsafe_before(mutate)

    def test_validate_before_rejects_unsafe_service_and_memory_state(self):
        cases = {
            "at_memory_high": lambda snapshot, expected: snapshot["unit"].__setitem__("MemoryCurrent", str(HIGH)),
            "inactive": lambda snapshot, expected: snapshot["unit"].__setitem__("ActiveState", "inactive"),
            "not_running": lambda snapshot, expected: snapshot["unit"].__setitem__("SubState", "dead"),
            "zero_pid": lambda snapshot, expected: snapshot["unit"].__setitem__("MainPID", "0"),
            "empty_control_group": lambda snapshot, expected: snapshot["unit"].__setitem__("ControlGroup", ""),
            "recovery_disabled": lambda snapshot, expected: snapshot["unit"].__setitem__("Restart", "no"),
            "recovery_unknown": lambda snapshot, expected: snapshot["unit"].pop("Restart"),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                self.assert_unsafe_before(mutate)

    def test_validate_before_requires_all_expected_bindings(self):
        for key in ("host", "machine_id", "source", "config_sha256"):
            with self.subTest(key=key):
                self.assert_unsafe_before(lambda snapshot, expected, key=key: expected.pop(key))
        for key in ("MainPID", "InvocationID", "MemoryHigh", "MemoryMax"):
            with self.subTest(unit_key=key):
                self.assert_unsafe_before(
                    lambda snapshot, expected, key=key: expected["unit"].pop(key)
                )

    def test_verify_after_accepts_exact_capped_readback(self):
        proof = gateway_limits_host.verify_after(self.snapshot(), self.capped_snapshot())
        self.assertTrue(proof)

    def test_verify_after_rejects_false_caps_and_wrong_cgroup_readback(self):
        cases = {
            "memory_high": lambda after: after["unit"].__setitem__("MemoryHigh", "infinity"),
            "memory_max": lambda after: after["unit"].__setitem__("MemoryMax", str(HIGH)),
            "cgroup_high": lambda after: after["cgroup"].__setitem__("memory.high", "infinity"),
            "cgroup_max": lambda after: after["cgroup"].__setitem__("memory.max", str(HIGH)),
            "not_persisted": lambda after: after.pop("persisted"),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                after = self.capped_snapshot()
                mutate(after)
                with self.assertRaises(ValueError):
                    gateway_limits_host.verify_after(self.snapshot(), after)

    def test_verify_after_rejects_restart_or_identity_drift(self):
        cases = {
            "pid": lambda after: after["unit"].__setitem__("MainPID", "456"),
            "invocation": lambda after: after["unit"].__setitem__("InvocationID", "b" * 32),
            "restart_count": lambda after: after["unit"].__setitem__("NRestarts", "1"),
            "control_group": lambda after: after["unit"].__setitem__("ControlGroup", "/other.slice/gateway.service"),
            "source": lambda after: after.__setitem__("source", "c" * 40),
            "config": lambda after: after.__setitem__("config_sha256", "c" * 64),
            "not_running": lambda after: after["unit"].__setitem__("SubState", "failed"),
        }
        before = self.snapshot()
        for name, mutate in cases.items():
            with self.subTest(name=name):
                after = self.capped_snapshot()
                mutate(after)
                with self.assertRaises(ValueError):
                    gateway_limits_host.verify_after(deepcopy(before), after)

    def test_verify_rollback_accepts_original_unlimited_baseline(self):
        gateway_limits_host.verify_rollback(self.snapshot(), self.snapshot())

    def test_verify_rollback_rejects_stale_or_missing_persistent_limits(self):
        for persisted in ({"MemoryHigh": str(HIGH), "MemoryMax": str(MAX)}, {}):
            with self.subTest(persisted=persisted):
                restored = self.snapshot()
                restored['persisted'] = persisted
                with self.assertRaises(ValueError):
                    gateway_limits_host.verify_rollback(self.snapshot(), restored)

    def test_verify_rollback_rejects_identity_process_counter_or_cgroup_drift(self):
        cases = {
            "source": lambda restored: restored.__setitem__("source", "c" * 40),
            "config": lambda restored: restored.__setitem__("config_sha256", "c" * 64),
            "pid": lambda restored: restored["unit"].__setitem__("MainPID", "456"),
            "invocation": lambda restored: restored["unit"].__setitem__("InvocationID", "b" * 32),
            "restart_count": lambda restored: restored["unit"].__setitem__("NRestarts", "1"),
            "cgroup": lambda restored: restored["cgroup"].__setitem__("memory.max", str(MAX)),
        }
        before = self.snapshot()
        for name, mutate in cases.items():
            with self.subTest(name=name):
                restored = deepcopy(before)
                mutate(restored)
                with self.assertRaises(ValueError):
                    gateway_limits_host.verify_rollback(before, restored)

    def patched_apply_environment(self, temporary_directory, inspect, set_limits):
        return mock.patch.multiple(
            gateway_limits_host,
            LOCK_PATH=Path(temporary_directory) / "gateway.lock",
            BACKUP_ROOT=Path(temporary_directory) / "backups",
            inspect=inspect,
            set_limits=set_limits,
        )

    def test_apply_caps_once_and_writes_a_private_backup_without_restart(self):
        before = self.snapshot()
        after = self.capped_snapshot()
        inspect = mock.Mock(side_effect=[before, after])
        set_limits = mock.Mock()
        with TemporaryDirectory() as temporary_directory:
            with self.patched_apply_environment(temporary_directory, inspect, set_limits), mock.patch(
                "gateway_limits_host.time.sleep"
            ):
                result = gateway_limits_host.apply(self.expected())
            backup = Path(result["backup"])
            self.assertEqual(result["status"], "passed")
            self.assertFalse(result["restarted"])
            self.assertTrue(backup.is_file())
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual(backup.parent.stat().st_mode & 0o777, 0o700)
        set_limits.assert_called_once_with(str(HIGH), str(MAX))
        self.assertEqual(inspect.call_count, 2)

    def test_apply_bad_after_readback_rolls_back_and_reports_successful_rollback(self):
        before = self.snapshot()
        bad_after = self.capped_snapshot()
        bad_after["cgroup"]["memory.high"] = "infinity"
        inspect = mock.Mock(side_effect=[before, bad_after, deepcopy(before)])
        set_limits = mock.Mock()
        with TemporaryDirectory() as temporary_directory:
            with self.patched_apply_environment(temporary_directory, inspect, set_limits), mock.patch(
                "gateway_limits_host.time.sleep"
            ):
                result = gateway_limits_host.apply(self.expected())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["rollback"], "passed")
        self.assertEqual(
            set_limits.call_args_list,
            [mock.call(str(HIGH), str(MAX)), mock.call("infinity", "infinity")],
        )

    def test_apply_partial_set_failure_rolls_back(self):
        before = self.snapshot()
        inspect = mock.Mock(side_effect=[before, deepcopy(before)])
        set_limits = mock.Mock(side_effect=[RuntimeError("partial write"), None])
        with TemporaryDirectory() as temporary_directory:
            with self.patched_apply_environment(temporary_directory, inspect, set_limits), mock.patch(
                "gateway_limits_host.time.sleep"
            ):
                result = gateway_limits_host.apply(self.expected())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["rollback"], "passed")
        self.assertEqual(
            set_limits.call_args_list,
            [mock.call(str(HIGH), str(MAX)), mock.call("infinity", "infinity")],
        )

    def test_apply_failed_rollback_reports_failed_rollback(self):
        before = self.snapshot()
        inspect = mock.Mock(return_value=before)
        set_limits = mock.Mock(side_effect=[RuntimeError("partial write"), RuntimeError("rollback failed")])
        with TemporaryDirectory() as temporary_directory:
            with self.patched_apply_environment(temporary_directory, inspect, set_limits), mock.patch(
                "gateway_limits_host.time.sleep"
            ):
                result = gateway_limits_host.apply(self.expected())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["rollback"], "failed")
        self.assertEqual(
            set_limits.call_args_list,
            [mock.call(str(HIGH), str(MAX)), mock.call("infinity", "infinity")],
        )

    def test_apply_invalid_baseline_performs_no_limit_write(self):
        invalid = self.snapshot()
        invalid["unit"]["MainPID"] = "0"
        inspect = mock.Mock(return_value=invalid)
        set_limits = mock.Mock()
        with TemporaryDirectory() as temporary_directory:
            with self.patched_apply_environment(temporary_directory, inspect, set_limits), mock.patch(
                "gateway_limits_host.time.sleep"
            ):
                with self.assertRaises(ValueError):
                    gateway_limits_host.apply(self.expected())
        set_limits.assert_not_called()


if __name__ == "__main__":
    unittest.main()
