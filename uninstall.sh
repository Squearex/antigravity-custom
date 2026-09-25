#!/usr/bin/env bash
# ============================================================================
# Antigravity Custom (SX Core SDK) Linux Uninstaller
# ============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================="
echo " Antigravity Custom (SX Core SDK) Linux Kaldirma"
echo "======================================================="

node installer.js --uninstall
