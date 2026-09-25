#!/usr/bin/env bash
# ============================================================================
# Antigravity Custom (SX Core SDK) Linux Installer
# ============================================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================="
echo " ⚡ Antigravity Custom (SX Core SDK) Linux Kurulumu ⚡"
echo "======================================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "✕ Node.js bulunamadı!"
    echo "Lütfen sisteminize Node.js kurun:"
    echo "  Ubuntu/Debian: sudo apt update && sudo apt install -y nodejs npm"
    echo "  Fedora:        sudo dnf install -y nodejs npm"
    echo "  Arch:          sudo pacman -S nodejs npm"
    exit 1
fi

chmod +x installer.js 2>/dev/null || true
node installer.js "$@"
