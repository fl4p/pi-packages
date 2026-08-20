# Claude Code Plan Mode prompt capture

This document records the Plan Mode prompt emitted by Claude Code when its Anthropic API request is redirected to a local mock endpoint.

## Capture metadata

- Claude Code: `2.1.237`
- Captured: `2026-08-20T14:45:43.088Z`
- Invocation mode: non-interactive print mode
- Permission mode: `plan`
- Requested model alias: `sonnet`
- Resolved request model: `claude-sonnet-5`
- Request endpoint: `POST /v1/messages?beta=true`
- Request transport: streaming Anthropic Messages API
- Working directory: newly-created empty temporary directory
- Request body capture: `/tmp/claude-plan-mode-capture-full.json`

The mock endpoint retained request bodies only. It did not retain request headers. The API key was a local dummy value.

The effective invocation was:

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:<ephemeral-port> \
ANTHROPIC_API_KEY=mock-key \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
CLAUDE_CODE_DISABLE_TELEMETRY=1 \
DISABLE_TELEMETRY=1 \
claude -p \
  --permission-mode plan \
  --model sonnet \
  --no-session-persistence \
  --disable-slash-commands \
  --output-format text \
  'Inspect the current directory and produce an implementation plan. Do not implement.'
```

The mock returned a minimal valid Anthropic SSE response so Claude Code could terminate normally. Claude Code exited with status 0.

## Request structure

The captured request contained:

- three top-level `system` blocks;
- two conversation messages;
- the Plan Mode reminder in `messages[1].content`, not in the top-level `system` field;
- the normal non-interactive tool definitions, including `Agent`, `Bash`, `Edit`, `Read`, and `Write`;
- no `AskUserQuestion` or `ExitPlanMode` tool definitions, although the reminder requires them. Those tools require the interactive client, so the print-mode capture establishes the prompt text but not the exact TUI tool surface.

A control run with `--bare` did not include the Plan Mode reminder and exposed only `Bash`, `Edit`, and `Read`. Capturing the runtime prompt therefore required omitting `--bare`.

## Verbatim Plan Mode reminder

The plan filename is generated per run. Everything below is copied verbatim from the request body.

```text
<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
No plan file exists yet. You should create your plan at /Users/fab/.claude/plans/inspect-the-current-directory-cached-dawn.md using the Write tool.
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the Explore subagent type.

1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.

2. **Launch up to 3 Explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigating testing patterns

### Phase 2: Design
Goal: Design an implementation approach.

Launch Plan agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files you identified during exploration to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use AskUserQuestion to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Begin with a **Context** section: explain why this change is being made — the problem or need it addresses, what prompted it, and the intended outcome
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Name the critical files to be modified. For changes that repeat a pattern across many files, describe the pattern once and list a few representative paths — do not enumerate every file or line number
- Reference existing functions and utilities you found that should be reused, with their file paths
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call ExitPlanMode
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call ExitPlanMode to indicate to the user that you are done planning.
This is critical - your turn should only end with either using the AskUserQuestion tool OR calling ExitPlanMode. Do not stop unless it's for these 2 reasons

**Important:** Use AskUserQuestion ONLY to clarify requirements or choose between approaches. Use ExitPlanMode to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no AskUserQuestion. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use ExitPlanMode.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications using the AskUserQuestion tool. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>
```

## Mechanism implied by the capture

Claude Code's prompt defines five explicit phases:

1. explore with read-only actions and Explore agents;
2. delegate design to a Plan agent;
3. review and resolve remaining user decisions;
4. write the selected design into a dedicated plan file;
5. request approval through `ExitPlanMode`.

The plan is a file artifact rather than a numbered list parsed from the final chat response. Approval is also explicit and tool-mediated rather than inferred from the end of an assistant response.

The API request still contains mutating tool definitions. The reminder and client permission mode constrain their use; the request payload itself does not remove `Edit` or `Write`. This differs from implementations that replace the model's active tool list when entering Plan mode.

## Comparison with OpenCode and Codex

Comparison sources are pinned so this analysis remains reproducible:

- [OpenCode `plan-mode.txt` at `b155b156`](https://github.com/anomalyco/opencode/blob/b155b15694dbcc6768f11d2f25cc2bdd1f738ab4/packages/opencode/src/session/prompt/plan-mode.txt)
- [OpenCode short `plan.txt` at `b155b156`](https://github.com/anomalyco/opencode/blob/b155b15694dbcc6768f11d2f25cc2bdd1f738ab4/packages/opencode/src/session/prompt/plan.txt)
- [Codex `plan.md` at `1674b0a`](https://github.com/openai/codex/blob/1674b0a130987522de3f34d080b793585a355da1/codex-rs/collaboration-mode-templates/templates/plan.md)

### Prompt shape

| Property | Claude Code 2.1.237 | OpenCode `plan-mode.txt` | Codex `plan.md` |
| --- | --- | --- | --- |
| Size | 4,950 characters, 59 lines | 4,547 characters, 70 lines | 9,156 characters, 128 lines |
| Structure | Five operational phases | The same five operational phases | Three conversational phases |
| Plan artifact | Dedicated Markdown file | Dedicated Markdown file | `<proposed_plan>` block in chat |
| Exploration | Up to three parallel Explore agents | Up to three parallel explore agents | Main agent explores; no agent quota |
| Design review | Normally requires one Plan agent | Requests a general agent, but retains one stale reference to a Plan agent | Main agent chats until implementation decisions are complete |
| Questions | `AskUserQuestion`, for requirements and approach choices | `question`, after exploration and during review | `request_user_input`, only for material or non-discoverable decisions |
| Completion | Must call `ExitPlanMode` | Must call `plan_exit` | Emit a complete `<proposed_plan>`; user/client changes mode separately |
| Mutation rule | Read-only except the plan file | Read-only except the plan file | No repo-tracked mutation; tests/builds may write ignored artifacts |
| Final-plan emphasis | Context, recommended approach, critical files, reusable code, verification | Recommended approach, critical files, verification | Decision completeness, public interfaces, tests, assumptions, compact behavior-level description |

### Claude and OpenCode are the same prompt family

The captured Claude reminder and OpenCode's experimental `plan-mode.txt` have 75% character-sequence similarity, 60.5% line-sequence similarity, and 24 identical non-empty lines. They share the same opening rule, plan-file exception, five phase names, parallel exploration limit, design-agent step, review step, final-plan requirements, and mandatory exit-tool ending.

The meaningful adaptations are:

- OpenCode substitutes `${planInfo}` for Claude's generated `~/.claude/plans/*.md` path.
- OpenCode uses `explore`, `question`, and `plan_exit`; Claude uses `Explore`, `AskUserQuestion`, and `ExitPlanMode`.
- OpenCode asks a general agent to design the plan. Its following guideline still says "Plan agent," leaving an internal terminology mismatch.
- Claude adds instructions to find and reuse existing functions, begin with a Context section, reference reusable utilities, and avoid exhaustive file lists.
- OpenCode asks questions immediately after exploration and contains more examples of when multiple design perspectives help.
- Claude tightens the approval rule by listing forbidden textual substitutes for `ExitPlanMode`.
- Claude spells "supercedes" in the captured prompt; OpenCode spells "supersedes."

OpenCode also has a separate short `plan.txt` path selected by its runtime configuration. That prompt only imposes strict read-only behavior, asks for read/search/delegation and clarification, and requests a comprehensive but concise plan. It does not define a plan file, five phases, or an explicit exit protocol.

### Codex is structurally different

Codex treats planning as specification elicitation rather than a fixed agent workflow:

1. **Ground in the environment:** discover repo and system facts before asking questions.
2. **Intent chat:** resolve goals, success criteria, scope, constraints, audience, and tradeoffs.
3. **Implementation chat:** resolve architecture, interfaces, data flow, failure modes, testing, rollout, and compatibility until the plan is decision-complete.

Its strongest distinction is the treatment of unknowns. Discoverable facts must be investigated; preferences and tradeoffs should be asked early with two to four meaningful choices and a recommended default. Unanswered choices become explicit assumptions. Claude and OpenCode say not to make large assumptions, but do not provide this decision rule.

Codex is also more precise about non-mutating execution. It explicitly permits tests, builds, dry runs, caches, and build artifacts when repo-tracked files remain unchanged. Claude and OpenCode use the broader term "read-only," which is simpler but less clear for commands that produce disposable artifacts.

The final artifact differs fundamentally. Claude and OpenCode incrementally maintain a plan file and use an exit tool to request approval. Codex produces at most one complete `<proposed_plan>` block per turn, forbids asking "should I proceed?", and leaves mode switching to the client. It explicitly keeps collaboration mode separate from its `update_plan` progress tool.

Codex's final-output guidance prefers grouped behavior-level changes and normally no more than three file paths. Claude and OpenCode are more file-oriented. Codex is therefore stronger at producing implementation contracts, while the Claude/OpenCode family is stronger at enforcing a deterministic research/delegation/handoff procedure.

### Prompt authority and runtime enforcement

Claude and OpenCode both format their instructions as `<system-reminder>` text carried in conversation content. Codex installs Plan Mode as collaboration-mode developer instructions, giving it a higher protocol role than an ordinary user-content reminder.

Prompt text is not the whole safety mechanism:

- Claude's captured request still exposed `Edit` and `Write`; its client permission mode must enforce the plan-file exception.
- OpenCode's plan agent has permission rules that deny ordinary edits while allowing its plan file, but shell safety still depends substantially on model compliance.
- Codex collaboration mode does not itself select a read-only sandbox. Its prohibition on repo mutation is prompt-level unless a separate sandbox or approval policy enforces it.

### Implications for Pi Plan

The strongest combination for Pi Plan would be:

- Codex's explore-first rule, discoverable-fact versus preference distinction, and decision-complete final contract;
- Claude/OpenCode's explicit completion tool and persisted plan artifact;
- an explicit plan delimiter or artifact rather than parsing every numbered line after `Plan:`;
- capability-based runtime mutation enforcement rather than replacing the complete active-tool list;
- optional, task-dependent delegation instead of mandatory agent counts.

## Limitations

- The capture used `-p`, so it does not establish the interactive TUI's complete tool list.
- User-level Claude configuration was loaded because `--bare` suppresses the Plan Mode reminder. The exact Plan Mode block was isolated from the surrounding user configuration and agent catalogue.
- The generated plan path and model resolution may vary between installations and runs.
- This records behavior of Claude Code `2.1.237`; it is not a stable public interface.
