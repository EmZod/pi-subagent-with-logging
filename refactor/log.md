# STATE

## Current
step_id: TDD-01-1
status: IN_PROGRESS
objective: Implement per-agent git repositories (STEP-01)

## Decisions (append-only)
- STEP-00: Adopting per-agent git repos + turn-level commits architecture

## Blockers (append-only, mark resolved inline)
(none yet)

---

# STEP LOG (append-only)

## STEP-00: Planning Phase
### Pre-Execution
**Objective:** Create comprehensive implementation plan based on Goedecke's principles

**Initial Beliefs:**
- Current architecture (shared git repo, per-tool commits) is fundamentally flawed
- Per-agent git repos eliminate lock conflicts entirely
- Turn-level commits (not tool-level) reduce noise by ~10x
- audit.jsonl should be the real-time source of truth, git for checkpoints only

**Key Goedecke Principles Applied:**
1. State is the entire problem → Minimize shared state (separate repos)
2. One owner, one writer → Each agent owns its own .git
3. Complexity is debt → Simpler commit strategy (turn-level only)
4. Slow work goes to the queue → Async commits
5. Design hot paths first → Real-time (audit.jsonl) vs rollback (git) are separate concerns
6. Boring is good → Well-tested primitives, obvious architecture

### Execution
Creating plan.md with full implementation details...

**Plan Structure:**
- 6 Phases, 16 Steps
- Each step has: Context, Files, Tasks, Acceptance Criteria, Code Sketches
- Aligned with Goedecke's 11 principles
- Includes Operational Concerns checklist
- Risk assessment and mitigation

**Key Architecture Decisions:**

1. **Per-Agent Git Repos** (Goedecke: "One owner, one writer")
   - Each agent gets `agents/{name}/.git`
   - Zero lock conflicts
   - Complete isolation

2. **Turn-Level Commits** (Goedecke: "Complexity is debt")
   - Commit only at turn_end, not per tool
   - ~10x fewer commits
   - Meaningful checkpoints

3. **Separation of Concerns** (Goedecke: "Design hot paths first")
   - `audit.jsonl`: Real-time observability (append-only, instant)
   - Git commits: Rollback/branching (checkpoint snapshots)
   - `manifest.json`: Cross-agent orchestration

4. **Fail-Open Everything** (Goedecke: "Decide failure modes before you ship")
   - Git init fails → continue without git
   - Git commit fails → log error, continue
   - Already have killswitch

### Post-Execution
Outcome: PASS
Belief updates:
- The refactor is simpler than expected (remove code, don't add)
- Critical path is only 4 steps for 10x improvement
- Migration is a "nice to have" since new workspaces will use new structure

Plan created at /tmp/pi-hook-logging-shitty-state/refactor/plan.md

---

## STEP-00: COMPLETE ✓

---

## STEP-00.1: Test Harness Creation
### Pre-Execution
**Objective:** Create comprehensive test harness with TDD + backpressure protocol

**Beliefs:**
- Future agents with limited context need mechanical verification
- Tests must be runnable without human judgment ("PASS" or "FAIL")
- Stop conditions must be explicit and non-negotiable

### Execution
Created test harness with:

**Test Categories:**
1. `tests/baseline/` - Verify current system before changes
2. `tests/unit/step*.sh` - Per-step unit tests
3. `tests/integration/step*.sh` - Per-step integration tests
4. `tests/regression/core-functionality.sh` - Run after EVERY change
5. `tests/hotpath/hot-paths.sh` - Performance verification
6. `tests/unhappy/failure-modes.sh` - Failure handling verification

**Key Tests Created:**
- `step01-per-agent-repos.sh` - Verifies per-agent .git creation
- `step01-parallel-agents.sh` - **Critical**: Verifies ZERO lock conflicts
- `step02-turn-commits.sh` - Verifies turn-level commits
- `step02-commit-reduction.sh` - Verifies 10x commit reduction

**Backpressure Protocol:**
- STOP conditions defined for each step
- Decision tree in TEST-HARNESS.md
- Master runner (`run-all.sh`) enforces gates

**Updated plan.md:**
- Added TDD protocol section
- Added 🧪 TESTS table to each step
- Added ⛔ STOP IF conditions to each step

### Post-Execution
Outcome: PASS

Files created:
- `TEST-HARNESS.md` (27KB comprehensive guide)
- `tests/run-all.sh` (master runner)
- `tests/baseline/*.sh` (2 files)
- `tests/unit/*.sh` (2 files)
- `tests/integration/*.sh` (2 files)
- `tests/regression/*.sh` (1 file)
- `tests/hotpath/*.sh` (1 file)
- `tests/unhappy/*.sh` (1 file)

---

## STEP-00.1: COMPLETE ✓

---

## STEP-00.2: Formal TDD Setup
### Pre-Execution
**Objective:** Convert to formal Kent Beck TDD with RED-GREEN-REFACTOR cycles

**Beliefs:**
- Tests must FAIL first (RED) to prove they test new behavior
- Each test should target ONE specific behavior
- Implementation is driven by making tests pass (GREEN)
- Refactoring only happens when all tests are GREEN

### Execution

**Created TDD Protocol:**
- `TDD-PROTOCOL.md` - Formal TDD rules and cycle format
- `tests/tdd/` - One test per behavior
- `tests/run-tdd.sh` - TDD cycle runner

**TDD Tests Created:**
| Test | Behavior | RED Status |
|------|----------|------------|
| tdd-01-1 | Agent has own .git | FAIL ✓ |
| tdd-01-2 | Root .git unchanged | FAIL ✓ |
| tdd-01-3 | audit.jsonl gitignored | FAIL ✓ |
| tdd-01-4 | No lock conflicts | FAIL ✓ |
| tdd-02-1 | No per-tool commits | FAIL ✓ |
| tdd-02-2 | Commit at turn end | FAIL ✓ |
| tdd-04-1 | No commitQueue | FAIL ✓ |

**RED Phase Verified:**
```
./tests/run-tdd.sh red
✅ All tests are RED - ready to implement
```

All 7 tests FAIL on current code, confirming they test new behavior.

### Post-Execution
Outcome: PASS

**TDD Cycle Format for Implementation:**
```
1. Run test → FAIL (RED)
2. Write minimum code → test PASSES (GREEN)
3. Run ALL tests → no regressions
4. REFACTOR if needed
5. Log in log.md
6. Commit: "TDD-{step}-{n}: {behavior}"
```

---

## STEP-00.2: COMPLETE ✓

---

# IMPLEMENTATION BEGINS HERE

**Next:** TDD-01-1 (Agent has own .git)

**Command to run:**
```bash
./tests/run-tdd.sh tdd-01-1
# Should FAIL (RED) - then implement - then PASS (GREEN)
```

---

# SESSION 2: Implementation (Post-Compaction)

**Session Start:** 2026-01-27T05:48 GMT+5:30
**Agent:** Implementation Agent
**Context:** Formal session reinitializing after compaction event

## Session Onboarding Complete
- ✅ Read logging-protocol skill
- ✅ Read Goedecke system design article
- ✅ Read plan.md (16 steps, 6 phases)
- ✅ Read log.md (STEP-00 through STEP-00.2 complete)
- ✅ Read TDD-PROTOCOL.md (RED-GREEN-REFACTOR cycles)
- ✅ Read TEST-HARNESS.md (backpressure protocol)
- ✅ Read current shadow-git.ts source

## TDD Test State Verified
- 7 NEW BEHAVIOR tests: All RED (correct - ready to implement)
- 11 EXISTING BEHAVIOR tests: All PASS (regression tests working)

---

## TDD-01-1: Agent directory gets its own .git

### RED
**Test:** `tests/tdd/tdd-01-1-agent-has-git.sh`
**Expected:** FAIL
**Actual:** (verifying...)
**What we're testing:** When an agent starts, `agents/{name}/.git` should be created (not at workspace root)

**Pre-Execution Beliefs:**
- Current code runs `git -C config.workspaceRoot` (shared repo)
- Need to change to `git -C agentDir` (per-agent repo)
- Must create `initAgentRepo()` function that inits git in agent directory
- Must update all git operations to use agentDir as cwd

**Files to modify:** `src/shadow-git.ts`

**Initial Questions:**
1. Where is git init currently called? → Not explicitly, relies on existing repo
2. Where are git operations performed? → In `gitCommitInternal()`, uses `config.workspaceRoot`
3. What needs to change? → Add `initAgentRepo()`, change all `-C` paths to `agentDir`


**Actual:** FAIL ✓ (RED confirmed)

**Observations from test output:**
- Current code tries `git -C workspaceRoot` which has no `.git`
- Agent continues (fail-open working) but no git tracking happens
- No `.git` directory created in agent directory

### GREEN
**Objective:** Write MINIMUM code to make `agents/{name}/.git` exist

**Implementation Plan:**
1. Add `initAgentRepo(agentDir: string): Promise<boolean>` function
2. Function should:
   - Check if `agentDir/.git` exists (return true if yes)
   - Run `git init` in agentDir
   - Create `.gitignore` with `audit.jsonl`
   - Make initial commit
   - Return true on success, false on failure (fail-open)
3. Call `initAgentRepo(config.agentDir)` in `session_start` handler
4. Update `gitCommitInternal` to use `config.agentDir` instead of `config.workspaceRoot`

**Implementing now...**


**Code changed:** `src/shadow-git.ts`
1. Added `initAgentRepo()` function (lines ~95-135)
   - Checks if `agentDir/.git` exists
   - Runs `git init` in agentDir
   - Creates `.gitignore` with `audit.jsonl`
   - Makes initial commit "agent initialized"
   - Returns true/false (fail-open)

2. Updated `gitCommitInternal()` (lines ~140-175)
   - Changed `git -C workspaceRoot` to `git ... { cwd: agentDir }`
   - Added `if (!agentRepoInitialized) return true;` guard

3. Updated `session_start` handler
   - Added `await initAgentRepo();` call

4. Updated `/shadow-git history` command to use agentDir

**Test Results:**

| Test | Result |
|------|--------|
| TDD-01-1 (agent has .git) | PASS ✓ |
| TDD-01-2 (root unchanged) | PASS ✓ |
| TDD-01-3 (audit gitignored) | PASS ✓ |
| TDD-01-4 (zero lock conflicts) | PASS ✓ |
| Regression (11 tests) | PASS ✓ |

### REFACTOR
**Changes:** Fixed test cleanup scripts (rm -rf on git directories failing on macOS)
**All tests:** PASS ✓

---

## TDD-01-1 through TDD-01-4: COMPLETE ✓

**STEP-01 Achievement:** Per-agent git repos implemented
- Each agent now gets `agents/{name}/.git`
- Zero lock conflicts with parallel agents
- Root .git is never modified
- audit.jsonl is gitignored

