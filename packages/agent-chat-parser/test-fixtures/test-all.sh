#!/bin/bash
# ============================================================================
# Agent Chat Parser Integration Test Runner
#
# Symlinks test fixtures to the paths each parser expects, builds the project,
# runs the test harness, then cleans up — restoring any pre-existing data.
#
# Usage:  bash test-fixtures/test-all.sh
#         (run from the agent-chat-parser root directory)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOME_DIR="$HOME"

# Track what we've set up so cleanup runs even on error
CLEANUP_ACTIONS=()

cleanup() {
  echo ""
  echo "─── Cleanup ───────────────────────────────────────────────────"
  for action in "${CLEANUP_ACTIONS[@]:-}"; do
    eval "$action" 2>/dev/null || true
  done
  echo "Cleanup complete."
}

trap cleanup EXIT

# Helper: create a symlink, backing up any existing target
# Usage: safe_symlink <source> <destination>
safe_symlink() {
  local src="$1"
  local dst="$2"
  local parent
  parent="$(dirname "$dst")"

  mkdir -p "$parent"

  if [ -L "$dst" ]; then
    # Existing symlink — save and remove
    local backup="${dst}.test-backup-link"
    local target
    target="$(readlink "$dst")"
    echo "$target" > "$backup"
    rm -f "$dst"
    CLEANUP_ACTIONS+=("rm -f '$dst'; if [ -f '${backup}' ]; then ln -sfn \"\$(cat '${backup}')\" '$dst'; rm -f '${backup}'; fi")
  elif [ -d "$dst" ]; then
    # Existing directory — rename
    mv "$dst" "${dst}.test-backup"
    CLEANUP_ACTIONS+=("rm -f '$dst'; if [ -d '${dst}.test-backup' ]; then mv '${dst}.test-backup' '$dst'; fi")
  elif [ -f "$dst" ]; then
    # Existing file — backup
    cp "$dst" "${dst}.test-backup"
    CLEANUP_ACTIONS+=("rm -f '$dst'; if [ -f '${dst}.test-backup' ]; then mv '${dst}.test-backup' '$dst'; fi")
  else
    # Nothing exists — just remove on cleanup
    CLEANUP_ACTIONS+=("rm -f '$dst'")
  fi

  ln -sfn "$src" "$dst"
  echo "  ✓ $(basename "$dst") → $(basename "$src")"
}

# Helper: copy a file, backing up existing
safe_copy() {
  local src="$1"
  local dst="$2"
  local parent
  parent="$(dirname "$dst")"

  mkdir -p "$parent"

  if [ -f "$dst" ] && [ ! -L "$dst" ]; then
    cp "$dst" "${dst}.test-backup"
    CLEANUP_ACTIONS+=("rm -f '$dst'; if [ -f '${dst}.test-backup' ]; then mv '${dst}.test-backup' '$dst'; fi")
  else
    CLEANUP_ACTIONS+=("rm -f '$dst'")
  fi

  cp "$src" "$dst"
  echo "  ✓ $(basename "$dst") (copied)"
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Agent Chat Parser Integration Test Runner                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Build ────────────────────────────────────────────────────────────

echo "─── Build ─────────────────────────────────────────────────────"
cd "$CLI_DIR"
if ! npx tsc -b 2>&1; then
  echo "❌ Build failed. Fix TypeScript errors before testing."
  exit 1
fi
echo "  ✓ Build succeeded"
echo ""

# ── Step 2: Symlink fixtures ────────────────────────────────────────────────

echo "─── Symlinking fixtures ──────────────────────────────────────"

# AMP: ~/.local/share/amp/threads/
safe_symlink "$SCRIPT_DIR/amp/threads" "$HOME_DIR/.local/share/amp/threads"

# KIRO: ~/Library/Application Support/Kiro/workspace-sessions/
safe_symlink "$SCRIPT_DIR/kiro/workspace-sessions" "$HOME_DIR/Library/Application Support/Kiro/workspace-sessions"

# CRUSH: ~/.crush/crush.db (file copy — sqlite3 doesn't like symlinked DBs on all platforms)
safe_copy "$SCRIPT_DIR/crush/crush.db" "$HOME_DIR/.crush/crush.db"

# CLINE: VS Code globalStorage
CLINE_DIR="$HOME_DIR/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev"
safe_symlink "$SCRIPT_DIR/cline/tasks" "$CLINE_DIR/tasks"

# ROO CODE
ROO_DIR="$HOME_DIR/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline"
safe_symlink "$SCRIPT_DIR/roo-code/tasks" "$ROO_DIR/tasks"

# KILO CODE
KILO_DIR="$HOME_DIR/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code"
safe_symlink "$SCRIPT_DIR/kilo-code/tasks" "$KILO_DIR/tasks"

# ANTIGRAVITY: ~/.gemini/antigravity/code_tracker/test-project
# Copy (not symlink) because listSubdirectories uses Dirent.isDirectory()
# which returns false for symlinks — only real directories are discovered.
ANTI_DIR="$HOME_DIR/.gemini/antigravity/code_tracker/test-project"
if [ -d "$ANTI_DIR" ] && [ ! -L "$ANTI_DIR" ]; then
  mv "$ANTI_DIR" "${ANTI_DIR}.test-backup"
  CLEANUP_ACTIONS+=("rm -rf '$ANTI_DIR'; if [ -d '${ANTI_DIR}.test-backup' ]; then mv '${ANTI_DIR}.test-backup' '$ANTI_DIR'; fi")
else
  CLEANUP_ACTIONS+=("rm -rf '$ANTI_DIR'")
fi
cp -r "$SCRIPT_DIR/antigravity/code_tracker/test-project" "$ANTI_DIR"
echo "  ✓ test-project (copied dir)"

echo ""

# ── Step 3: Run test harness ────────────────────────────────────────────────

echo "─── Running test harness ─────────────────────────────────────"
cd "$CLI_DIR"
node test-fixtures/test-harness.mjs
TEST_EXIT=$?

echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo "🎉 All integration tests passed!"
else
  echo "⚠️  Some tests failed (exit code: $TEST_EXIT)"
fi

# Cleanup runs via trap
exit $TEST_EXIT
