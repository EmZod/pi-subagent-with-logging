#!/bin/bash
#
# Pi Subagent Dashboard
# Live monitoring for orchestrated subagents
#
# Usage: ./dashboard.sh /path/to/workspace [refresh_seconds]
#
# Visualizes:
# - Agent status (running/done/failed)
# - Turn count, time elapsed
# - Token usage and costs
# - Tool activity (hot paths)
# - Step progress from log.md
# - Recent git commits (audit trail)
# - Errors and warnings
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# Args
WORKSPACE="${1:-.}"
REFRESH="${2:-3}"

# Resolve workspace
WORKSPACE="$(cd "$WORKSPACE" 2>/dev/null && pwd)"

if [ ! -d "$WORKSPACE/agents" ]; then
    echo "Error: No agents/ directory in $WORKSPACE"
    echo "Usage: $0 /path/to/workspace [refresh_seconds]"
    exit 1
fi

# Get terminal dimensions
get_term_size() {
    COLS=$(tput cols)
    ROWS=$(tput lines)
}

# Draw horizontal line
hr() {
    local char="${1:-─}"
    printf '%*s\n' "$COLS" '' | tr ' ' "$char"
}

# Center text
center() {
    local text="$1"
    local width="${2:-$COLS}"
    local padding=$(( (width - ${#text}) / 2 ))
    printf "%*s%s\n" "$padding" '' "$text"
}

# Truncate text to width
trunc() {
    local text="$1"
    local max="${2:-40}"
    if [ ${#text} -gt $max ]; then
        echo "${text:0:$((max-3))}..."
    else
        echo "$text"
    fi
}

# Get agent status
get_agent_status() {
    local agent="$1"
    local agent_dir="$WORKSPACE/agents/$agent"
    
    # Check tmux session
    if tmux has-session -t "$agent" 2>/dev/null; then
        echo "RUNNING"
        return
    fi
    
    # Check PID file
    if [ -f "$agent_dir/pid" ]; then
        local pid=$(cat "$agent_dir/pid" 2>/dev/null)
        if ps -p "$pid" >/dev/null 2>&1; then
            echo "RUNNING"
            return
        fi
    fi
    
    # Check if output exists (completed)
    if [ -f "$agent_dir/output/findings.md" ] || [ -f "$agent_dir/output/result.txt" ] || \
       ls "$agent_dir/output/"*.md >/dev/null 2>&1; then
        # Check for errors in log
        if grep -q "FAIL\|ERROR\|error" "$agent_dir/log.md" 2>/dev/null; then
            echo "PARTIAL"
        else
            echo "DONE"
        fi
        return
    fi
    
    # Check if ever started
    if [ -f "$agent_dir/audit.jsonl" ] || [ -f "$agent_dir/output/run.log" ]; then
        echo "STOPPED"
    else
        echo "PENDING"
    fi
}

# Get status color
status_color() {
    case "$1" in
        RUNNING) echo "$GREEN" ;;
        DONE)    echo "$CYAN" ;;
        PARTIAL) echo "$YELLOW" ;;
        STOPPED) echo "$RED" ;;
        PENDING) echo "$DIM" ;;
        *)       echo "$RESET" ;;
    esac
}

# Get turn count from audit.jsonl
get_turns() {
    local agent="$1"
    local audit="$WORKSPACE/agents/$agent/audit.jsonl"
    if [ -f "$audit" ]; then
        grep -c '"event":"turn_end"' "$audit" 2>/dev/null || echo "0"
    else
        echo "-"
    fi
}

# Get tool calls from audit.jsonl
get_tool_calls() {
    local agent="$1"
    local audit="$WORKSPACE/agents/$agent/audit.jsonl"
    if [ -f "$audit" ]; then
        grep -c '"event":"tool_call"' "$audit" 2>/dev/null || echo "0"
    else
        echo "-"
    fi
}

# Get elapsed time
get_elapsed() {
    local agent="$1"
    local audit="$WORKSPACE/agents/$agent/audit.jsonl"
    if [ -f "$audit" ]; then
        local first=$(head -1 "$audit" 2>/dev/null | grep -o '"ts":[0-9]*' | cut -d: -f2)
        local last=$(tail -1 "$audit" 2>/dev/null | grep -o '"ts":[0-9]*' | cut -d: -f2)
        if [ -n "$first" ] && [ -n "$last" ]; then
            local elapsed=$(( (last - first) / 1000 ))
            if [ $elapsed -lt 60 ]; then
                echo "${elapsed}s"
            elif [ $elapsed -lt 3600 ]; then
                echo "$((elapsed / 60))m$((elapsed % 60))s"
            else
                echo "$((elapsed / 3600))h$((elapsed % 3600 / 60))m"
            fi
        else
            echo "-"
        fi
    else
        echo "-"
    fi
}

# Get last step from log.md
get_last_step() {
    local agent="$1"
    local log="$WORKSPACE/agents/$agent/log.md"
    if [ -f "$log" ]; then
        grep -o 'STEP-[0-9]*' "$log" 2>/dev/null | tail -1 || echo "-"
    else
        echo "-"
    fi
}

# Get step status
get_step_status() {
    local agent="$1"
    local log="$WORKSPACE/agents/$agent/log.md"
    if [ -f "$log" ]; then
        local complete=$(grep -c 'COMPLETE' "$log" 2>/dev/null || echo 0)
        local in_progress=$(grep -c 'IN_PROGRESS' "$log" 2>/dev/null || echo 0)
        echo "${complete}✓ ${in_progress}…"
    else
        echo "-"
    fi
}

# Get cost estimate from run.log (very rough)
get_cost() {
    local agent="$1"
    local runlog="$WORKSPACE/agents/$agent/output/run.log"
    if [ -f "$runlog" ]; then
        # Try to find cost in log (format varies)
        local cost=$(grep -oE '\$[0-9]+\.[0-9]+' "$runlog" 2>/dev/null | tail -1)
        if [ -n "$cost" ]; then
            echo "$cost"
        else
            echo "-"
        fi
    else
        echo "-"
    fi
}

# Get error count
get_errors() {
    local agent="$1"
    local audit="$WORKSPACE/agents/$agent/audit.jsonl"
    if [ -f "$audit" ]; then
        grep -c '"error":true' "$audit" 2>/dev/null || echo "0"
    else
        echo "-"
    fi
}

# Get tool breakdown
get_tool_breakdown() {
    local agent="$1"
    local audit="$WORKSPACE/agents/$agent/audit.jsonl"
    if [ -f "$audit" ]; then
        grep '"event":"tool_call"' "$audit" 2>/dev/null | \
            grep -oE '"tool":"[^"]+"' | \
            cut -d'"' -f4 | \
            sort | uniq -c | sort -rn | head -3 | \
            awk '{printf "%s(%d) ", $2, $1}'
    fi
}

# Get recent commits for agent
get_recent_commits() {
    local agent="$1"
    local count="${2:-3}"
    cd "$WORKSPACE"
    git log --oneline --grep="$agent" -n "$count" 2>/dev/null | \
        sed 's/^/  /' || echo "  (no commits)"
}

# Get total stats
get_total_stats() {
    local total_tools=0
    local total_turns=0
    local total_errors=0
    local running=0
    local done=0
    
    for agent_dir in "$WORKSPACE/agents"/*/; do
        [ -d "$agent_dir" ] || continue
        local agent=$(basename "$agent_dir")
        local status=$(get_agent_status "$agent")
        
        case "$status" in
            RUNNING) ((running++)) ;;
            DONE|PARTIAL) ((done++)) ;;
        esac
        
        local audit="$agent_dir/audit.jsonl"
        if [ -f "$audit" ]; then
            local t=$(grep -c '"event":"tool_call"' "$audit" 2>/dev/null || echo 0)
            local u=$(grep -c '"event":"turn_end"' "$audit" 2>/dev/null || echo 0)
            local e=$(grep -c '"error":true' "$audit" 2>/dev/null || echo 0)
            total_tools=$((total_tools + t))
            total_turns=$((total_turns + u))
            total_errors=$((total_errors + e))
        fi
    done
    
    echo "$running $done $total_turns $total_tools $total_errors"
}

# Draw the dashboard
draw_dashboard() {
    get_term_size
    clear
    
    # Header
    echo -e "${BOLD}${WHITE}"
    center "╔═══════════════════════════════════════╗"
    center "║     PI SUBAGENT DASHBOARD             ║"
    center "╚═══════════════════════════════════════╝"
    echo -e "${RESET}"
    
    echo -e "${DIM}Workspace: $WORKSPACE${RESET}"
    echo -e "${DIM}Updated: $(date '+%H:%M:%S') | Refresh: ${REFRESH}s | Press Ctrl+C to exit${RESET}"
    echo ""
    
    # Summary stats
    read running done total_turns total_tools total_errors <<< $(get_total_stats)
    echo -e "${BOLD}SUMMARY${RESET}"
    echo -e "  ${GREEN}●${RESET} Running: $running  ${CYAN}●${RESET} Done: $done  ${YELLOW}⟳${RESET} Turns: $total_turns  ${BLUE}⚙${RESET} Tools: $total_tools  ${RED}✗${RESET} Errors: $total_errors"
    echo ""
    
    hr "─"
    
    # Agent table header
    printf "${BOLD}%-15s %-9s %6s %6s %8s %10s %6s %6s${RESET}\n" \
        "AGENT" "STATUS" "TURNS" "TOOLS" "ELAPSED" "PROGRESS" "ERRS" "COST"
    hr "─"
    
    # Agent rows
    for agent_dir in "$WORKSPACE/agents"/*/; do
        [ -d "$agent_dir" ] || continue
        local agent=$(basename "$agent_dir")
        
        local status=$(get_agent_status "$agent")
        local color=$(status_color "$status")
        local turns=$(get_turns "$agent")
        local tools=$(get_tool_calls "$agent")
        local elapsed=$(get_elapsed "$agent")
        local step_status=$(get_step_status "$agent")
        local errors=$(get_errors "$agent")
        local cost=$(get_cost "$agent")
        
        printf "%-15s ${color}%-9s${RESET} %6s %6s %8s %10s %6s %6s\n" \
            "$(trunc "$agent" 15)" "$status" "$turns" "$tools" "$elapsed" "$step_status" "$errors" "$cost"
    done
    
    echo ""
    hr "─"
    
    # Tool breakdown (hot paths)
    echo -e "${BOLD}HOT PATHS (Tool Usage)${RESET}"
    for agent_dir in "$WORKSPACE/agents"/*/; do
        [ -d "$agent_dir" ] || continue
        local agent=$(basename "$agent_dir")
        local breakdown=$(get_tool_breakdown "$agent")
        if [ -n "$breakdown" ]; then
            echo -e "  ${CYAN}$agent${RESET}: $breakdown"
        fi
    done
    
    echo ""
    hr "─"
    
    # Recent activity (git commits)
    echo -e "${BOLD}RECENT ACTIVITY (Git Log)${RESET}"
    cd "$WORKSPACE"
    git log --oneline -8 2>/dev/null | while read line; do
        # Color based on event type
        if echo "$line" | grep -q ":tool]"; then
            echo -e "  ${BLUE}$line${RESET}"
        elif echo "$line" | grep -q ":turn]"; then
            echo -e "  ${DIM}$line${RESET}"
        elif echo "$line" | grep -q ":end]"; then
            echo -e "  ${GREEN}$line${RESET}"
        elif echo "$line" | grep -q ":start]"; then
            echo -e "  ${MAGENTA}$line${RESET}"
        else
            echo "  $line"
        fi
    done
    
    echo ""
    hr "─"
    
    # Errors section (if any)
    local has_errors=false
    for agent_dir in "$WORKSPACE/agents"/*/; do
        [ -d "$agent_dir" ] || continue
        local audit="$agent_dir/audit.jsonl"
        if [ -f "$audit" ] && grep -q '"error":true' "$audit" 2>/dev/null; then
            has_errors=true
            break
        fi
    done
    
    if $has_errors; then
        echo -e "${BOLD}${RED}ERRORS${RESET}"
        for agent_dir in "$WORKSPACE/agents"/*/; do
            [ -d "$agent_dir" ] || continue
            local agent=$(basename "$agent_dir")
            local audit="$agent_dir/audit.jsonl"
            if [ -f "$audit" ]; then
                grep '"error":true' "$audit" 2>/dev/null | tail -2 | while read line; do
                    local tool=$(echo "$line" | grep -oE '"tool":"[^"]+"' | cut -d'"' -f4)
                    echo -e "  ${RED}✗${RESET} $agent: $tool failed"
                done
            fi
        done
        echo ""
    fi
    
    # Commands hint
    echo -e "${DIM}Commands: tmux attach -t <agent> | cat agents/<agent>/log.md | git log --oneline${RESET}"
}

# Main loop
main() {
    # Check dependencies
    if ! command -v tmux &>/dev/null; then
        echo "Warning: tmux not found, session detection limited"
    fi
    
    if ! command -v jq &>/dev/null; then
        echo "Warning: jq not found, some features limited"
    fi
    
    # Run dashboard
    while true; do
        draw_dashboard
        sleep "$REFRESH"
    done
}

# Handle arguments
case "${1:-}" in
    -h|--help)
        echo "Pi Subagent Dashboard"
        echo ""
        echo "Usage: $0 /path/to/workspace [refresh_seconds]"
        echo ""
        echo "Monitors:"
        echo "  - Agent status (running/done/failed)"
        echo "  - Turn count, tool calls, elapsed time"
        echo "  - Step progress from log.md"
        echo "  - Recent git commits (audit trail)"
        echo "  - Errors and warnings"
        echo ""
        echo "Requires:"
        echo "  - Workspace with agents/ directory"
        echo "  - Shadow-git hook for full audit trail"
        echo ""
        echo "Example:"
        echo "  $0 ~/workspaces/research-task 5"
        exit 0
        ;;
esac

main
