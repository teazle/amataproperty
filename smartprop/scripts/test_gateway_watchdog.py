"""Offline behavior checks for the OpenClaw gateway watchdog."""

from pathlib import Path
import os
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("openclaw-gateway-watchdog.sh")


class GatewayWatchdogTest(unittest.TestCase):
    def write_stub(self, directory, name, body):
        path = Path(directory, name)
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body)
        path.chmod(0o700)

    def run_watchdog(self, scenario):
        with tempfile.TemporaryDirectory(prefix="gateway-watchdog-test-") as temporary:
            root = Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            events = root / "events"
            events.touch()
            self.write_stub(bin_dir, "systemctl", """
[ \"$1\" = \"--user\" ] && shift
case \"$1\" in
  is-active) exit 0 ;;
  restart) printf 'restart %s\\n' \"$2\" >>\"$EVENTS\" ;;
  status) printf 'status %s\\n' \"$2\" >>\"$EVENTS\" ;;
esac
""")
            self.write_stub(bin_dir, "ss", "printf 'LISTEN 0 0 127.0.0.1:18789 0.0.0.0:*\\n'\n")
            self.write_stub(bin_dir, "curl", "exit 0\n")
            self.write_stub(bin_dir, "sleep", "exit 0\n")
            self.write_stub(bin_dir, "flock", "exit 0\n")
            self.write_stub(bin_dir, "date", "printf '2026-09-18T00:00:00+00:00\\n'\n")
            self.write_stub(bin_dir, "timeout", "shift\nexec \"$@\"\n")
            self.write_stub(bin_dir, "openclaw", """
count=0
[ -f \"$PROBE_COUNT\" ] && count=$(<\"$PROBE_COUNT\")
count=$((count + 1))
printf '%s' \"$count\" >\"$PROBE_COUNT\"
case \"$SCENARIO\" in
  transient) [ \"$count\" -eq 1 ] && exit 1 ;;
  recover) [ \"$count\" -le 2 ] && exit 1 ;;
  sustained) exit 1 ;;
esac
exit 0
""")
            environment = {
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "EVENTS": str(events),
                "PROBE_COUNT": str(root / "probe-count"),
                "SCENARIO": scenario,
                "LOG_FILE": str(root / "watchdog.log"),
                "LOCK_FILE": str(root / "watchdog.lock"),
                "RESTART_SETTLE_SECONDS": "0",
                "RESTART_READY_ATTEMPTS": "1",
            }
            result = subprocess.run(
                ["bash", str(SCRIPT)],
                cwd=root,
                env=environment,
                text=True,
                capture_output=True,
                timeout=5,
            )
            return {
                "exit": result.returncode,
                "events": events.read_text(),
                "log": (root / "watchdog.log").read_text() if (root / "watchdog.log").exists() else "",
                "probes": int((root / "probe-count").read_text()),
            }

    def assert_restarts(self, result, expected):
        self.assertEqual(result["events"].count("restart "), expected)

    def test_healthy_gateway_does_not_restart(self):
        result = self.run_watchdog("healthy")
        self.assertEqual(result["exit"], 0)
        self.assert_restarts(result, 0)

    def test_transient_failure_that_recovers_on_confirmation_does_not_restart(self):
        result = self.run_watchdog("transient")
        self.assertEqual(result["exit"], 0)
        self.assert_restarts(result, 0)
        self.assertIn("hard-health recovered before restart; no restart", result["log"])

    def test_sustained_failure_restarts_once_and_recovers(self):
        result = self.run_watchdog("recover")
        self.assertEqual(result["exit"], 0)
        self.assert_restarts(result, 1)
        self.assertIn("recovered openclaw-gateway.service after attempt 1/1", result["log"])

    def test_sustained_unrecovered_failure_exits_one_after_one_restart(self):
        result = self.run_watchdog("sustained")
        self.assertEqual(result["exit"], 1)
        self.assert_restarts(result, 1)
        self.assertIn("still hard-unhealthy after restart", result["log"])


if __name__ == "__main__":
    unittest.main()
