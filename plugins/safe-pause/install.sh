#!/usr/bin/env bash
# Install safe-pause v2 — Claude Code MCP integration for subscription usage monitoring.
# Installs:
#   1. MCP integration  → ~/Library/Application Support/Claude/Claude Extensions/
#   2. PreToolUse hook  → ~/.claude/settings.json
#   3. Config + state   → ~/.claude/safeclaude/
#   4. Slash command    → ~/.claude/commands/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$HOME/.claude/safeclaude"
SETTINGS="$HOME/.claude/settings.json"
COMMANDS_DIR="$HOME/.claude/commands"

# Claude Extensions directory (Claude Desktop / Claude Code)
if [[ "$(uname)" == "Darwin" ]]; then
  EXT_BASE="$HOME/Library/Application Support/Claude/Claude Extensions"
else
  EXT_BASE="$HOME/.config/Claude/Claude Extensions"
fi
EXT_DIR="$EXT_BASE/com.claudeskills.safe-pause"

echo "Installing safe-pause..."

# node required for MCP server
if ! command -v node &>/dev/null; then
  echo "ERROR: node is required (>=18). Install via https://nodejs.org or: brew install node"
  exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install: brew install jq"
  exit 1
fi

# ── 1. MCP integration ────────────────────────────────────────────────────
mkdir -p "$EXT_DIR/server"
cp "$SCRIPT_DIR/manifest.json" "$EXT_DIR/manifest.json"
cp "$SCRIPT_DIR/server/index.js" "$EXT_DIR/server/index.js"
chmod +x "$EXT_DIR/server/index.js"
echo "  Integration: $EXT_DIR"

# ── 2. State dir + config ─────────────────────────────────────────────────
mkdir -p "$STATE_DIR"
if [[ -f "$STATE_DIR/config.json" ]]; then
  echo "  Config:      already exists, skipping ($STATE_DIR/config.json)"
else
  cp "$SCRIPT_DIR/config.default.json" "$STATE_DIR/config.json"
  echo "  Config:      $STATE_DIR/config.json"
fi

# ── 3. PreToolUse hook ────────────────────────────────────────────────────
cp "$SCRIPT_DIR/hooks/check-usage.sh" "$STATE_DIR/check-usage.sh"
chmod +x "$STATE_DIR/check-usage.sh"
echo "  Hook:        $STATE_DIR/check-usage.sh"

if [[ ! -f "$SETTINGS" ]]; then
  printf '{"hooks":{"PreToolUse":[]}}\n' > "$SETTINGS"
fi

if jq -e '.hooks.PreToolUse[]? | select(.hooks[]?.command? | test("check-usage.sh"))' "$SETTINGS" &>/dev/null; then
  echo "  Hook already registered in settings.json, skipping"
else
  HOOK_ENTRY=$(printf '{"matcher":".*","hooks":[{"type":"command","command":"%s"}]}' "$STATE_DIR/check-usage.sh")
  PATCHED=$(jq \
    --argjson entry "$HOOK_ENTRY" \
    '.hooks.PreToolUse = ((.hooks.PreToolUse // []) + [$entry])' \
    "$SETTINGS")
  printf '%s\n' "$PATCHED" > "$SETTINGS"
  echo "  Registered PreToolUse hook in settings.json"
fi

# ── 4. Register MCP server in Claude Code settings ────────────────────────
if jq -e '.mcpServers."safe-pause"' "$SETTINGS" &>/dev/null; then
  echo "  MCP server already in settings.json, skipping"
else
  PATCHED=$(jq \
    --arg cmd "node" \
    --arg arg "$EXT_DIR/server/index.js" \
    '.mcpServers["safe-pause"] = {"command": $cmd, "args": [$arg]}' \
    "$SETTINGS")
  printf '%s\n' "$PATCHED" > "$SETTINGS"
  echo "  Registered MCP server in settings.json"
fi

# ── 5. Slash command ──────────────────────────────────────────────────────
mkdir -p "$COMMANDS_DIR"
cp "$SCRIPT_DIR/commands/pause-ignore.toml" "$COMMANDS_DIR/pause-ignore.toml"
echo "  Command:     $COMMANDS_DIR/pause-ignore.toml"

echo ""
echo "Done. Restart Claude Code / Claude Desktop for changes to take effect."
echo ""
echo "NEXT STEP — provide credentials so usage can be fetched:"
echo ""
echo "  Option A — via Claude Code MCP tool (after restart):"
echo "    Ask Claude: 'Use set_credentials with org_id=... and session_key=...'"
echo ""
echo "  Option B — manually edit the config:"
echo "    $STATE_DIR/config.json"
echo ""
echo "  How to find your credentials:"
echo "    1. Open https://claude.ai in your browser"
echo "    2. DevTools → Application → Cookies → claude.ai → copy 'sessionKey'"
echo "    3. DevTools → Network → any /api/organizations/... request → copy the UUID from the URL"
echo ""
echo "Config:   $STATE_DIR/config.json"
echo "Command:  /pause-ignore [duration]  — bypass checks temporarily"
