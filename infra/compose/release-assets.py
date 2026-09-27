#!/usr/bin/env python3
"""Build the two public installers from a release's exact Git commit."""
import argparse
from pathlib import Path
import re
import subprocess

DEVELOPMENT_BASE = "https://raw.githubusercontent.com/shadynafie/engaz/main/infra/compose"


def render(name, source, version, commit):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", version) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Use a stable vX.Y.Z version and a full source commit.")
    marker = 'readonly RELEASE_VERSION=""' if name == "install-images.sh" else "$ReleaseVersion = ''"
    replacement = f'readonly RELEASE_VERSION="{version}"' if name == "install-images.sh" else f"$ReleaseVersion = '{version}'"
    if source.count(DEVELOPMENT_BASE) != 1 or source.count(marker) != 1:
        raise ValueError(f"Release installer template changed: {name}")
    return source.replace(DEVELOPMENT_BASE, DEVELOPMENT_BASE.replace("/main/", f"/{commit}/"), 1).replace(marker, replacement, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("commit")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", args.version) or not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("Use a stable version and a full source commit.")
    tagged = subprocess.run(["git", "rev-parse", f"{args.version}^{{commit}}"],
                            check=True, capture_output=True, text=True).stdout.strip()
    if tagged != args.commit:
        parser.error("Version tag and source commit do not match.")
    assets = {}
    for name in ("install-images.sh", "install.ps1"):
        source = subprocess.run(["git", "show", f"{args.commit}:infra/compose/{name}"],
                                check=True, capture_output=True, text=True).stdout
        assets[name] = render(name, source, args.version, args.commit)
    args.output.mkdir(parents=True, exist_ok=True)
    if any((args.output / name).exists() for name in assets):
        raise ValueError("Refusing to replace existing release assets.")
    for name, content in assets.items():
        destination = args.output / name
        destination.write_text(content)


if __name__ == "__main__":
    main()
