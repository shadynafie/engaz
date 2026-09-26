"""Offline checks for recovery and data-preservation boundaries."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("engaz_operator", str(Path(__file__).with_name("engaz")))
spec = importlib.util.spec_from_loader(loader.name, loader)
engaz = importlib.util.module_from_spec(spec)
loader.exec_module(engaz)


def archive(path, name="./bots/example/note.txt", kind=tarfile.REGTYPE, link=""):
    with tarfile.open(path, "w") as tar:
        entry = tarfile.TarInfo(name)
        entry.type = kind
        entry.linkname = link
        content = b"agent file"
        entry.size = len(content) if kind == tarfile.REGTYPE else 0
        tar.addfile(entry, io.BytesIO(content) if entry.size else None)


def config(root):
    result = {"name": "engaz", "services": {
        "api": {"image": "example/app:edge", "volumes": [{"target": "/data", "type": "bind", "source": str(root / "appdata")}]},
        "postgres": {"image": "postgres:16", "volumes": [{"target": "/var/lib/postgresql/data", "type": "bind", "source": str(root / "postgres")}]},
        "computer": {"image": "example/computer:edge"},
    }}
    for service in ("worker", "supervisor", "data-init"):
        result["services"][service] = {"image": "example/app:edge", "volumes": [{"target": "/data", "type": "bind", "source": str(root / "appdata") }]}
    return result


class RecoveryChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".env").write_text("KEY=original-secret\n")
        (self.root / engaz.BASE).write_text("services: {}\n")
        (self.root / engaz.OVERLAY).write_text("services: {}\n")

    def install(self):
        with patch.object(engaz.Install, "compose", return_value=json.dumps(config(self.root))), \
             patch.object(engaz.Install, "containers", return_value=[]):
            return engaz.Install(self.root)

    def backup_fixture(self):
        root = self.root / "backup"
        root.mkdir()
        for name in (".env", engaz.BASE, engaz.OVERLAY, engaz.PINNED, "database.dump"):
            (root / name).write_text("fixture\n")
        archive(root / "appdata.tar")
        files = {p.name: engaz.digest(p) for p in root.iterdir()}
        (root / "backup.json").write_text(json.dumps({"format": 1, "project": "engaz", "files": files}))
        return root

    def test_archive_rejects_escapes_and_special_files(self):
        path = self.root / "data.tar"
        for name, kind, link in [("../escape", tarfile.REGTYPE, ""),
                                 ("/escape", tarfile.REGTYPE, ""),
                                 ("pipe", tarfile.FIFOTYPE, ""),
                                 ("link", tarfile.LNKTYPE, "/escape")]:
            with self.subTest(name=name, kind=kind, link=link):
                archive(path, name, kind, link)
                with self.assertRaises(ValueError):
                    engaz.validate_tar(path)
        archive(path)
        engaz.validate_tar(path)

    def test_leaf_symlinks_survive_without_allowing_archive_traversal(self):
        path = self.root / "links.tar"

        def entries(items):
            with tarfile.open(path, "w") as tar:
                for name, kind, link in items:
                    entry = tarfile.TarInfo(name)
                    entry.type, entry.linkname = kind, link
                    tar.addfile(entry)

        entries([("venv/bin/python", tarfile.SYMTYPE, "/usr/bin/python3"),
                 ("browser/SingletonLock", tarfile.SYMTYPE, "test-host-123")])
        engaz.validate_tar(path)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.REGTYPE):
            parent = ("escape", kind, "/outside" if kind == tarfile.SYMTYPE else "regular")
            child = ("escape/child", tarfile.REGTYPE, "")
            for items in ([parent, child, ("regular", tarfile.REGTYPE, "")],
                          [child, parent, ("regular", tarfile.REGTYPE, "")]):
                with self.subTest(kind=kind, order=items[0][0]):
                    entries(items)
                    with self.assertRaises(ValueError):
                        engaz.validate_tar(path)
        entries([("regular", tarfile.REGTYPE, ""), ("hardlink", tarfile.LNKTYPE, "regular")])
        engaz.validate_tar(path)
        for target in ("missing", "symlink", "directory", "../regular", "/regular"):
            with self.subTest(hardlink=target):
                entries([("regular", tarfile.REGTYPE, ""), ("symlink", tarfile.SYMTYPE, "regular"),
                         ("directory", tarfile.DIRTYPE, ""), ("hardlink", tarfile.LNKTYPE, target)])
                with self.assertRaises(ValueError):
                    engaz.validate_tar(path)

    def test_backup_corruption_and_symlinks_fail_before_restore_mutates(self):
        root = self.backup_fixture()
        engaz.validate_backup(root)
        (root / ".env").write_text("corrupted\n")
        with patch.object(engaz, "docker") as docker:
            args = type("Args", (), {"backup": str(root), "to": str(self.root / "restore"), "project": "fresh"})()
            with self.assertRaisesRegex(ValueError, "checksum"):
                engaz.restore(args)
            docker.assert_not_called()
            self.assertFalse((self.root / "restore").exists())
        (root / ".env").unlink()
        (root / ".env").symlink_to(self.root / ".env")
        with self.assertRaisesRegex(ValueError, "checksum"):
            engaz.validate_backup(root)

    def test_restore_rejects_existing_computer_runtime_before_target_writes(self):
        backup = self.backup_fixture()
        target = self.root / "restored"
        args = type("Args", (), {"backup": str(backup), "to": str(target), "project": "recovered"})()
        for resource in ("labeled", "legacy", "network"):
            def docker(*argv, **kwargs):
                if resource == "labeled" and "label=engaz.botId" in argv:
                    return "original-computer\n"
                if resource == "legacy" and "name=^/engaz-bot-" in argv:
                    return "legacy-computer\n"
                if resource == "network" and argv[:2] == ("network", "ls"):
                    return "engaz-computer-original\n"
                return ""
            with self.subTest(resource=resource), patch.object(engaz, "docker", side_effect=docker):
                with self.assertRaisesRegex(ValueError, "without existing Engaz computers"):
                    engaz.restore(args)
                self.assertFalse(target.exists())

    def test_storage_identity_rejects_moved_or_redirected_installation(self):
        self.install()
        original = json.loads((self.root / engaz.STATE).read_text())
        changed = config(self.root)
        for service in ("api", "worker", "supervisor", "data-init"):
            changed["services"][service]["volumes"][0]["source"] = str(self.root / "other-data")
        with patch.object(engaz.Install, "compose", return_value=json.dumps(changed)), \
             patch.object(engaz.Install, "containers", return_value=[]):
            with self.assertRaisesRegex(ValueError, "Storage identity changed"):
                engaz.Install(self.root)

        self.assertEqual(json.loads((self.root / engaz.STATE).read_text()), original)
        original["directory"] = str(self.root / "old-folder")
        (self.root / engaz.STATE).write_text(json.dumps(original))
        with patch.object(engaz.Install, "compose", return_value=""), \
             self.assertRaisesRegex(ValueError, "Installation moved"):
            engaz.Install(self.root)

    def test_restore_rejects_running_source_and_incompatible_filesystem(self):
        args = type("Args", (), {"backup": str(self.backup_fixture()), "to": str(self.root / "restore"),
                                "project": "fresh", "web_port": 7791, "api_port": 7792})()
        def docker(*argv, **kwargs):
            if "label=com.docker.compose.service" in argv:
                return "source-api\n"
            if argv[0] == "inspect":
                return json.dumps([{"Config": {"Env": ["SANDBOX_SUPERVISOR_URL=http://supervisor:7091"]}}])
            return ""
        with patch.object(engaz, "docker", side_effect=docker):
            with self.assertRaisesRegex(ValueError, "Stop existing Engaz"):
                engaz.restore(args)
        self.assertFalse(Path(args.to).exists())
        install = self.install()
        def helper(*argv, **kwargs):
            if "-df" in argv:
                raise subprocess.CalledProcessError(1, ["tar"])
        with patch.object(engaz, "docker", return_value=""), patch.object(engaz, "Install", return_value=install), \
             patch.object(install, "compose") as compose, patch.object(install, "helper", side_effect=helper), \
             patch.object(install, "start") as start:
            with self.assertRaisesRegex(ValueError, "could not preserve"):
                engaz.restore(args)
            start.assert_not_called()
            self.assertIn(("stop", "-t", "60"), [call.args for call in compose.call_args_list])

    def test_shell_cannot_override_storage_or_images_at_first_enrollment(self):
        (self.root / engaz.BASE).write_text('image: ${POSTGRES_IMAGE:-postgres:16}\napp: ${ENGAZ_IMAGE}\n')
        (self.root / engaz.OVERLAY).write_text('source: ${ENGAZ_DATA_DIR}\n')
        spoofed = {"ENGAZ_DATA_DIR": "/other-data", "POSTGRES_IMAGE": "untrusted/image",
                   "ENGAZ_IMAGE": "untrusted/app", "KEY": "shell-secret",
                   "COMPOSE_PROJECT_NAME": "other-project", "DOCKER_HOST": "unix:///test-daemon.sock"}
        with patch.dict(os.environ, spoofed):
            install = self.install()
        for key in spoofed.keys() - {"DOCKER_HOST"}:
            self.assertNotIn(key, install.env)
        self.assertEqual(install.env["DOCKER_HOST"], spoofed["DOCKER_HOST"])

    def test_existing_container_mount_mismatch_is_rejected(self):
        container = {"Config": {"Labels": {"com.docker.compose.service": "api"}},
                     "Mounts": [{"Destination": "/data", "Type": "bind", "Source": str(self.root / "different")}]}
        with patch.object(engaz.Install, "compose", return_value=json.dumps(config(self.root))), \
             patch.object(engaz.Install, "containers", return_value=[container]):
            with self.assertRaisesRegex(ValueError, "different storage"):
                engaz.Install(self.root)
        self.assertFalse((self.root / engaz.STATE).exists())

    def backup_operation(self, fail=False):
        install = self.install()
        events = []
        running = [{"Id": s + "-id", "Image": "sha256:" + "a" * 64, "Config": {"Labels": {"com.docker.compose.service": s}}} for s in ("api", "supervisor", "postgres")]

        def compose(*args, **kwargs):
            events.append(args)
            if args[0] == "ps":
                return "postgres-id\n"
            if args[0] == "exec" and "pg_dump" in args[-1]:
                if fail:
                    raise subprocess.CalledProcessError(1, ["pg_dump"])
                kwargs["stdout"].write(b"database fixture")

        def helper(*args, **kwargs):
            archive(Path(kwargs["stdout"].name))

        with patch.object(install, "containers", return_value=running), \
             patch.object(install, "bots", return_value=[]), \
             patch.object(install, "compose", side_effect=compose), \
             patch.object(install, "helper", side_effect=helper), \
             patch.object(engaz, "docker", return_value=json.dumps([{"RepoDigests": ["example/image@sha256:" + "a" * 64]}])) as docker, \
             contextlib.redirect_stdout(io.StringIO()):
            target = self.root / "recovery"
            if fail:
                with self.assertRaises(subprocess.CalledProcessError):
                    install.backup(target)
                self.assertFalse((target / "backup.json").exists())
            else:
                install.backup(target)
                engaz.validate_backup(target)
                self.assertEqual((target / ".env").read_text(), "KEY=original-secret\n")
                pins = json.loads((target / engaz.PINNED).read_text())["services"]
                self.assertEqual(pins["supervisor"]["environment"]["ENGAZ_COMPUTER_IMAGE"], pins["computer"]["image"])
                self.assertEqual(target.stat().st_mode & 0o777, 0o700)
                self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in target.iterdir()))
        self.assertIn(("start", "api-id", "supervisor-id"), [call.args for call in docker.call_args_list])
        self.assertFalse(any(event[0] == "start" for event in events))
        self.assertIn(("stop", "-t", "60", "api"), events)
        self.assertIn(("stop", "-t", "60", "supervisor"), events)

    def test_complete_backup_preserves_secrets_files_and_private_permissions(self):
        self.backup_operation()

    def test_failed_dump_resumes_original_services_without_complete_manifest(self):
        self.backup_operation(fail=True)

    def test_failed_image_pull_never_stops_or_changes_installation(self):
        install = self.install()
        before = (self.root / ".env").read_bytes()
        with patch.object(engaz, "fetch", side_effect=lambda url, **kw: {"sha": "a" * 40} if "/commits/" in url else "downloaded fixture"), \
             patch.object(engaz, "docker", side_effect=subprocess.CalledProcessError(1, ["docker", "pull"])), \
             patch.object(install, "backup") as backup, patch.object(install, "stopped") as stopped:
            with self.assertRaises(subprocess.CalledProcessError):
                engaz.update(install, "v1.2.3")
            backup.assert_not_called()
            stopped.assert_not_called()
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertEqual((self.root / engaz.BASE).read_text(), "services: {}\n")

    def test_latest_update_uses_numeric_stable_tags_across_pages(self):
        install = self.install()
        requested = []

        def fetch(url, **kwargs):
            requested.append(url)
            if url.endswith("page=1"):
                return [{"name": "v0.9.9"}] * 99 + [{"name": "v9.0.0-rc.1"}]
            if url.endswith("page=2"):
                return [{"name": "v0.10.2"}, {"name": "v0.10.1"}]
            raise ValueError("stop before downloading")

        with patch.object(engaz, "fetch", side_effect=fetch), patch.object(engaz, "docker") as docker:
            with self.assertRaisesRegex(ValueError, "stop before downloading"):
                engaz.update(install, None)
            docker.assert_not_called()
        self.assertEqual(requested[-1], engaz.REPO + "/commits/v0.10.2")
        self.assertEqual(len(requested), 3)

    def update_operation(self, fail=False):
        install = self.install()
        events = []
        backup_path = self.root / "backup"
        previous_images = {service: "example/previous@sha256:" + "b" * 64 for service in install.config["services"]}

        def backup(*args, **kwargs):
            self.assertFalse(kwargs.get("resume", True))
            self.assertEqual((self.root / ".env").read_text(), "KEY=original-secret\n")
            self.assertEqual((self.root / engaz.BASE).read_text(), "services: {}\n")
            backup_path.mkdir()
            (backup_path / engaz.PINNED).write_text(engaz.image_pins(previous_images))
            events.append("backup")
            return backup_path

        @contextlib.contextmanager
        def stopped(**kwargs):
            self.assertFalse(kwargs.get("resume", True))
            events.append("stop")
            yield

        def start():
            events.append("start")
            self.assertIn("ENGAZ_IMAGE_TAG=sha-" + "a" * 40, (self.root / ".env").read_text())
            images = json.loads((self.root / engaz.PINNED).read_text())["services"]
            expected = "example/image@sha256:" + "a" * 64
            self.assertTrue(all(images[service]["image"] == expected for service in ("api", "worker", "web", "supervisor", "computer")))
            self.assertEqual(images["supervisor"]["environment"]["ENGAZ_COMPUTER_IMAGE"], images["computer"]["image"])
            for service in ("data-init", "postgres"):
                self.assertEqual(images[service]["image"], previous_images[service])
            if fail:
                raise subprocess.CalledProcessError(1, ["compose", "up"])

        def docker(*args, **kwargs):
            if args[0] == "pull":
                events.append("pull")
            if args[0] == "image":
                return json.dumps([{"RepoDigests": ["example/image@sha256:" + "a" * 64]}])
            if args[0] == "stop":
                events.append("stop-services")

        with patch.object(engaz, "fetch", side_effect=lambda url, **kw: {"sha": "a" * 40} if "/commits/" in url else "downloaded fixture"), \
             patch.object(engaz, "docker", side_effect=docker), \
             patch.object(install, "backup", side_effect=backup), \
             patch.object(install, "stopped", side_effect=stopped), \
             patch.object(install, "refresh"), \
             patch.object(install, "start", side_effect=start), \
             patch.object(install, "bots", return_value=[]), \
             patch.object(install, "containers", return_value=[{"Id": "api-id", "Config": {"Labels": {"com.docker.compose.service": "api"}}}]), \
             patch.object(install, "compose"), contextlib.redirect_stdout(io.StringIO()):
            if fail:
                with self.assertRaisesRegex(ValueError, "application services are stopped"):
                    engaz.update(install, "v1.2.3")
                self.assertIn("stop-services", events)
                self.assertFalse((self.root / "engaz").exists())
            else:
                engaz.update(install, "v1.2.3")
                self.assertEqual((self.root / "engaz").stat().st_mode & 0o777, 0o755)
        self.assertLess(events.index("pull"), events.index("backup"))
        self.assertLess(events.index("backup"), events.index("start"))
        self.assertEqual(events.count("start"), 1)
        self.assertIn("KEY=original-secret", (self.root / ".env").read_text())

    def test_update_backs_up_before_replacing_configuration(self):
        self.update_operation()

    def test_failed_migration_start_stops_services_without_old_image_rollback(self):
        self.update_operation(fail=True)


if __name__ == "__main__":
    unittest.main()
