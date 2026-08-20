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
2. Ask the agent to analyze your code and create a plan
3. The agent outputs a numbered `Plan:` section
4. Choose to **Execute**, **Stay** in plan mode, or **Refine**
5. During execution, progress is tracked via `[DONE:n]` markers
6. Widget shows completion status in real time

### Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode |
| `/plan:status` | Show current plan and progress |

### What gets restricted in plan mode

- **Allowed tools**: `read`, `grep`, `find`, `ls`, and background-job controls
- **Shell runners**: `bash`, `bash_background`, and `monitor` accept only read-only commands
- **Blocked**: All other tool calls, file modifications, git writes, package installs, sudo, and editors

Plan mode keeps the active tool schema unchanged and enforces restrictions at call time. Toggling modes therefore preserves extension tools and provider prompt-cache prefixes.

## License

MIT
