---
name: safe-pause
description: >
  Pauses Claude Code when subscription usage (five_hour or seven_day utilization) 
  crosses a configured threshold. Prevents burning remaining quota mid-task.
  Activate with /pause-ignore to bypass temporarily.
---

# safe-pause

Watches your Claude.ai **subscription usage** (not context window) and blocks tool 
calls when utilization crosses a threshold.

## Architecture

```
MCP server (server/index.js — Node.js, zero npm deps)
  └─ polls claude.ai /api/organizations/{orgId}/usage every 60s
       └─ writes ~/.claude/safeclaude/usage.json
            └─ PreToolUse hook (check-usage.sh) reads it → warn/block
```

No browser extension needed. The MCP server fetches usage directly using your
stored `session_key` cookie and `org_id`.

## Install

```bash
./install.sh
```

Then set your credentials once after Claude Code restarts:

```
# Ask Claude in Claude Code:
Use set_credentials with org_id="<uuid>" and session_key="<value>"
```

Or edit `~/.claude/safeclaude/config.json` directly.

**Finding credentials:**
1. Open https://claude.ai in your browser
2. DevTools → Application → Cookies → claude.ai → copy `sessionKey`
3. DevTools → Network → any `/api/organizations/...` request → copy the UUID from the URL

## Commands

- `/pause-ignore` — suppress checks for 5 hours (default)
- `/pause-ignore 2h` — suppress for 2 hours
- `/pause-ignore 30m` — suppress for 30 minutes

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_usage` | Return current utilization from cache (or fetch if stale) |
| `refresh_usage` | Force-fetch fresh data from claude.ai API |
| `set_credentials` | Store `org_id` + `session_key` in config |

## Config

Edit `~/.claude/safeclaude/config.json`:

```json
{
  "warn_at_percent": 75,
  "pause_at_percent": 90,
  "org_id": "your-org-uuid",
  "session_key": "your-session-key"
}
```

## Manual usage check

```bash
cat ~/.claude/safeclaude/usage.json | \
  jq '{five_hour: .five_hour.utilization, seven_day: .seven_day.utilization}'
```

## Uninstall

```bash
./uninstall.sh
```
