#!/usr/bin/env python3
"""Real Docker backup/restore rehearsal for the isolated first-run image test.

Requires the fake owner created by e2e-image/first-run.spec.ts. Leaves both
installations and their data intact for browser verification. After backup,
it discards only verified stopped test computer runtime and its isolated networks
so the recovered installation cannot adopt the original agent homes.
"""
import argparse
import importlib.machinery
import importlib.util
import json
import re
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import uuid


SQL = '''SELECT json_build_object(
  'users', (SELECT count(*) FROM "user"),
  'fakeOwners', (SELECT count(*) FROM "user" WHERE email = 'owner@engaz.test'),
  'credentials', (SELECT count(*) FROM user_model_credentials),
  'bots', (SELECT coalesce(json_agg(json_build_object('botId', b.id, 'spaceId', b."spaceId") ORDER BY b.id), '[]'::json)
           FROM bots b JOIN "user" u ON b."userId" = u.id WHERE u.email = 'owner@engaz.test'),
  'bot', (SELECT json_build_object('botId', b.id, 'spaceId', b."spaceId")
          FROM bots b JOIN "user" u ON b."userId" = u.id
          WHERE u.email = 'owner@engaz.test' ORDER BY b."createdAt" LIMIT 1)
);'''


def load_cli(path):
    loader = importlib.machinery.SourceFileLoader("engaz_rehearsal", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def snapshot(install):
    # Pass SQL over stdin; neither secrets nor environment values appear in argv.
    with tempfile.TemporaryFile() as stream:
        stream.write(SQL.encode())
        stream.seek(0)
        output = install.compose("exec", "-T", "postgres", "sh", "-c",
            'exec psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" "$POSTGRES_DB"',
            stdin=stream, capture=True)
    return json.loads(output.strip())


def node(install, script):
    with tempfile.TemporaryFile() as stream:
        stream.write(script.encode())
        stream.seek(0)
        return install.compose("exec", "-T", "api", "node", "-", stdin=stream, capture=True)


def private_file(cli, install, relative, content, *, seed_from=None):
    storage = install.storage["api"]
    mount = f"type={storage['type']},src={storage['source']},dst=/data" + ("" if seed_from else ",readonly")
    script = 'set -eu; '
    if seed_from:
        script += 'cp "$3" "$1"; chown 0:0 "$1"; chmod 600 "$1"; '
    script += 'test "$(cat "$1")" = "$2"; '
    script += 'test "$(stat -c \'%u %a\' "$1")" = "0 600"'
    cli.docker("run", "--rm", "--network", "none", "--security-opt", "no-new-privileges:true",
        "--user", "0", "--mount", mount, "--entrypoint", "sh",
        install.config["services"]["postgres"]["image"], "-c", script, "check", "/data/" + relative, content,
        *(["/data/" + seed_from] if seed_from else []),
        capture=True)


def rehearse_update(cli, install):
    # This exercises candidate operator files on the current published binary. It does
    # not validate a newer released app or migrations between different versions.
    runtime = next(c for c in install.containers(running=True)
                   if c["Config"]["Labels"].get("com.docker.compose.service") == "api")
    info = json.loads(cli.docker("image", "inspect", runtime["Image"], capture=True))[0]
    revision = info["Config"]["Labels"].get("org.opencontainers.image.revision", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Current published application image lacks its full OCI source revision.")
    candidate = {name: (install.root / name).read_text() for name in (cli.BASE, cli.OVERLAY, "engaz")}
    before = snapshot(install)
    original_fetch = cli.fetch

    def metadata(url, **kwargs):
        if url == cli.REPO + "/commits/v0.0.0":
            return {"sha": revision}
        prefix = f"{cli.RAW}/{revision}/infra/compose/"
        if url.startswith(prefix) and url[len(prefix):] in candidate:
            return candidate[url[len(prefix):]]
        raise ValueError("Unexpected download in isolated update rehearsal.")

    cli.fetch = metadata
    try:
        with cli.lock(install.root):
            cli.update(install, "v0.0.0")
    finally:
        cli.fetch = original_fetch
    if snapshot(install) != before:
        raise ValueError("Owner, agent, or model credentials changed during candidate update rehearsal.")
    return {"sourceCommit": revision, "testOnlyVersion": "v0.0.0", "candidateFilesOnCurrentBinary": True}


def discard_test_computers(cli, install, expected_bots):
    """Discard scoped disposable test runtime, preserving all durable data."""
    storage = install.storage["api"]
    known = {(bot["botId"], bot["spaceId"]) for bot in expected_bots}
    # A team desktop shares the same fake owner's space and uses its deterministic identity.
    known.update(("team-" + bot["spaceId"], bot["spaceId"]) for bot in expected_bots)
    ids = cli.docker("ps", "-a", "-q", "--filter", "label=engaz.botId", capture=True).split()
    computers = json.loads(cli.docker("inspect", *ids, capture=True)) if ids else []
    scoped, networks = {}, set()
    for container in computers:
        home = next((m for m in container["Mounts"] if m["Destination"] == "/home/engaz"), None)
        if not home:
            continue
        matches = (storage["type"] == "volume" and home.get("Name") == storage["source"]) or (
            storage["type"] == "bind" and home["Type"] == "bind" and
            home["Source"].startswith(storage["source"] + "/homes/"))
        if not matches:
            continue
        labels = container["Config"]["Labels"]
        if (labels.get("engaz.botId"), labels.get("engaz.spaceId")) not in known or container["State"]["Running"]:
            raise ValueError("A source-mounted computer is not verified stopped fake-owner runtime.")
        scoped[container["Id"]] = container
        names = set(container["NetworkSettings"]["Networks"]) | {container["HostConfig"]["NetworkMode"]}
        networks.update(name for name in names if name.startswith("engaz-computer-"))
    detach = []
    # Validate every peer before deleting any computer or network.
    for name in sorted(networks):
        info = json.loads(cli.docker("network", "inspect", name, capture=True))[0]
        for peer in info.get("Containers", {}):
            if peer in scoped:
                continue
            container = json.loads(cli.docker("inspect", peer, capture=True))[0]
            labels = container["Config"]["Labels"]
            directory = labels.get("com.docker.compose.project.working_dir", "")
            if (labels.get("com.docker.compose.project") != install.project or not directory or
                Path(directory).resolve() != install.root or container["State"]["Running"]):
                raise ValueError("A computer network has a peer outside the stopped isolated source installation.")
            detach.append((name, peer))
    if scoped:
        cli.docker("rm", *scoped)
    for name, peer in detach:
        cli.docker("network", "disconnect", name, peer)
    for name in sorted(networks):
        cli.docker("network", "rm", name)


def command(cli, *args):
    subprocess.run([sys.executable, "-B", str(cli), *map(str, args)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-dir", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--rehearse-update", action="store_true", help="Exercise candidate operator files on the current published binary; no new release claim.")
    args = parser.parse_args()
    source, target = args.install_dir.resolve(), args.target.resolve()
    if source == target or source.parent != target.parent:
        raise ValueError("Use distinct sibling folders for the isolated restore rehearsal.")
    if target.exists() and any(target.iterdir()):
        raise ValueError("Recovery target must be empty.")
    cli_path = source / "engaz"
    cli = load_cli(cli_path)
    install = cli.Install(source)
    containers = install.containers(running=True)
    if not containers:
        raise ValueError("The isolated source installation must be running.")
    for container in containers:
        directory = container["Config"]["Labels"].get("com.docker.compose.project.working_dir")
        if not directory or Path(directory).resolve() != source:
            raise ValueError("A Compose container belongs to a different installation folder.")
    before = snapshot(install)
    if before["users"] != 1 or before["fakeOwners"] != 1 or not before["bot"] or before["credentials"] < 1:
        raise ValueError("Only the isolated first-run test with its fake owner and model connection is supported.")
    upgrade = rehearse_update(cli, install) if args.rehearse_update else None
    secrets = (source / ".env").read_bytes()
    bot = before["bot"]
    relative = f"homes/{bot['botId']}/lifecycle-probe.txt"
    content = "isolated-lifecycle-" + uuid.uuid4().hex
    script = '''const { mkdir } = require("node:fs/promises");
const bot = BOT;
const headers = {authorization: `Bearer ${process.env.SANDBOX_SUPERVISOR_TOKEN}`,
  "content-type": "application/json", "x-engaz-bot-id": bot.botId, "x-engaz-space-id": bot.spaceId};
async function call(path, body) {
  const response = await fetch(`http://supervisor:7091${path}`, {method: "POST", headers, body: JSON.stringify(body)});
  const json = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return json;
}
(async () => {
  const homePath = `/data/homes/${bot.botId}`;
  await mkdir(homePath, {recursive: true});
  const computer = await call("/computers", {...bot, homePath});
  const result = await call(`/computers/${computer.id}/exec`, {
    argv: ["sh", "-c", "printf '%s' CONTENT > /home/engaz/lifecycle-probe.txt"]});
  if (result.code !== 0) throw new Error("Agent file write failed");
})().catch(error => {console.error(error); process.exit(1)});
'''.replace("BOT", json.dumps(bot)).replace("CONTENT", content)
    node(install, script)
    # A separate private appdata file exercises archive permissions without making
    # the bot's writable home invalid. API cap_drop=ALL cannot read this probe.
    private_relative = "lifecycle-private-probe.txt"
    private_file(cli, install, private_relative, content, seed_from=relative)
    backup = source.parent / (source.name + "-backup-" + uuid.uuid4().hex[:8])
    command(cli_path, "backup", backup)
    with tarfile.open(backup / "appdata.tar") as archive:
        members = {m.name.removeprefix("./"): m for m in archive}
        private_member = members[private_relative]
        if private_member.uid != 0 or private_member.mode & 0o777 != 0o600:
            raise ValueError("Root-owned private appdata file metadata was not preserved.")
        for name in (relative, private_relative):
            if archive.extractfile(members[name]).read().decode() != content:
                raise ValueError("Agent or private appdata file content was not backed up.")
    project = install.project + "-recovered"
    command(cli_path, "stop")
    discard_test_computers(cli, install, before["bots"])
    command(cli_path, "restore", backup, "--to", target, "--project", project,
        "--web-port", install.resolved.get("ENGAZ_WEB_PORT", "7791"),
        "--api-port", install.resolved.get("ENGAZ_API_PORT", "7792"))
    restored = load_cli(target / "engaz").Install(target)
    if snapshot(restored) != before:
        raise ValueError("Owner, agent, or model credentials changed after restore.")
    private_file(cli, restored, private_relative, content)
    node(restored, f'''const fs=require("node:fs");
if(fs.readFileSync({json.dumps('/data/' + relative)},"utf8")!=={json.dumps(content)})
  throw new Error("Restored agent file differs");''')
    node(restored, script.replace("lifecycle-probe.txt", "restored-probe.txt"))
    restored_relative = f"homes/{bot['botId']}/restored-probe.txt"
    node(restored, f'''const fs=require("node:fs");
if(fs.readFileSync({json.dumps('/data/' + restored_relative)},"utf8")!=={json.dumps(content)})
  throw new Error("Restored computer is not writing to the recovered agent home");''')
    source_storage = install.storage["api"]
    source_mount = f"type={source_storage['type']},src={source_storage['source']},dst=/data,readonly"
    cli.docker("run", "--rm", "--network", "none", "--security-opt", "no-new-privileges:true",
        "--mount", source_mount, "--entrypoint", "sh", install.config["services"]["postgres"]["image"],
        "-c", 'test ! -e "$1"', "check", "/data/" + restored_relative, capture=True)
    if (source / ".env").read_bytes() != secrets or (backup / ".env").read_bytes() != secrets:
        raise ValueError("Original installation secrets were changed.")
    report = {"source": str(source), "target": str(target), "backup": str(backup),
              "project": project, "botId": bot["botId"], "agentFile": relative,
              "privateAppdataFile": private_relative,
              "restoredAgentFile": restored_relative,
              "ownerCount": before["users"], "credentialCount": before["credentials"], "updateRehearsal": upgrade}
    cli.atomic(source / "lifecycle-check.json", json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
