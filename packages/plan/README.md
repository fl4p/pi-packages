# pi-plan

Plan mode for pi — read-only exploration and structured plan execution.

## Install

```bash
pi install npm:pi-plan
```

## Usage

### Toggle plan mode

```
/plan
```

Or press `Ctrl+Alt+P`, or start with `--plan` flag:

```bash
pi --plan
```

### Workflow

1. Run `/plan` to enter read-only plan mode
2. The agent explores the repository and reuses existing patterns before designing changes
3. If material decisions cannot be discovered, the agent opens one questionnaire containing up to four related questions
4. Once decision-complete, the agent outputs Context followed by a final numbered `Plan:` section
5. Choose to **Execute**, **Stay** in plan mode, or **Refine**
6. During execution, progress is tracked via `[DONE:n]` markers
7. The widget shows completion status in real time

The five-phase prompt is adapted from the Claude Code/OpenCode workflow for Pi's capabilities. Pi does not allow a plan-file write or require harness-specific agent names. It offers execution only after the current turn contains extractable plan steps.

### Planning questions

`plan_question` provides Claude-style batched clarification in TUI mode:

- 1–4 related questions per dialog
- 2–4 described options per question
- Single-select or multi-select per question
- A freeform answer for every question
- Editable question tabs and a final Review submission

The agent investigates discoverable facts before opening the questionnaire. Submitted answers are authoritative. Cancelling or aborting leaves the decision unresolved and prevents a final plan; when interactive UI is unavailable, the agent asks the same questions in plain text instead.

### Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode |
| `/plan:status` | Show current plan and progress |

### What gets restricted in plan mode

- **Allowed tools**: `read`, `grep`, `find`, `ls`, `plan_question`, and background-job controls when registered
- **Shell runners**: `bash`, `bash_background`, and `monitor` accept only read-only commands
- **Blocked**: All other tool calls, project file modifications, git writes, package installs, sudo, and editors

`bash_background`, `monitor`, `background_list`, and `background_stop` require a separate extension that registers them. Background runners may create extension-owned temporary logs.

Plan mode keeps the active tool schema unchanged and enforces restrictions at call time. Toggling modes therefore preserves extension tools and provider prompt-cache prefixes.

## License

MIT
