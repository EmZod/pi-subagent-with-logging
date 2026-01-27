# pi-hook-logging

Git-based orchestration logging for pi subagents with **Mission Control** dashboard.

Enables branching, rewinding, and forking agent execution paths through automatic git commits and structured audit logging.

## Features

- **Shadow Git Logging** - Commits workspace state after every tool call, turn, and agent completion
- **Mission Control** - Real-time TUI dashboard for monitoring 100s of agents
- **Audit Trail** - Structured JSONL logs for querying with jq
- **Patch Capture** - Captures diffs when agents modify external repos
- **Killswitch** - Runtime toggle to disable logging during incidents
- **Fail-Open** - Git errors are logged but don't block the agent

## Quick Start

```bash
# Clone
git clone https://github.com/EmZod/pi-hook-logging.git

# Copy extension to pi's global extensions directory
cp pi-hook-logging/src/shadow-git.ts ~/.pi/agent/extensions/
cp pi-hook-logging/src/mission-control.ts ~/.pi/agent/extensions/
```

## Mission Control Dashboard

Monitor multiple agents in real-time with the Mission Control TUI:

```bash
# Set workspace root
export PI_WORKSPACE_ROOT="/path/to/workspace"

# Open dashboard
pi -e shadow-git.ts
# Then type: /mc or /mission-control
```

**Dashboard Features:**
- Real-time status for all agents (running, done, error, pending)
- Turn count, tool calls, error count per agent
- Auto-refresh every 2 seconds
- Scrollable list for 100s of agents
- Sort by status, activity, or name
- Detail panel for selected agent

**Persistent Widget:**
- Shows compact status above the editor while you work
- Auto-enables when workspace has agents
- Toggle with `Ctrl+Shift+M` or `/mc-widget`
- Updates every 3 seconds

```
🚀 Mission Control: ● 2 running (scout1, worker2) │ ○ 1 pending │ ✓ 1 done
```

**Keyboard Controls:**
| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate agents |
| `Enter` | Toggle detail panel |
| `s` | Cycle sort mode |
| `r` | Manual refresh |
| `q` or `Esc` | Close dashboard |

## Shadow Git Logging

### Setup

```bash
# Create workspace
mkdir -p ~/workspaces/task-001
cd ~/workspaces/task-001
git init

# Create agent directories
mkdir -p agents/scout1/{workspace,output}
git add -A && git commit -m "Initial workspace"
```

### Spawn Agent with Logging

```bash
PI_WORKSPACE_ROOT="$(pwd)" \
PI_AGENT_NAME="scout1" \
pi \
  --tools read,write,bash \
  --max-turns 30 \
  --no-input \
  -e ~/.pi/agent/extensions/shadow-git.ts \
  "Read agents/scout1/plan.md and execute."
```

### View History

```bash
git log --oneline
# aed6ec9 [scout1:turn] turn 5 complete
# 87fc5bc [scout1:tool] write: output/findings.md
# 6622667 [scout1:turn] turn 2 complete
# 983e96f [scout1:tool] read: plan.md
# b53d7f7 [scout1:start] initialized
```

## Commands

| Command | Description |
|---------|-------------|
| `/mission-control` | Open full Mission Control dashboard |
| `/mc` | Alias for mission-control |
| `/mc-widget` | Toggle persistent status widget |
| `/mc-widget on` | Enable status widget |
| `/mc-widget off` | Disable status widget |
| `/shadow-git` | Show logging status |
| `/shadow-git enable` | Enable logging |
| `/shadow-git disable` | Disable logging (killswitch) |
| `/shadow-git history` | Show last 20 commits |
| `/shadow-git stats` | Show commit/error statistics |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+M` | Toggle Mission Control widget |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PI_WORKSPACE_ROOT` | Yes* | Root of the shadow git workspace |
| `PI_AGENT_NAME` | For logging | Agent name for commits and paths |
| `PI_TARGET_REPOS` | No | Comma-separated target repo paths |
| `PI_TARGET_BRANCH` | No | Branch name for commit linkage |
| `PI_SHADOW_GIT_DISABLED` | No | Set to `1` to disable (killswitch) |

*Required for both Mission Control and logging

## Killswitch

During an incident, disable logging instantly:

**Runtime (no restart needed):**
```
/shadow-git disable
```

**Environment variable:**
```bash
PI_SHADOW_GIT_DISABLED=1 pi -e shadow-git.ts ...
```

## Status Bar

When logging is active, the extension shows status in the footer:

- `📝 scout1 T3` — Agent "scout1", turn 3, logging active
- `📝 scout1 T3 ⚠️2` — 2 commit errors occurred
- `🔇 shadow-git: disabled` — Killswitch active

## Audit Log

Events are appended to `agents/{name}/audit.jsonl`:

```json
{"ts":1704567890123,"event":"tool_call","agent":"scout1","turn":3,"tool":"write","input":{...}}
{"ts":1704567890456,"event":"tool_result","agent":"scout1","turn":3,"tool":"write","error":false}
{"ts":1704567890789,"event":"turn_end","agent":"scout1","turn":3,"toolResultCount":1}
```

Query with jq:

```bash
# Tool calls only
jq 'select(.event == "tool_call")' agents/scout1/audit.jsonl

# Errors
jq 'select(.error == true or .event == "commit_error")' agents/scout1/audit.jsonl
```

## Failure Handling

The extension **fails open**:

| Failure | Behavior |
|---------|----------|
| Git commit fails | Error logged to audit.jsonl, agent continues |
| Audit file write fails | Error to stderr, agent continues |
| Patch capture fails | Error logged, agent continues |

## Architecture

```
[Orchestrator] spawns [Agent 1] [Agent 2] [Agent 3] ...
                           │         │         │
                           ▼         ▼         ▼
                    [shadow-git extension]
                           │         │         │
                           ▼         ▼         ▼
                    [workspace/.git] ◄── single git repo
                           │
                    [agents/*/audit.jsonl]
                           │
                           ▼
                    [Mission Control] ◄── reads audit files
                           │
                           ▼
                    [TUI Dashboard]
```

## For AI Agents

See [AGENTS.md](AGENTS.md) for agent-specific instructions.

## License

MIT
