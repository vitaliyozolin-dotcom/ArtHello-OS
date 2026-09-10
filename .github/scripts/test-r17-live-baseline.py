import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("baseline", Path(__file__).with_name("r17-live-baseline.py"))
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


def accepted():
    config = {"User": "node", "Cmd": ["node", "production/runtime-server.mjs"],
              "Env": ["RELEASE_SHA=" + baseline.ACCEPTED_SHA, "PRIVATE_VALUE=never_print"],
              "Labels": {"arthello.release.sha": baseline.ACCEPTED_SHA,
                         "arthello.release.tree": baseline.ACCEPTED_TREE,
                         "arthello.release.run": baseline.ACCEPTED_RUN,
                         "org.opencontainers.image.revision": baseline.ACCEPTED_SHA,
                         "org.opencontainers.image.source-tree": baseline.ACCEPTED_TREE}}
    app = {"Id": baseline.ACCEPTED_APP_ID, "Name": baseline.ACCEPTED_NAME,
           "Image": baseline.ACCEPTED_IMAGE, "Config": copy.deepcopy(config),
           "State": {"Running": True, "Paused": False, "Restarting": False},
           "HostConfig": {"ReadonlyRootfs": True},
           "Mounts": [{"Type": "volume", "Name": baseline.DATA_VOLUME, "Destination": "/data", "RW": True},
                      {"Type": "volume", "Name": "arthello-v52-backup-control-34326582961-1",
                       "Destination": "/var/lib/arthello-v52-backup-control", "RW": False}]}
    image = {"Id": baseline.ACCEPTED_IMAGE, "Config": config}
    return app, image


class BaselineTests(unittest.TestCase):
    def test_exact_accepted_runtime_is_required_without_rejecting_its_backup_mount(self):
        app, image = accepted()
        result = baseline.validate_live([baseline.ACCEPTED_APP_ID], app, image)
        self.assertEqual(result["containerId"], baseline.ACCEPTED_APP_ID)
        self.assertEqual(result["browserAcceptance"], "not_run")
        self.assertNotIn("never_print", json.dumps(result))
        for change in ("old_source", "other_container", "other_image", "wrong_data", "paused", "duplicate_source"):
            changed_app, changed_image = accepted()
            if change == "old_source":
                changed_app["Config"]["Labels"]["arthello.release.sha"] = "e" * 40
            elif change == "other_container":
                changed_app["Id"] = "f" * 64
            elif change == "other_image":
                changed_app["Image"] = "sha256:" + "f" * 64
            elif change == "wrong_data":
                changed_app["Mounts"][0]["Name"] = "other-data"
            elif change == "paused":
                changed_app["State"]["Paused"] = True
            else:
                changed_app["Config"]["Env"].append("RELEASE_SHA=" + baseline.ACCEPTED_SHA)
            with self.subTest(change=change), self.assertRaises(ValueError):
                baseline.validate_live([baseline.ACCEPTED_APP_ID], changed_app, changed_image)

    def test_live_observation_uses_only_inventory_and_inspection_and_rechecks_selection(self):
        app, image = accepted()
        calls = []
        inventory = ["container", "ls", "--quiet", "--no-trunc", "--filter", "name=^/arthello-direct-"]
        def read(arguments):
            calls.append(arguments)
            if arguments == inventory:
                return baseline.ACCEPTED_APP_ID + "\n"
            if arguments == ["container", "inspect", baseline.ACCEPTED_APP_ID]:
                return json.dumps([app])
            if arguments == ["image", "inspect", baseline.ACCEPTED_IMAGE]:
                return json.dumps([image])
            raise AssertionError("unexpected Docker operation")
        baseline.observe_live(read)
        self.assertEqual(calls, [inventory, ["container", "inspect", baseline.ACCEPTED_APP_ID],
                                 ["image", "inspect", baseline.ACCEPTED_IMAGE], inventory,
                                 ["container", "inspect", baseline.ACCEPTED_APP_ID]])
        count = 0
        def switched(arguments):
            nonlocal count
            if arguments == inventory:
                count += 1
                if count == 2:
                    return "f" * 64 + "\n"
            return read(arguments)
        with self.assertRaises(ValueError):
            baseline.observe_live(switched)
        for identities in ([], [baseline.ACCEPTED_APP_ID, "f" * 64], ["f" * 64]):
            with self.subTest(identities=identities), self.assertRaises(ValueError):
                baseline.validate_live(identities, app, image)

    def test_same_container_is_revalidated_after_final_inventory(self):
        for change in ("Paused", "Restarting", "Running"):
            app, image = accepted()
            inventory_calls = 0
            def read(arguments):
                nonlocal inventory_calls
                if arguments[:2] == ["container", "ls"]:
                    inventory_calls += 1
                    if inventory_calls == 2:
                        app["State"][change] = change != "Running"
                    return baseline.ACCEPTED_APP_ID + "\n"
                if arguments[:2] == ["container", "inspect"]:
                    return json.dumps([app])
                return json.dumps([image])
            with self.subTest(change=change), self.assertRaises(ValueError):
                baseline.observe_live(read)

    def test_school_diagnostic_requires_the_accepted_school_image_and_one_healthy_identity(self):
        identity = {"release": baseline.SCHOOL_SHA, "imageId": baseline.SCHOOL_IMAGE, "health": "healthy"}
        source = "SCHOOL_SSO_DIAGNOSTIC_BEGIN\n" + json.dumps(identity) + "\n"
        self.assertEqual(baseline.validate_school(source)["sourceSha"], baseline.SCHOOL_SHA)
        for content in (source + json.dumps(identity), "{}", json.dumps({**identity, "release": "f" * 40}),
                        json.dumps({**identity, "imageId": "sha256:" + "f" * 64}),
                        json.dumps({**identity, "health": "unhealthy"})):
            with self.subTest(content=content), self.assertRaises(ValueError):
                baseline.validate_school(content)

    def test_duplicate_school_identity_keys_cannot_hide_a_foreign_value(self):
        valid = json.dumps({"release": baseline.SCHOOL_SHA, "imageId": baseline.SCHOOL_IMAGE, "health": "healthy"})
        duplicate = '{"release":"' + "f" * 40 + '",' + valid[1:]
        for content in (duplicate, duplicate + "\n" + valid):
            with self.subTest(content=content), self.assertRaises(ValueError):
                baseline.validate_school(content)

    def test_cli_failure_does_not_expose_docker_or_file_content(self):
        output = io.StringIO()
        with patch.object(baseline, "observe_live", side_effect=RuntimeError("never_print_private")):
            with contextlib.redirect_stdout(output):
                code = baseline.main(["live"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue()), {"kind": "r14-live-identity", "result": "blocked", "reason": "identity_mismatch"})


if __name__ == "__main__":
    unittest.main()
