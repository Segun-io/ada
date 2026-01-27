use std::fs::{self, Permissions};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use toml_edit::{Array, DocumentMut, value};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

pub struct AgentWrapperPaths {
    pub bin_dir: PathBuf,
    pub hooks_dir: PathBuf,
}

pub fn setup_agent_wrappers(ada_home: &Path) -> std::io::Result<AgentWrapperPaths> {
    let bin_dir = ada_home.join("bin");
    let hooks_dir = ada_home.join("hooks");
    let plugins_dir = ada_home.join("plugins");

    fs::create_dir_all(&bin_dir)?;
    fs::create_dir_all(&hooks_dir)?;
    fs::create_dir_all(&plugins_dir)?;

    // Create hook scripts for different agents
    create_claude_notify_hook(&hooks_dir)?;
    create_codex_notify_hook(&hooks_dir)?;
    create_gemini_notify_hook(&hooks_dir)?;
    create_cursor_notify_hook(&hooks_dir)?;
    create_opencode_plugin(&plugins_dir)?;

    // Ensure agent-specific configurations
    if let Err(err) = ensure_claude_settings(ada_home) {
        eprintln!("Warning: failed to ensure Claude settings: {err}");
    }
    if let Err(err) = ensure_codex_config(&hooks_dir) {
        eprintln!("Warning: failed to ensure Codex config: {err}");
    }
    if let Err(err) = ensure_gemini_settings(ada_home) {
        eprintln!("Warning: failed to ensure Gemini settings: {err}");
    }
    if let Err(err) = ensure_cursor_hooks(ada_home) {
        eprintln!("Warning: failed to ensure Cursor hooks: {err}");
    }
    if let Err(err) = ensure_opencode_plugin(&plugins_dir) {
        eprintln!("Warning: failed to ensure OpenCode plugin: {err}");
    }

    // Create wrappers for all supported agents
    create_agent_wrapper(&bin_dir, ada_home, "claude", AgentType::Claude)?;
    create_agent_wrapper(&bin_dir, ada_home, "codex", AgentType::Codex)?;
    create_agent_wrapper(&bin_dir, ada_home, "gemini", AgentType::Gemini)?;
    create_agent_wrapper(&bin_dir, ada_home, "cursor", AgentType::Cursor)?;
    create_opencode_wrapper(&bin_dir, ada_home, &plugins_dir)?;

    Ok(AgentWrapperPaths { bin_dir, hooks_dir })
}

#[derive(Clone, Copy)]
enum AgentType {
    Claude,
    Codex,
    Gemini,
    Cursor,
}

fn create_agent_wrapper(
    bin_dir: &Path,
    ada_home: &Path,
    command: &str,
    agent_type: AgentType,
) -> std::io::Result<()> {
    let ada_home_str = ada_home.to_string_lossy();
    let settings_block = match agent_type {
        AgentType::Claude => format!(r#"
SETTINGS_PATH="{ada_home_str}/claude-settings.json"
SETTINGS_ARGS=()
if [[ -f "$SETTINGS_PATH" ]]; then
    PYTHON_BIN=""
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="python3"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_BIN="python"
    fi

    if [[ -n "$PYTHON_BIN" ]]; then
        if "$PYTHON_BIN" - "$SETTINGS_PATH" <<'PY'
import json
import sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        json.load(handle)
except Exception:
    sys.exit(1)
PY
        then
            SETTINGS_ARGS=("--settings" "$SETTINGS_PATH")
        else
            TS=$(date +%s)
            mv "$SETTINGS_PATH" "$SETTINGS_PATH.bak.$TS" 2>/dev/null || true
            echo "Warning: invalid Claude settings JSON, running without hooks." >&2
        fi
    else
        SETTINGS_ARGS=("--settings" "$SETTINGS_PATH")
    fi
fi
"#),
        AgentType::Codex => r#"
SETTINGS_ARGS=()
"#.to_string(), // Codex uses config.toml, no wrapper injection needed
        AgentType::Gemini => r#"
# Gemini CLI uses .gemini/settings.json in the project directory
# We set up global settings at ~/.gemini/settings.json
SETTINGS_ARGS=()
"#.to_string(),
        AgentType::Cursor => r#"
# Cursor uses .cursor/hooks.json in the project directory
# We set up global hooks at ~/.cursor/hooks.json
SETTINGS_ARGS=()
"#.to_string(),
    };

    let wrapper = format!(
        r#"#!/bin/bash
# Ada wrapper for {command}

REAL_CMD=$(which -a {command} 2>/dev/null | grep -v "{ada_home_str}/bin" | head -1)

if [[ -z "$REAL_CMD" ]]; then
    for path in "$HOME/.local/bin/{command}" "/usr/local/bin/{command}" "/opt/homebrew/bin/{command}"; do
        if [[ -x "$path" ]]; then
            REAL_CMD="$path"
            break
        fi
    done
fi

if [[ -z "$REAL_CMD" ]]; then
    echo "Error: {command} not found" >&2
    exit 1
fi
{settings_block}
exec "$REAL_CMD" "${{SETTINGS_ARGS[@]}}" "$@"
"#
    );

    let path = bin_dir.join(command);
    fs::write(&path, wrapper)?;
    set_executable(&path)?;
    Ok(())
}

/// Create OpenCode wrapper
/// Note: OpenCode plugin is installed to ~/.config/opencode/plugins/ by ensure_opencode_plugin()
fn create_opencode_wrapper(bin_dir: &Path, ada_home: &Path, _plugins_dir: &Path) -> std::io::Result<()> {
    let ada_home_str = ada_home.to_string_lossy();
    let wrapper = format!(r#"#!/bin/bash
# Ada wrapper for opencode
# Plugin is installed to ~/.config/opencode/plugins/ada-notify.js

REAL_CMD=$(which -a opencode 2>/dev/null | grep -v "{ada_home_str}/bin" | head -1)

if [[ -z "$REAL_CMD" ]]; then
    for path in "$HOME/.local/bin/opencode" "/usr/local/bin/opencode" "/opt/homebrew/bin/opencode"; do
        if [[ -x "$path" ]]; then
            REAL_CMD="$path"
            break
        fi
    done
fi

if [[ -z "$REAL_CMD" ]]; then
    echo "Error: opencode not found" >&2
    exit 1
fi

exec "$REAL_CMD" "$@"
"#);

    let path = bin_dir.join("opencode");
    fs::write(&path, wrapper)?;
    set_executable(&path)?;
    Ok(())
}

/// Create notification hook for Claude Code (receives JSON on stdin)
/// Claude Code Hook Events (from https://code.claude.com/docs/en/hooks):
/// - SessionStart: Session begins or resumes
/// - UserPromptSubmit: User submits a prompt
/// - PreToolUse: Before tool execution
/// - PermissionRequest: When permission dialog appears
/// - PostToolUse: After tool succeeds
/// - PostToolUseFailure: After tool fails
/// - SubagentStart: When spawning a subagent
/// - SubagentStop: When subagent finishes
/// - Stop: Claude finishes responding
/// - PreCompact: Before context compaction
/// - SessionEnd: Session terminates
/// - Notification: Claude Code sends notifications
/// - Setup: When invoked with --init, --init-only, or --maintenance
fn create_claude_notify_hook(hooks_dir: &Path) -> std::io::Result<()> {
    let hook = r#"#!/bin/bash
# Ada agent notification hook for Claude Code
# Claude passes JSON on stdin
# Tracks ALL Claude Code hook events for debugging and status tracking

LOG_FILE="${ADA_HOME:-$HOME/.ada}/logs/hooks.log"
mkdir -p "$(dirname "$LOG_FILE")"

read -r INPUT

# Log the raw input for debugging (truncate if too long)
INPUT_LOG=$(echo "$INPUT" | head -c 2000)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] RAW: $INPUT_LOG" >> "$LOG_FILE"

# Extract event type
EVENT_TYPE=$(echo "$INPUT" | grep -oE '"hook_event_name"\s*:\s*"[^"]*"' | cut -d'"' -f4)

# Extract additional context based on event type
TOOL_NAME=$(echo "$INPUT" | grep -oE '"tool_name"\s*:\s*"[^"]*"' | cut -d'"' -f4)
NOTIFICATION_TYPE=$(echo "$INPUT" | grep -oE '"notification_type"\s*:\s*"[^"]*"' | cut -d'"' -f4)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | grep -oE '"stop_hook_active"\s*:\s*(true|false)' | cut -d':' -f2 | tr -d ' ')
SESSION_SOURCE=$(echo "$INPUT" | grep -oE '"source"\s*:\s*"[^"]*"' | cut -d'"' -f4)
AGENT_TYPE=$(echo "$INPUT" | grep -oE '"agent_type"\s*:\s*"[^"]*"' | cut -d'"' -f4)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] EVENT_TYPE: $EVENT_TYPE | tool: $TOOL_NAME | notification: $NOTIFICATION_TYPE | stop_active: $STOP_HOOK_ACTIVE | source: $SESSION_SOURCE | agent: $AGENT_TYPE" >> "$LOG_FILE"

# Map Claude events to Ada status events
# Ada events: Start (working), Stop (idle), Permission (needs input)
case "$EVENT_TYPE" in
    # Session lifecycle
    "SessionStart")
        EVENT="Start"
        ;;
    "SessionEnd")
        EVENT="Stop"
        ;;

    # User interaction
    "UserPromptSubmit")
        EVENT="Start"
        ;;

    # Tool execution
    "PreToolUse")
        EVENT="Start"
        ;;
    "PostToolUse")
        # Tool completed - still working unless Stop follows
        EVENT=""
        ;;
    "PostToolUseFailure")
        # Tool failed - still working
        EVENT=""
        ;;

    # Permission
    "PermissionRequest")
        EVENT="Permission"
        ;;

    # Notifications (permission_prompt, idle_prompt, auth_success, elicitation_dialog)
    "Notification")
        case "$NOTIFICATION_TYPE" in
            "permission_prompt")
                EVENT="Permission"
                ;;
            "idle_prompt")
                EVENT="Stop"
                ;;
            *)
                EVENT=""
                ;;
        esac
        ;;

    # Agent completion
    "Stop")
        EVENT="Stop"
        ;;
    "SubagentStart")
        EVENT="Start"
        ;;
    "SubagentStop")
        # Subagent stopped, but main agent may continue
        EVENT=""
        ;;

    # Context management
    "PreCompact")
        EVENT=""
        ;;

    # Setup
    "Setup")
        EVENT=""
        ;;

    *)
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] UNHANDLED EVENT: $EVENT_TYPE" >> "$LOG_FILE"
        EVENT=""
        ;;
esac

# Always send hook event to frontend (for logging), with optional mapped event for UI state
if [[ -n "$ADA_TERMINAL_ID" ]]; then
    PORT="${ADA_NOTIFICATION_PORT:-9876}"
    # URL-encode the JSON payload for transmission
    ENCODED_PAYLOAD=$(printf '%s' "$JSON" | jq -sRr @uri 2>/dev/null || printf '%s' "$JSON" | sed 's/ /%20/g; s/"/%22/g; s/{/%7B/g; s/}/%7D/g; s/:/%3A/g; s/,/%2C/g')

    # Build URL with agent name, project_id, and payload
    URL="http://127.0.0.1:${PORT}/hook/agent-event?terminal_id=${ADA_TERMINAL_ID}&project_id=${ADA_PROJECT_ID}&event=${EVENT:-raw}&agent=claude&payload=${ENCODED_PAYLOAD}"

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] Sending: terminal_id=${ADA_TERMINAL_ID} event=${EVENT:-raw} port=${PORT}" >> "$LOG_FILE"

    RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" --max-time 2 --connect-timeout 1 "$URL" 2>&1)
    CURL_EXIT=$?
    HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)

    if [[ $CURL_EXIT -ne 0 ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] NOTIFY_ERROR: curl failed with exit code $CURL_EXIT" >> "$LOG_FILE"
    elif [[ "$HTTP_CODE" != "200" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] NOTIFY_ERROR: HTTP $HTTP_CODE" >> "$LOG_FILE"
    fi
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [claude] SKIP_NOTIFY: No ADA_TERMINAL_ID set" >> "$LOG_FILE"
fi

exit 0
"#;

    let path = hooks_dir.join("notify.sh");
    fs::write(&path, hook)?;
    set_executable(&path)?;
    Ok(())
}

/// Create notification hook for Codex (receives JSON as command-line argument)
/// Codex Event Types (from https://developers.openai.com/codex/config-advanced/):
/// - agent-turn-complete: Agent finished a turn (includes thread-id, turn-id, cwd, input-messages, last-assistant-message)
/// - approval-requested: User approval is needed (for TUI notifications)
/// Note: Codex has limited hook support compared to Claude. Only "notify" config is available.
fn create_codex_notify_hook(hooks_dir: &Path) -> std::io::Result<()> {
    let hook = r#"#!/bin/bash
# Ada agent notification hook for Codex
# Codex passes JSON as first argument (not stdin)
# Logs ALL events for debugging and future use
# Docs: https://developers.openai.com/codex/config-advanced/

LOG_FILE="${ADA_HOME:-$HOME/.ada}/logs/hooks.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [codex] $1" >> "$LOG_FILE"
}

JSON="$1"

# Log raw input (truncate if too long)
JSON_LOG=$(echo "$JSON" | head -c 3000)
log "RAW: $JSON_LOG"

if [[ -z "$JSON" ]]; then
    log "ERROR: Empty JSON received"
    exit 0
fi

# Check environment variables
if [[ -z "$ADA_TERMINAL_ID" ]]; then
    log "WARNING: ADA_TERMINAL_ID not set"
fi
if [[ -z "$ADA_NOTIFICATION_PORT" ]]; then
    log "WARNING: ADA_NOTIFICATION_PORT not set, using default 9876"
fi

# Extract fields using jq if available, fallback to grep
if command -v jq &>/dev/null; then
    EVENT_TYPE=$(echo "$JSON" | jq -r '.type // empty' 2>/dev/null)
    THREAD_ID=$(echo "$JSON" | jq -r '.["thread-id"] // empty' 2>/dev/null)
    TURN_ID=$(echo "$JSON" | jq -r '.["turn-id"] // empty' 2>/dev/null)
    CWD=$(echo "$JSON" | jq -r '.cwd // empty' 2>/dev/null)
    ERROR_MSG=$(echo "$JSON" | jq -r '.error // .message // empty' 2>/dev/null)
    LAST_MSG=$(echo "$JSON" | jq -r '.["last-assistant-message"] // empty' 2>/dev/null | head -c 200)
else
    EVENT_TYPE=$(echo "$JSON" | grep -oE '"type"\s*:\s*"[^"]*"' | head -1 | cut -d'"' -f4)
    THREAD_ID=$(echo "$JSON" | grep -oE '"thread-id"\s*:\s*"[^"]*"' | head -1 | cut -d'"' -f4)
    TURN_ID=$(echo "$JSON" | grep -oE '"turn-id"\s*:\s*"[^"]*"' | head -1 | cut -d'"' -f4)
    CWD=$(echo "$JSON" | grep -oE '"cwd"\s*:\s*"[^"]*"' | head -1 | cut -d'"' -f4)
    ERROR_MSG=$(echo "$JSON" | grep -oE '"error"\s*:\s*"[^"]*"' | head -1 | cut -d'"' -f4)
    LAST_MSG=$(echo "$JSON" | grep -oE '"last-assistant-message"\s*:\s*"[^"]{0,200}' | head -1 | cut -d'"' -f4)
fi

# Log parsed event details
log "EVENT: type=$EVENT_TYPE thread=$THREAD_ID turn=$TURN_ID cwd=$CWD"

# Log error if present
if [[ -n "$ERROR_MSG" ]]; then
    log "ERROR_MSG: $ERROR_MSG"
fi

# Log last message if present (truncated)
if [[ -n "$LAST_MSG" ]]; then
    log "LAST_MSG: ${LAST_MSG:0:200}..."
fi

# Map Codex events to Ada status events
case "$EVENT_TYPE" in
    "agent-turn-complete")
        EVENT="Stop"
        ;;
    "approval-requested")
        EVENT="Permission"
        ;;
    *)
        # Log unknown events but don't send - capture everything for future use
        log "UNKNOWN_EVENT: $EVENT_TYPE (full payload logged above)"
        EVENT=""
        ;;
esac

# Always send hook event to frontend (for logging), with optional mapped event for UI state
if [[ -n "$ADA_TERMINAL_ID" ]]; then
    PORT="${ADA_NOTIFICATION_PORT:-9876}"
    # URL-encode the JSON payload for transmission
    ENCODED_PAYLOAD=$(printf '%s' "$JSON" | jq -sRr @uri 2>/dev/null || printf '%s' "$JSON" | sed 's/ /%20/g; s/"/%22/g; s/{/%7B/g; s/}/%7D/g; s/:/%3A/g; s/,/%2C/g')

    # Build URL with agent name, project_id, and payload
    URL="http://127.0.0.1:${PORT}/hook/agent-event?terminal_id=${ADA_TERMINAL_ID}&project_id=${ADA_PROJECT_ID}&event=${EVENT:-raw}&agent=codex&payload=${ENCODED_PAYLOAD}"

    log "NOTIFY: event=${EVENT:-raw} terminal_id=$ADA_TERMINAL_ID port=$PORT"

    # Capture curl response and errors
    RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" --max-time 2 --connect-timeout 1 "$URL" 2>&1)
    CURL_EXIT=$?
    HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

    if [[ $CURL_EXIT -ne 0 ]]; then
        log "NOTIFY_ERROR: curl failed with exit code $CURL_EXIT"
    elif [[ "$HTTP_CODE" != "200" ]]; then
        log "NOTIFY_ERROR: HTTP $HTTP_CODE - $BODY"
    else
        log "NOTIFY_OK: HTTP $HTTP_CODE"
    fi
else
    log "SKIP_NOTIFY: No ADA_TERMINAL_ID set"
fi

exit 0
"#;

    let path = hooks_dir.join("codex-notify.sh");
    fs::write(&path, hook)?;
    set_executable(&path)?;
    Ok(())
}

/// Create notification hook for Gemini CLI (receives JSON on stdin, similar to Claude)
fn create_gemini_notify_hook(hooks_dir: &Path) -> std::io::Result<()> {
    let hook = r#"#!/bin/bash
# Ada agent notification hook for Gemini CLI
# Gemini passes JSON on stdin

LOG_FILE="${ADA_HOME:-$HOME/.ada}/logs/hooks.log"
mkdir -p "$(dirname "$LOG_FILE")"

read -r INPUT

# Log the raw input for debugging
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [gemini] RAW: $INPUT" >> "$LOG_FILE"

EVENT_TYPE=$(echo "$INPUT" | grep -oE '"hook_event_name"\s*:\s*"[^"]*"' | cut -d'"' -f4)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [gemini] EVENT_TYPE: $EVENT_TYPE" >> "$LOG_FILE"

case "$EVENT_TYPE" in
    "BeforeAgent") EVENT="Start" ;;
    "AfterAgent") EVENT="Stop" ;;
    "Notification") EVENT="Permission" ;;
    *)
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [gemini] UNKNOWN EVENT, skipping" >> "$LOG_FILE"
        exit 0
    ;;
esac

PORT="${ADA_NOTIFICATION_PORT:-9876}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [gemini] Sending: terminal_id=${ADA_TERMINAL_ID} event=${EVENT} port=${PORT}" >> "$LOG_FILE"

curl -s --max-time 2 --connect-timeout 1 \
    "http://127.0.0.1:${PORT}/hook/agent-event?terminal_id=${ADA_TERMINAL_ID}&event=${EVENT}" \
    &>/dev/null || true

exit 0
"#;

    let path = hooks_dir.join("gemini-notify.sh");
    fs::write(&path, hook)?;
    set_executable(&path)?;
    Ok(())
}

/// Create notification hook for Cursor Agent (receives JSON on stdin)
fn create_cursor_notify_hook(hooks_dir: &Path) -> std::io::Result<()> {
    let hook = r#"#!/bin/bash
# Ada agent notification hook for Cursor Agent
# Cursor passes JSON on stdin

LOG_FILE="${ADA_HOME:-$HOME/.ada}/logs/hooks.log"
mkdir -p "$(dirname "$LOG_FILE")"

read -r INPUT

# Log the raw input for debugging
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [cursor] RAW: $INPUT" >> "$LOG_FILE"

# Cursor uses different event names
EVENT_TYPE=$(echo "$INPUT" | grep -oE '"hook_event_name"\s*:\s*"[^"]*"' | cut -d'"' -f4)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [cursor] EVENT_TYPE: $EVENT_TYPE" >> "$LOG_FILE"

case "$EVENT_TYPE" in
    "sessionStart") EVENT="Start" ;;
    "stop") EVENT="Stop" ;;
    "preToolUse") EVENT="Permission" ;;
    *)
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [cursor] UNKNOWN EVENT, skipping" >> "$LOG_FILE"
        exit 0
    ;;
esac

PORT="${ADA_NOTIFICATION_PORT:-9876}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [cursor] Sending: terminal_id=${ADA_TERMINAL_ID} event=${EVENT} port=${PORT}" >> "$LOG_FILE"

curl -s --max-time 2 --connect-timeout 1 \
    "http://127.0.0.1:${PORT}/hook/agent-event?terminal_id=${ADA_TERMINAL_ID}&event=${EVENT}" \
    &>/dev/null || true

# Output JSON response for Cursor (it expects JSON output)
echo '{"status": "ok"}'

exit 0
"#;

    let path = hooks_dir.join("cursor-notify.sh");
    fs::write(&path, hook)?;
    set_executable(&path)?;
    Ok(())
}

/// Create OpenCode JavaScript plugin for notifications
/// OpenCode plugins are ES modules that export async functions returning hook objects
/// Placed in ~/.config/opencode/plugin/ for global loading
fn create_opencode_plugin(plugins_dir: &Path) -> std::io::Result<()> {
    let plugin = r#"// Ada notification plugin for OpenCode v2
// Uses event handler pattern like other OpenCode plugins
// Docs: https://opencode.ai/docs/plugins/

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const ADA_HOME = process.env.ADA_HOME || join(homedir(), '.ada');
const LOG_FILE = join(ADA_HOME, 'logs', 'hooks.log');

function log(message) {
  try {
    const dir = dirname(LOG_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    appendFileSync(LOG_FILE, `[${timestamp}] [opencode] ${message}\n`);
  } catch (e) {
    // Silently ignore logging errors
  }
}

export const AdaNotifyPlugin = async ({ client }) => {
  // Only run inside an Ada terminal session
  if (!process?.env?.ADA_TERMINAL_ID) {
    log('Plugin loaded but no ADA_TERMINAL_ID - skipping');
    return {};
  }

  // Prevent duplicate registration
  if (globalThis.__adaOpencodeNotifyPlugin) return {};
  globalThis.__adaOpencodeNotifyPlugin = true;

  const port = process.env.ADA_NOTIFICATION_PORT || "9876";
  const terminalId = process.env.ADA_TERMINAL_ID;

  log(`Plugin initialized: terminal_id=${terminalId}, port=${port}`);

  // State tracking for deduplication
  let currentState = 'idle'; // 'idle' | 'busy'
  let rootSessionID = null;
  let stopSent = false;

  // Cache for child session checks
  const childSessionCache = new Map();

  const isChildSession = async (sessionID) => {
    if (!sessionID) return true;
    if (!client?.session?.list) return true;

    if (childSessionCache.has(sessionID)) {
      return childSessionCache.get(sessionID);
    }

    try {
      const sessions = await client.session.list();
      const session = sessions.data?.find((s) => s.id === sessionID);
      const isChild = !!session?.parentID;
      childSessionCache.set(sessionID, isChild);
      log(`Session lookup: ${sessionID} isChild=${isChild}`);
      return isChild;
    } catch (err) {
      log(`Session lookup failed: ${err?.message} - assuming child`);
      return true;
    }
  };

  const projectId = process.env.ADA_PROJECT_ID || "";

  const notifyAda = async (event, reason, rawEvent = null) => {
    log(`Notify: event=${event}, reason=${reason}, terminal_id=${terminalId}, project_id=${projectId}, port=${port}`);
    try {
      // URL-encode the raw event payload if provided
      const payload = rawEvent ? encodeURIComponent(JSON.stringify(rawEvent)) : '';
      const url = `http://127.0.0.1:${port}/hook/agent-event?terminal_id=${terminalId}&project_id=${projectId}&event=${event}&agent=opencode&payload=${payload}`;
      log(`Sending to: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2000)
      });
      log(`Sent successfully, status: ${response.status}`);
    } catch (e) {
      log(`Error sending: ${e.message}`);
    }
  };

  const handleBusy = async (sessionID) => {
    if (!rootSessionID) {
      rootSessionID = sessionID;
      log(`Root session set: ${rootSessionID}`);
    }

    if (sessionID !== rootSessionID) {
      log(`Ignoring busy from non-root session: ${sessionID}`);
      return;
    }

    if (currentState === 'idle') {
      currentState = 'busy';
      stopSent = false;
      await notifyAda('Start', 'busy');
    } else {
      log('Already busy, skipping Start');
    }
  };

  const handleStop = async (sessionID, reason) => {
    if (rootSessionID && sessionID !== rootSessionID) {
      log(`Ignoring stop from non-root session: ${sessionID}, reason: ${reason}`);
      return;
    }

    if (currentState === 'busy' && !stopSent) {
      currentState = 'idle';
      stopSent = true;
      log(`Stopping, reason: ${reason}`);
      await notifyAda('Stop', reason);
      rootSessionID = null;
      log('Reset rootSessionID for next session');
    } else {
      log(`Skipping Stop - state: ${currentState}, stopSent: ${stopSent}, reason: ${reason}`);
    }
  };

  return {
    // Generic event handler - OpenCode routes all events through this
    event: async ({ event }) => {
      const sessionID = event.properties?.sessionID;
      log(`Event: ${event.type}, sessionID: ${sessionID}, props: ${JSON.stringify(event.properties || {})}`);

      // Always send raw event to frontend for logging (before any filtering)
      await notifyAda('raw', event.type, event);

      // Skip child/subagent sessions for state management
      if (await isChildSession(sessionID)) {
        log('Skipping child session for state management');
        return;
      }

      // Handle session status changes
      if (event.type === 'session.status') {
        const status = event.properties?.status;
        log(`Status type: ${status?.type}`);
        if (status?.type === 'busy') {
          await handleBusy(sessionID);
          await notifyAda('Start', 'session.status.busy', event);
        } else if (status?.type === 'idle') {
          await handleStop(sessionID, 'session.status.idle');
          await notifyAda('Stop', 'session.status.idle', event);
        }
      }

      // Handle session.idle event directly
      if (event.type === 'session.idle') {
        await handleStop(sessionID, 'session.idle');
        await notifyAda('Stop', 'session.idle', event);
      }

      // Handle session errors
      if (event.type === 'session.error') {
        await handleStop(sessionID, 'session.error');
        await notifyAda('Stop', 'session.error', event);
      }
    },

    // Permission hook - fires when OpenCode needs user permission
    "permission.ask": async (_permission, output) => {
      log(`Permission: status=${output.status}`);
      // Always send raw event
      await notifyAda('raw', 'permission.ask', { permission: _permission, output });
      if (output.status === 'ask') {
        log('Permission requested');
        await notifyAda('Permission', 'permission.ask', { permission: _permission, output });
      }
    },
  };
};
"#;

    let path = plugins_dir.join("ada-notify.js");
    fs::write(&path, plugin)?;
    Ok(())
}

/// Copy the OpenCode plugin to ~/.config/opencode/plugin/ where OpenCode expects it
fn ensure_opencode_plugin(ada_plugins_dir: &Path) -> std::io::Result<()> {
    let opencode_config = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Home directory not found"))?
        .join(".config")
        .join("opencode")
        .join("plugin");

    // Create the OpenCode plugins directory if it doesn't exist
    fs::create_dir_all(&opencode_config)?;

    // Copy the Ada plugin to OpenCode's plugins directory
    let src = ada_plugins_dir.join("ada-notify.js");
    let dst = opencode_config.join("ada-notify.js");

    if src.exists() {
        fs::copy(&src, &dst)?;
    }

    Ok(())
}

pub fn ensure_claude_settings(ada_home: &Path) -> std::io::Result<()> {
    let settings_path = ada_home.join("claude-settings.json");
    let notify_path = ada_home.join("hooks/notify.sh");
    let notify_path_str = notify_path.to_string_lossy();

    let desired = build_desired_hooks(&notify_path_str);
    let mut root = Value::Object(Map::new());
    let mut needs_write = false;

    if settings_path.exists() {
        match fs::read_to_string(&settings_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        {
            Some(value) => {
                root = value;
            }
            None => {
                needs_write = true;
            }
        }
    } else {
        needs_write = true;
    }

    if !root.is_object() {
        root = Value::Object(Map::new());
        needs_write = true;
    }

    let root_obj = root.as_object_mut().expect("root is object");
    let hooks_val = root_obj
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));

    if !hooks_val.is_object() {
        *hooks_val = Value::Object(Map::new());
        needs_write = true;
    }

    let hooks_obj = hooks_val.as_object_mut().expect("hooks is object");
    for (event, value) in desired {
        let replace = match hooks_obj.get(&event) {
            Some(existing) => !hook_event_valid(existing),
            None => true,
        };
        if replace {
            hooks_obj.insert(event, value);
            needs_write = true;
        }
    }

    if needs_write {
        let settings = serde_json::to_string_pretty(&root)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;

        // Use atomic write: write to temp file, then rename
        // This prevents the race condition where Claude reads a non-existent file
        let temp_path = ada_home.join("claude-settings.json.tmp");
        fs::write(&temp_path, &settings)?;
        fs::rename(&temp_path, &settings_path)?;
    }

    Ok(())
}

/// Ensure Codex config.toml has Ada's notification hook configured.
/// If user already has a notify command, we create a wrapper that chains both.
pub fn ensure_codex_config(hooks_dir: &Path) -> std::io::Result<()> {
    let codex_home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Home directory not found"))?
        .join(".codex");

    // Create .codex directory if it doesn't exist
    fs::create_dir_all(&codex_home)?;

    let config_path = codex_home.join("config.toml");
    let ada_notify_script = hooks_dir.join("codex-notify.sh");
    let ada_notify_str = ada_notify_script.to_string_lossy().to_string();
    let wrapper_script = hooks_dir.join("codex-notify-wrapper.sh");
    let wrapper_str = wrapper_script.to_string_lossy().to_string();

    // Read existing config or create new one
    let mut doc: DocumentMut = if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        content.parse().unwrap_or_else(|_| DocumentMut::new())
    } else {
        DocumentMut::new()
    };

    // Check current notify setting
    let existing_notify: Option<Vec<String>> = doc.get("notify").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
    });

    // Determine what action to take
    enum Action {
        None,                           // Already configured correctly
        SetDirect,                      // No existing notify, set directly to Ada's script
        CreateWrapper(Vec<String>),     // User has notify, create wrapper that chains both
    }

    let action = match &existing_notify {
        None => Action::SetDirect,
        Some(cmd) => {
            // Check if already pointing to our wrapper
            if cmd.len() == 2 && cmd[0] == "bash" && cmd[1] == wrapper_str {
                Action::None
            }
            // Check if already pointing directly to our script (no user command)
            else if cmd.len() == 2 && cmd[0] == "bash" && cmd[1] == ada_notify_str {
                Action::None
            }
            // User has their own notify command - need to create wrapper
            else {
                Action::CreateWrapper(cmd.clone())
            }
        }
    };

    match action {
        Action::None => {
            // Already configured correctly, nothing to do
        }
        Action::SetDirect => {
            // No existing notify, set directly to Ada's script
            let mut notify_array = Array::new();
            notify_array.push("bash");
            notify_array.push(ada_notify_str.as_str());
            doc["notify"] = value(notify_array);

            // Atomic write
            let temp_path = codex_home.join("config.toml.tmp");
            fs::write(&temp_path, doc.to_string())?;
            fs::rename(&temp_path, &config_path)?;
        }
        Action::CreateWrapper(user_cmd) => {
            // Create wrapper script that calls both user's command and Ada's script
            create_codex_chained_wrapper(hooks_dir, &user_cmd, &ada_notify_str)?;

            // Update config to point to wrapper
            let mut notify_array = Array::new();
            notify_array.push("bash");
            notify_array.push(wrapper_str.as_str());
            doc["notify"] = value(notify_array);

            // Atomic write
            let temp_path = codex_home.join("config.toml.tmp");
            fs::write(&temp_path, doc.to_string())?;
            fs::rename(&temp_path, &config_path)?;
        }
    }

    Ok(())
}

/// Create a wrapper script that chains the user's notify command with Ada's script
fn create_codex_chained_wrapper(
    hooks_dir: &Path,
    user_cmd: &[String],
    ada_script: &str,
) -> std::io::Result<()> {
    // Escape user command for shell
    let user_cmd_escaped: Vec<String> = user_cmd
        .iter()
        .map(|arg| {
            if arg.contains(' ') || arg.contains('"') || arg.contains('\'') {
                format!("'{}'", arg.replace('\'', "'\\''"))
            } else {
                arg.clone()
            }
        })
        .collect();
    let user_cmd_str = user_cmd_escaped.join(" ");

    let wrapper = format!(
        r#"#!/bin/bash
# Ada Codex notification wrapper
# This script chains the user's original notify command with Ada's status tracking.
# User's original command: {user_cmd_str}

JSON="$1"

# Run user's original notify command first (don't let it block)
{user_cmd_str} "$JSON" &

# Run Ada's notification script
bash "{ada_script}" "$JSON"

# Wait for user's command to finish (with timeout)
wait

exit 0
"#
    );

    let path = hooks_dir.join("codex-notify-wrapper.sh");
    fs::write(&path, wrapper)?;
    set_executable(&path)?;
    Ok(())
}

fn build_desired_hooks(notify_path: &str) -> Vec<(String, Value)> {
    let hook_entry = json!([
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": format!("bash \"{}\"", notify_path) }
        ]
      }
    ]);

    // Register ALL Claude Code hook events for comprehensive tracking
    // See: https://code.claude.com/docs/en/hooks
    vec![
        // Session lifecycle
        ("SessionStart".to_string(), hook_entry.clone()),
        ("SessionEnd".to_string(), hook_entry.clone()),

        // User interaction
        ("UserPromptSubmit".to_string(), hook_entry.clone()),

        // Tool execution (PreToolUse, PostToolUse, PostToolUseFailure use matchers)
        ("PreToolUse".to_string(), hook_entry.clone()),
        ("PostToolUse".to_string(), hook_entry.clone()),
        ("PostToolUseFailure".to_string(), hook_entry.clone()),

        // Permission
        ("PermissionRequest".to_string(), hook_entry.clone()),

        // Notifications
        ("Notification".to_string(), hook_entry.clone()),

        // Agent completion
        ("Stop".to_string(), hook_entry.clone()),
        ("SubagentStart".to_string(), hook_entry.clone()),
        ("SubagentStop".to_string(), hook_entry.clone()),

        // Context management
        ("PreCompact".to_string(), hook_entry.clone()),

        // Setup
        ("Setup".to_string(), hook_entry),
    ]
}

fn hook_event_valid(value: &Value) -> bool {
    let entries = match value.as_array() {
        Some(entries) if !entries.is_empty() => entries,
        _ => return false,
    };

    for entry in entries {
        let obj = match entry.as_object() {
            Some(obj) => obj,
            None => return false,
        };
        match obj.get("hooks").and_then(|hooks| hooks.as_array()) {
            Some(_) => {}
            None => return false,
        }
    }

    true
}

/// Ensure Gemini CLI settings.json has Ada's notification hook configured.
/// Gemini CLI uses ~/.gemini/settings.json for global configuration.
pub fn ensure_gemini_settings(ada_home: &Path) -> std::io::Result<()> {
    let gemini_home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Home directory not found"))?
        .join(".gemini");

    // Create .gemini directory if it doesn't exist
    fs::create_dir_all(&gemini_home)?;

    let settings_path = gemini_home.join("settings.json");
    let notify_path = ada_home.join("hooks/gemini-notify.sh");
    let notify_path_str = notify_path.to_string_lossy();

    let desired = build_gemini_hooks(&notify_path_str);
    let mut root = Value::Object(Map::new());
    let mut needs_write = false;

    if settings_path.exists() {
        match fs::read_to_string(&settings_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        {
            Some(value) => {
                root = value;
            }
            None => {
                needs_write = true;
            }
        }
    } else {
        needs_write = true;
    }

    if !root.is_object() {
        root = Value::Object(Map::new());
        needs_write = true;
    }

    let root_obj = root.as_object_mut().expect("root is object");
    let hooks_val = root_obj
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));

    if !hooks_val.is_object() {
        *hooks_val = Value::Object(Map::new());
        needs_write = true;
    }

    let hooks_obj = hooks_val.as_object_mut().expect("hooks is object");
    for (event, value) in desired {
        let replace = match hooks_obj.get(&event) {
            Some(existing) => !hook_event_valid(existing),
            None => true,
        };
        if replace {
            hooks_obj.insert(event, value);
            needs_write = true;
        }
    }

    if needs_write {
        let settings = serde_json::to_string_pretty(&root)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;

        // Use atomic write: write to temp file, then rename
        let temp_path = gemini_home.join("settings.json.tmp");
        fs::write(&temp_path, &settings)?;
        fs::rename(&temp_path, &settings_path)?;
    }

    Ok(())
}

fn build_gemini_hooks(notify_path: &str) -> Vec<(String, Value)> {
    let hook_entry = json!([
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": format!("bash \"{}\"", notify_path) }
        ]
      }
    ]);

    // Gemini CLI uses different event names
    vec![
        ("BeforeAgent".to_string(), hook_entry.clone()),
        ("AfterAgent".to_string(), hook_entry.clone()),
        ("Notification".to_string(), hook_entry),
    ]
}

/// Ensure Cursor hooks.json has Ada's notification hook configured.
/// Cursor Agent uses ~/.cursor/hooks.json for global configuration.
pub fn ensure_cursor_hooks(ada_home: &Path) -> std::io::Result<()> {
    let cursor_home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Home directory not found"))?
        .join(".cursor");

    // Create .cursor directory if it doesn't exist
    fs::create_dir_all(&cursor_home)?;

    let hooks_path = cursor_home.join("hooks.json");
    let notify_path = ada_home.join("hooks/cursor-notify.sh");
    let notify_path_str = notify_path.to_string_lossy();

    let desired = build_cursor_hooks(&notify_path_str);
    let mut root = Value::Object(Map::new());
    let mut needs_write = false;

    if hooks_path.exists() {
        match fs::read_to_string(&hooks_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        {
            Some(value) => {
                root = value;
            }
            None => {
                needs_write = true;
            }
        }
    } else {
        needs_write = true;
    }

    if !root.is_object() {
        root = Value::Object(Map::new());
        needs_write = true;
    }

    let root_obj = root.as_object_mut().expect("root is object");
    let hooks_val = root_obj
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));

    if !hooks_val.is_object() {
        *hooks_val = Value::Object(Map::new());
        needs_write = true;
    }

    let hooks_obj = hooks_val.as_object_mut().expect("hooks is object");
    for (event, value) in desired {
        let replace = match hooks_obj.get(&event) {
            Some(existing) => !hook_event_valid(existing),
            None => true,
        };
        if replace {
            hooks_obj.insert(event, value);
            needs_write = true;
        }
    }

    if needs_write {
        let settings = serde_json::to_string_pretty(&root)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;

        // Use atomic write: write to temp file, then rename
        let temp_path = cursor_home.join("hooks.json.tmp");
        fs::write(&temp_path, &settings)?;
        fs::rename(&temp_path, &hooks_path)?;
    }

    Ok(())
}

fn build_cursor_hooks(notify_path: &str) -> Vec<(String, Value)> {
    let hook_entry = json!([
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": format!("bash \"{}\"", notify_path) }
        ]
      }
    ]);

    // Cursor uses different event names
    vec![
        ("sessionStart".to_string(), hook_entry.clone()),
        ("stop".to_string(), hook_entry.clone()),
        ("preToolUse".to_string(), hook_entry),
    ]
}

fn set_executable(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, Permissions::from_mode(0o755))?;
    }
    Ok(())
}
