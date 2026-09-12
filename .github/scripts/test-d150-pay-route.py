#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("d150_pay_route", HERE / "d150-pay-route.py")
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)


class PayRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name).resolve() / "external-routes.candidate.caddy"
        self.path.write_text("arthello.example {\n  reverse_proxy old:8081\n}\n", encoding="utf-8")
        self.path.chmod(0o600)

    def test_appends_isolated_pay_host_for_the_exact_candidate(self):
        upstream = "arthello-direct-40000000001-1:8081"
        route.append_pay_route(str(self.path), upstream)
        result = self.path.read_text(encoding="utf-8")
        self.assertIn(route.PAY_HOST + " {", result)
        self.assertEqual(result.count("reverse_proxy " + upstream), 2)
        self.assertIn("@pay_backend path /api/* /pay-assets/*", result)
        self.assertIn("rewrite * /pay{uri}", result)
        self.assertIn('X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"', result)
        self.assertEqual(stat_mode(self.path), 0o600)

    def test_refuses_duplicate_host_and_unbound_upstream(self):
        upstream = "arthello-direct-40000000001-1:8081"
        route.append_pay_route(str(self.path), upstream)
        with self.assertRaisesRegex(ValueError, "already present"):
            route.append_pay_route(str(self.path), upstream)
        with self.assertRaisesRegex(ValueError, "invalid candidate upstream"):
            route.append_pay_route(str(self.path), "foreign:8081")


def stat_mode(path):
    return path.stat().st_mode & 0o777


if __name__ == "__main__":
    unittest.main()
