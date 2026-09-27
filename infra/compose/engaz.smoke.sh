#!/usr/bin/env bash
# Offline lifecycle/recovery checks; no Docker daemon required.
set -euo pipefail
python3 -B "$(cd "$(dirname "$0")" && pwd)/engaz_test.py"
