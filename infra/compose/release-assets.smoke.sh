#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
python3 - "$root" <<'PY'
import importlib.util
from pathlib import Path
import sys
root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("release_assets", root / "release-assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)
for name in ("install-images.sh", "install.ps1"):
    source = (root / name).read_text()
    result = assets.render(name, source, "v0.1.9", "a" * 40)
    assert assets.DEVELOPMENT_BASE not in result
    assert "/" + "a" * 40 + "/infra/compose" in result
    assert "v0.1.9" in result
    try:
        assets.render(name, source, "v0.1.9-rc.1", "a" * 40)
    except ValueError:
        pass
    else:
        raise AssertionError("prerelease installer accepted")
assert '$InstallerBase/install.ps1' in (root / "install.ps1").read_text()
assert '$InstallerBase/install-images.sh' in (root / "install.ps1").read_text()
print("ok: release installers freeze the source and resume the same release")
PY
