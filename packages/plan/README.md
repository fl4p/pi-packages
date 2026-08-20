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
3. If a material decision cannot be discovered, the agent asks a focused question and stays in plan mode
4. Once decision-complete, the agent outputs Context followed by a final numbered `Plan:` section
5. Choose to **Execute**, **Stay** in plan mode, or **Refine**
6. During execution, progress is tracked via `[DONE:n]` markers
7. The widget shows completion status in real time

The five-phase prompt is adapted from the Claude Code/OpenCode workflow for Pi's capabilities. Pi does not allow a plan-file write or require harness-specific agent names. It offers execution only after the current turn contains extractable plan steps.

### Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode |
| `/plan:status` | Show current plan and progress |

### What gets restricted in plan mode

- **Allowed tools**: `read`, `grep`, `find`, `ls`, and background-job controls when registered
- **Shell runners**: `bash`, `bash_background`, and `monitor` accept only read-only commands
- **Blocked**: All other tool calls, project file modifications, git writes, package installs, sudo, and editors

`bash_background`, `monitor`, `background_list`, and `background_stop` require a separate extension that registers them. Background runners may create extension-owned temporary logs.

Plan mode keeps the active tool schema unchanged and enforces restrictions at call time. Toggling modes therefore preserves extension tools and provider prompt-cache prefixes.

## License

MIT
