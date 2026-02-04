# pi-shadow-git

Git-based orchestration logging for pi subagents with **Mission Control** dashboard.

Enables branching, rewinding, and forking agent execution paths through automatic git commits and structured audit logging.

## Installation

```bash
# Via npm (recommended)
pi install npm:pi-shadow-git

# Via git
pi install git:github.com/EmZod/pi-subagent-with-logging

# Or try without installing
pi -e npm:pi-shadow-git
```

Once installed, the extension and skill are automatically loaded. No manual setup required.

## What's Included

| Resource | Description |
|----------|-------------|
| **shadow-git extension** | Commits workspace state after every turn, captures audit logs |
| **mission-control extension** | Real-time TUI dashboard for monitoring agents (`/mc`) |
| **pi-subagent-orchestration skill** | Complete guide for orchestrating subagents with git logging |

## Features

- **Shadow Git Logging** - Commits workspace state after every turn and agent completion
- **Mission Control** - Real-time TUI dashboard for monitoring 100s of agents
- **Audit Trail** - Structured JSONL logs for querying with jq
- **Patch Capture** - Captures diffs when agents modify external repos
- **Killswitch** - Runtime toggle to disable logging during incidents
- **Fail-Open** - Git errors are logged but don't block the agent

## Quick Start

```bash
# 1. Create workspace
WORKSPACE="$HOME/workspaces/$(date +%Y%m%d)-task"
mkdir -p "$WORKSPACE/agents/scout1"/{workspace,output}
cd "$WORKSPACE"

# 2. Write agent plan
cat > agents/scout1/plan.md << 'PLAN'
# Plan: Research Task

## Objective
Research X and produce findings.

## Steps
1. Read the codebase
2. Document findings in output/findings.md

## Output
- output/findings.md
PLAN

# 3. Spawn agent with shadow-git
PI_WORKSPACE_ROOT="$WORKSPACE" \
PI_AGENT_NAME="scout1" \
pi --max-turns 20 'Read plan.md and execute it.'

# 4. Open Mission Control to monitor
# Type: /mc
```

## Mission Control Dashboard

Monitor multiple agents in real-time:

```
/mc
```

**Features:**
- Real-time status for all agents (running, done, error, pending)
- Turn count, tool calls, error count per agent
- Auto-refresh every 2 seconds
- Scrollable list for 100s of agents

**Keyboard Controls:**
| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate agents |
| `Enter` | Toggle detail panel |
| `s` | Cycle sort mode |
| `r` | Manual refresh |
| `q` or `Esc` | Close dashboard |

## Commands

| Command | Description |
|---------|-------------|
| `/mission-control` | Open full Mission Control dashboard |
| `/mc` | Alias for mission-control |
| `/shadow-git` | Show logging status |
| `/shadow-git enable` | Enable logging |
| `/shadow-git disable` | Disable logging (killswitch) |
| `/shadow-git history` | Show last 20 commits |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PI_WORKSPACE_ROOT` | Yes | Root of the shadow git workspace |
| `PI_AGENT_NAME` | For logging | Agent name for commits and paths |
| `PI_SHADOW_GIT_DISABLED` | No | Set to `1` to disable (killswitch) |

## Spawning Patterns

### Blocking (Sequential)
```bash
PI_WORKSPACE_ROOT="$WORKSPACE" PI_AGENT_NAME="scout" \
pi --max-turns 20 --print 'Read plan.md and execute.'
```

### Non-blocking (Parallel with tmux)
```bash
tmux new-session -d -s scout1 \
  "PI_WORKSPACE_ROOT='$WORKSPACE' PI_AGENT_NAME='scout1' \
   pi --max-turns 30 'Read plan.md and execute.'"
```

### Non-blocking (Headless)
```bash
(PI_WORKSPACE_ROOT="$WORKSPACE" PI_AGENT_NAME="scout1" \
 pi --max-turns 20 --print 'Read plan.md and execute.') &
```

## Architecture

Each agent has its own isolated git repository:

```
workspace/
├── manifest.json                 ← Agent registry
└── agents/
    ├── scout1/
    │   ├── .git/                 ← Agent's OWN repo (isolated)
    │   ├── audit.jsonl           ← Real-time log
    │   └── output/               ← Work output
    └── scout2/
        ├── .git/                 ← Completely isolated
        └── ...
```

**Benefits:**
- Zero lock conflicts between parallel agents
- Turn-level commits (~10x fewer than per-tool)
- Clean separation: `audit.jsonl` for observability, git for checkpoints

## Links

- **npm:** https://www.npmjs.com/package/pi-shadow-git
- **GitHub:** https://github.com/EmZod/pi-subagent-with-logging
- **Releases:** https://github.com/EmZod/pi-subagent-with-logging/releases

## License

MIT
