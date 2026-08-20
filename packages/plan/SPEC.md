# pi-plan Specification

## Overview

Plan mode for pi — a read-only exploration mode for safe code analysis and structured plan execution.

## Modes

| Mode | Tool calls | Description |
|------|------------|-------------|
| **normal** | Unrestricted | Default — full access |
| **plan** | Read-only allowlist | Read-only exploration |
| **execute** | Unrestricted | Full access + progress tracking |

## Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode on/off |
| `/plan:status` | Show current plan and progress |

## Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Alt+P` | Toggle plan mode |

## Flags

| Flag | Type | Description |
|------|------|-------------|
| `--plan` | boolean | Start in plan mode |

## Flow

```
normal ──/plan──► plan ──"Execute"──► execute ──(all done)──► normal
                   │                                      ▲
                   └───────────/plan──────────────────────┘
```

1. User runs `/plan` or `--plan` to enter plan mode
2. The extension injects a read-only, five-phase planning workflow
3. The LLM explores the codebase before asking discoverable questions
4. If material decisions remain, the LLM asks focused questions without emitting a final `Plan:` section; Pi stays in plan mode without offering execution
5. Once decision-complete, the LLM emits a Context section followed by a final numbered `Plan:` section
6. Steps are extracted and the user chooses: Execute / Stay / Refine
7. On execute: call restrictions are removed and progress is tracked via `[DONE:n]` markers
8. When all steps complete: notification, return to normal mode

## State

State is persisted via `pi.appendEntry("pi-plan", ...)` with branch-aware restoration via `getBranch()`.

## Architecture

```
extensions/plan/index.ts  — Extension entry (commands, events, UI)
src/types.ts              — PlanState, PlanStep, PlanMode
src/safety.ts             — Shell command safety (whitelist/blacklist)
src/tool-policy.ts        — Plan-mode tool-call allowlist
src/prompt.ts             — Five-phase planning prompt
src/planner.ts            — Extract plan steps from LLM output
src/progress.ts           — [DONE:n] parsing and completion stats
```

## Planning workflow

The prompt adapts the Claude Code/OpenCode workflow to Pi's capabilities:

1. **Initial understanding** — inspect the repository, reuse existing patterns, and resolve discoverable facts before asking the user
2. **Design** — choose a recommended implementation approach and identify tradeoffs
3. **Review** — reread critical files and resolve material user decisions
4. **Final plan** — provide Context and a final numbered `Plan:` section with critical files, reusable code, and verification
5. **Handoff** — end after the plan; Pi presents Execute / Stay / Refine

Pi does not grant a plan-file write exception or require harness-specific agent names. The assistant asks clarification questions in chat and omits the final `Plan:` section until the plan is ready. The handoff dialog appears only when the current turn contains extractable plan steps.

The final `Plan:` section must be the last section in the response. Its top-level numbered lines are execution steps; other detail uses unnumbered bullets so the extractor cannot confuse questions or supporting material with steps.

## Plan-mode tool policy

The active tool schema stays unchanged across mode transitions. Plan mode blocks disallowed calls in the `tool_call` hook, preserving extension tools and provider prompt-cache prefixes.

Allowed tools: read, grep, find, ls, background_list, and background_stop. Background tools are usable only when another extension registers them and may create extension-owned temporary logs.

Shell runners `bash`, `bash_background`, and `monitor` share the read-only command policy below. Other tools are blocked by default.

## Safe commands

Allowed: cat, head, tail, grep, rg, fd, read-only find, ls, pwd, tree, echo, wc, sort, diff, jq, cut, stat, du, constrained git status/log/diff/show/branch, npm list/outdated, etc. Every pipeline segment is checked independently.

Blocked: shell and process substitution; shell interpreters in pipelines; find/fd execution or deletion; output-file options; rm, mv, cp, mkdir, chmod, git writes, npm install/audit fix, network commands, sudo, editors, and unknown commands.
