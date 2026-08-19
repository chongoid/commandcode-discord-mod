#!/usr/bin/env bash
# Self-contained whisper.cpp install for the Command Code Discord mod.
# Downloads a prebuilt whisper-cli binary + a GGML model so voice-message
# transcription works out of the box — with NO dependency on Hermes, Python,
# or any shared agent installation. Every mod user provisions their own STT
# stack via this script (or points WHISPER_BINARY / WHISPER_MODEL at an
# existing installation).
set -euo pipefail

WHISPER_VERSION="${WHISPER_VERSION:-v1.9.2}"
BASE_DIR="${WHISPER_DIR:-$HOME/.commandcode/whisper}"
BIN_DIR="$BASE_DIR/bin"
MODEL_DIR="$BASE_DIR/models"
MODEL_NAME="${WHISPER_MODEL_URL_NAME:-ggml-base.bin}"

echo "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓"
echo "┃  whisper.cpp install for Command Code Discord mod      ┃"
echo "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛"
echo "Install dir: $BASE_DIR"
echo "Version:     $WHISPER_VERSION"
echo "Model:       $MODEL_NAME"
echo ""

OS="$(uname -s)"
ARCH="$(uname -m)"

# Map (OS, arch) to a prebuilt whisper.cpp release asset.
case "$OS-$ARCH" in
  Linux-x86_64)  ASSET="whisper-bin-ubuntu-x64.tar.gz" ;;
  Linux-aarch64|Linux-arm64) ASSET="whisper-bin-ubuntu-arm64.tar.gz" ;;
  *) ASSET="" ;;
esac

if [[ "$OS" == "Darwin" ]]; then
  echo "✗ macOS: the official whisper.cpp release does not ship a macOS CLI binary."
  echo "  Install via Homebrew instead: brew install whisper-cpp"
  echo "  Then set in the mod's .env:"
  echo "    WHISPER_BINARY=$(brew --prefix 2>/dev/null)/bin/whisper-cli"
  echo "    WHISPER_MODEL=$MODEL_DIR/$MODEL_NAME"
  exit 1
fi

if [[ -z "$ASSET" ]]; then
  echo "✗ Unsupported platform $OS-$ARCH. Build whisper.cpp from source or set" \
        "WHISPER_BINARY + WHISPER_MODEL in the mod's .env." >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$MODEL_DIR"

BIN_URL="https://github.com/ggerganov/whisper.cpp/releases/download/$WHISPER_VERSION/$ASSET"
TMP_TAR="$(mktemp /tmp/whisper-XXXXXX.tar.gz)"
trap 'rm -f "$TMP_TAR"' EXIT

echo "1/2 Downloading whisper-cli binary ($ASSET) ..."
if ! curl -fsSL --retry 3 --max-time 300 -o "$TMP_TAR" "$BIN_URL"; then
  echo "✗ Failed to download $BIN_URL" >&2
  exit 1
fi

# Extract whisper-cli + shared libs into bin/. whisper-cli resolves its
# libggml*.so / libwhisper.so via rpath relative to itself, so keep them side
# by side in the same directory.
tar -xzf "$TMP_TAR" -C "$BIN_DIR" --strip-components=1
chmod +x "$BIN_DIR/whisper-cli" 2>/dev/null || true

if [[ ! -x "$BIN_DIR/whisper-cli" ]]; then
  echo "✗ whisper-cli binary not found after extraction. Inspect: $BIN_DIR" >&2
  ls -la "$BIN_DIR" || true
  exit 1
fi

echo "2/2 Downloading model ($MODEL_NAME, ~150 MB) ..."
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"
MODEL_TMP="$MODEL_DIR/.$MODEL_NAME.tmp"
if ! curl -fsSL --retry 3 --max-time 600 -o "$MODEL_TMP" "$MODEL_URL"; then
  echo "✗ Failed to download $MODEL_URL" >&2
  rm -f "$MODEL_TMP"
  exit 1
fi
mv "$MODEL_TMP" "$MODEL_DIR/$MODEL_NAME"

echo ""
echo "✓ Installed:"
echo "   Binary  $BIN_DIR/whisper-cli"
echo "   Model   $MODEL_DIR/$MODEL_NAME"
echo ""
echo "The mod auto-detects these defaults; no .env edits required. To verify:"
echo "   $BIN_DIR/whisper-cli --version"
echo ""
echo "Next: restart the bot so the runtime picks up the new binary."
echo "   systemctl --user restart commandcode-discord.service" 2>/dev/null || true
