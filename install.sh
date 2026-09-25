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

# If not running as root, run installer and re-elevate if permission is needed
if [ "$EUID" -ne 0 ]; then
    set +e
    node installer.js "$@"
    EXIT_CODE=$?
    set -e
    if [ $EXIT_CODE -eq 13 ]; then
        echo "🔒 Yönetici yetkisi (sudo) gerekiyor. Şifrenizi girin:"
        sudo node installer.js "$@"
    elif [ $EXIT_CODE -ne 0 ]; then
        exit $EXIT_CODE
    fi
else
    node installer.js "$@"
fi
