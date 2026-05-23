#!/usr/bin/env bash
# Uninstall safe-pause
set -euo pipefail

STATE_DIR="$HOME/.claude/safeclaude"
SETTINGS="$HOME/.claude/settings.json"
CMD_DEST="$HOME/.claude/commands/pause-ignore.toml"

if [[ "$(uname)" == "Darwin" ]]; then
  EXT_DIR="$HOME/Library/Application Support/Claude/Claude Extensions/com.claudeskills.safe-pause"
else
  EXT_DIR="$HOME/.config/Claude/Claude Extensions/com.claudeskills.safe-pause"
fi

echo "Uninstalling safe-pause..."

# remove MCP integration files
if [[ -d "$EXT_DIR" ]]; then
  rm -rf "$EXT_DIR"
  echo "  Removed integration: $EXT_DIR"
fi

# remove hook file
if [[ -f "$STATE_DIR/check-usage.sh" ]]; then
  rm "$STATE_DIR/check-usage.sh"
  echo "  Removed: $STATE_DIR/check-usage.sh"
fi

# remove command
if [[ -f "$CMD_DEST" ]]; then
  rm "$CMD_DEST"
  echo "  Removed: $CMD_DEST"
fi

# patch out PreToolUse hook + mcpServers entry from settings.json
if [[ -f "$SETTINGS" ]] && command -v jq &>/dev/null; then
  PATCHED=$(jq '
    if .hooks.PreToolUse then
      .hooks.PreToolUse = [
        .hooks.PreToolUse[]
        | select(.hooks[]?.command? | test("check-usage.sh") | not)
      ]
    else . end
    | del(.mcpServers["safe-pause"])
  ' "$SETTINGS" 2>/dev/null || cat "$SETTINGS")
  printf '%s\n' "$PATCHED" > "$SETTINGS"
  echo "  Removed hook + MCP server from settings.json"
fi

echo ""
echo "Done. State preserved at: $STATE_DIR"
echo "To fully clean up: rm -rf \"$STATE_DIR\""
