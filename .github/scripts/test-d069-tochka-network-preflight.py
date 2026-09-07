#!/usr/bin/env python3
"""Run the real network preflight block with a deterministic Docker adapter.

No Docker daemon, production container, bank endpoint or workflow is contacted.
"""

import argparse
import os
from pathlib import Path
import subprocess
import unittest


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument(
    "--rollout-script",
    type=Path,
    default=Path(__file__).with_name("d069-tochka-import-rollout.sh"),
)
options, unittest_arguments = parser.parse_known_args()
source = options.rollout_script.read_text(encoding="utf-8")
start_marker = 'test "$live_seen" -eq 1\n'
end_marker = '\nnetwork_id="$(docker network inspect "$network_name"'
start = source.index(start_marker) + len(start_marker)
end = source.index(end_marker, start)
preflight = source[start:end]

BASH_ADAPTER = r"""set -Eeuo pipefail
live_id=fixture-container-id
docker() {
  test "$#" -eq 4
  test "$1" = inspect
  test "$2" = "$live_id"
  test "$3" = --format
  test "$4" = '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}'
  printf '%s' "$FIXTURE_NETWORK_OUTPUT"
  printf '%s' "$FIXTURE_INSPECT_ERROR" >&2
  return "$FIXTURE_INSPECT_STATUS"
}
"""


def run_preflight(output, status=0, error=""):
    return subprocess.run(
        ["bash", "-c", BASH_ADAPTER + preflight + '\nprintf "%s\\0" "$network_name"\n'],
        env={
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "FIXTURE_NETWORK_OUTPUT": output,
            "FIXTURE_INSPECT_STATUS": str(status),
            "FIXTURE_INSPECT_ERROR": error,
        },
        capture_output=True,
        timeout=5,
        check=False,
    )


class DockerNetworkPreflightTests(unittest.TestCase):
    def assert_network(self, output, expected):
        result = run_preflight(output)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, expected.encode() + b"\0")

    def assert_rejected(self, output):
        result = run_preflight(output)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")

    def test_accepts_real_docker_one_network_extra_newline(self):
        # Docker TemplateInspector emits its own trailing newline after println.
        self.assert_network("arthello-public\n\n", "arthello-public")

    def test_accepts_one_network_without_docker_extra_newline(self):
        for output in ("arthello-public", "arthello-public\n"):
            with self.subTest(output=repr(output)):
                self.assert_network(output, "arthello-public")

    def test_rejects_no_attached_networks(self):
        for output in ("", "\n", "\n\n"):
            with self.subTest(output=repr(output)):
                self.assert_rejected(output)

    def test_rejects_two_attached_networks(self):
        self.assert_rejected("arthello-public\nsecond-network\n\n")

    def test_rejects_three_attached_networks(self):
        self.assert_rejected("arthello-public\nsecond-network\nthird-network\n\n")

    def test_does_not_silently_discard_an_interior_blank_line(self):
        self.assert_rejected("arthello-public\n\nsecond-network\n\n")

    def test_preserves_line_content_instead_of_splitting_on_whitespace(self):
        # The parser need not invent Docker network-name syntax rules.
        self.assert_network(" prefix with spaces\t\n\n", " prefix with spaces\t")

    def test_propagates_inspect_error_with_partial_one_network_output(self):
        result = run_preflight("arthello-public\n", status=42, error="inspect failed\n")
        self.assertEqual(result.returncode, 42)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"inspect failed\n")

    def test_propagates_inspect_error_with_empty_output(self):
        result = run_preflight("", status=23, error="container unavailable\n")
        self.assertEqual(result.returncode, 23)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"container unavailable\n")


if __name__ == "__main__":
    unittest.main(argv=[str(Path(__file__)), *unittest_arguments])
