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
3. The LLM explores the codebase before asking questions whose answers are discoverable
4. If material decisions remain, the LLM uses `plan_question` for a batch of related choices; cancellation or unresolved answers keep Pi in plan mode without offering execution
5. Once decision-complete, the LLM emits a Context section followed by a final numbered `Plan:` section
6. Steps are extracted and the user chooses: Execute / Stay / Refine
7. On execute: call restrictions are removed and progress is tracked via `[DONE:n]` markers
8. When all steps complete: notification, return to normal mode

## State

State is persisted via `pi.appendEntry("pi-plan", ...)` with branch-aware restoration via `getBranch()`.

## Architecture

```
extensions/plan/index.ts          — Extension entry (commands, events, UI)
extensions/plan/question-tool.ts  — Batched question tool and TUI component
src/types.ts                      — Plan and questionnaire types
src/questions.ts                  — Question validation, answer state, formatting
src/safety.ts                     — Shell command safety (whitelist/blacklist)
src/tool-policy.ts                — Plan-mode tool-call allowlist
src/prompt.ts                     — Five-phase planning prompt
src/planner.ts                    — Extract plan steps from LLM output
src/progress.ts                   — [DONE:n] parsing and completion stats
```

## Planning workflow

The prompt adapts the Claude Code/OpenCode workflow to Pi's capabilities:

1. **Initial understanding** — inspect the repository, reuse existing patterns, resolve discoverable facts, then batch material user decisions through `plan_question`
2. **Design** — consume questionnaire answers as authoritative, choose a recommended implementation approach, and identify tradeoffs
3. **Review** — reread critical files and resolve any remaining material decisions before producing a plan
4. **Final plan** — provide Context and a final numbered `Plan:` section with critical files, reusable code, and verification
5. **Handoff** — end after the plan; Pi presents Execute / Stay / Refine

Pi does not grant a plan-file write exception or require harness-specific agent names. In TUI mode, `plan_question` presents 1–4 related questions with 2–4 described choices each, per-question multi-select, freeform answers, editable tabs, and a Review submission. If interactive UI is unavailable, the assistant falls back to the same questions in plain text. Cancelled or aborted questionnaires never authorize assumptions or a final plan. The handoff dialog appears only when the current turn contains extractable plan steps.

The final `Plan:` section must be the last section in the response. Its top-level numbered lines are execution steps; other detail uses unnumbered bullets so the extractor cannot confuse questions or supporting material with steps.

## Plan-mode tool policy

The active tool schema stays unchanged across mode transitions. Plan mode blocks disallowed calls in the `tool_call` hook, preserving extension tools and provider prompt-cache prefixes.

Allowed tools: read, grep, find, ls, `plan_question`, background_list, and background_stop. `plan_question` is always registered for schema stability but its executor accepts calls only in plan mode. Background tools are usable only when another extension registers them and may create extension-owned temporary logs.

Shell runners `bash`, `bash_background`, and `monitor` share the read-only command policy below. Other tools are blocked by default.

## Safe commands

Allowed: cat, head, tail, grep, rg, fd, read-only find, ls, pwd, tree, echo, wc, sort, diff, jq, cut, stat, du, constrained git status/log/diff/show/branch, npm list/outdated, etc. Every pipeline segment is checked independently.

Blocked: shell and process substitution; shell interpreters in pipelines; find/fd execution or deletion; output-file options; rm, mv, cp, mkdir, chmod, git writes, npm install/audit fix, network commands, sudo, editors, and unknown commands.
