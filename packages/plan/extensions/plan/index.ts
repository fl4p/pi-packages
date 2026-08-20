/**
 * pi-plan Extension
 *
 * Read-only exploration mode with plan-then-execute workflow.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - /plan:status to view current plan and progress
 * - --plan flag to start in plan mode
 * - Multi-layer bash safety (shell constructs, redirects, pipes, whitelist)
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to track step completion during execution
 * - Progress tracking widget during execution
 * - Branch-aware state via session entries
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { extractPlanSteps } from "../../src/planner.js";
import { buildPlanModePrompt } from "../../src/prompt.js";
import {
  checkPlanToolCall,
  PLAN_CONTROL_TOOLS,
  PLAN_READ_ONLY_TOOLS,
  PLAN_SHELL_TOOLS,
} from "../../src/tool-policy.js";
import {
  markCompletedSteps,
  getCompletionStats,
} from "../../src/progress.js";
import type { PlanStep, PlanMode, PlanState } from "../../src/types.js";

const PLAN_MODE_TOOLS = [
  ...PLAN_READ_ONLY_TOOLS,
  ...PLAN_SHELL_TOOLS,
  ...PLAN_CONTROL_TOOLS,
];

export default function piPlanExtension(pi: ExtensionAPI): void {
  let planMode: PlanMode = "normal";
  let steps: PlanStep[] = [];

  // --- Helpers ---

  function persistState(): void {
    pi.appendEntry("pi-plan", { mode: planMode, steps });
  }

  function updateUI(ctx: ExtensionContext): void {
    if (planMode === "execute" && steps.length > 0) {
      const { completed, total } = getCompletionStats(steps);
      ctx.ui.setStatus(
        "pi-plan",
        ctx.ui.theme.fg("accent", `📋 ${completed}/${total}`)
      );
      const lines = steps.map((item) =>
        item.completed
          ? ctx.ui.theme.fg("success", "☑ ") +
            ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
          : `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`
      );
      ctx.ui.setWidget("pi-plan-todos", lines);
    } else if (planMode === "plan") {
      ctx.ui.setStatus("pi-plan", ctx.ui.theme.fg("warning", "⏸ plan"));
      ctx.ui.setWidget("pi-plan-todos", undefined);
    } else {
      ctx.ui.setStatus("pi-plan", undefined);
      ctx.ui.setWidget("pi-plan-todos", undefined);
    }
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    if (planMode === "plan") {
      // Turning off plan mode
      planMode = "normal";
      steps = [];
      ctx.ui.notify("Plan mode disabled. Full access restored.");
    } else {
      // Turning on plan mode (from normal or execute)
      planMode = "plan";
      steps = [];
      ctx.ui.notify(`Plan mode enabled. Allowed tools: ${PLAN_MODE_TOOLS.join(", ")}`);
    }
    persistState();
    updateUI(ctx);
  }

  // --- CLI flag ---

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  // --- Commands ---

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("plan:status", {
    description: "Show current plan and progress",
    handler: async (_args, ctx) => {
      if (steps.length === 0) {
        ctx.ui.notify("No active plan. Use /plan to start.", "info");
        return;
      }
      const list = steps
        .map((s) => `${s.completed ? "✓" : "○"} ${s.text}`)
        .join("\n");
      ctx.ui.notify(`Plan (${planMode}):\n${list}`, "info");
    },
  });

  // --- Shortcut ---

  pi.registerShortcut("ctrl+alt+p", {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  // --- Tool call filter ---

  pi.on("tool_call", async (event) => {
    if (planMode !== "plan") return;

    const result = checkPlanToolCall(event.toolName, event.input);
    if (!result.safe) {
      return { block: true, reason: result.reason };
    }
  });

  // --- Context filter: remove stale pi-plan messages when not in plan mode ---

  pi.on("context", async (event) => {
    if (planMode === "plan") return;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as { customType?: string; role?: string; content?: unknown };
        if (msg.customType === "pi-plan-context") return false;
        if (msg.role !== "user") return true;
        const content = msg.content;
        if (typeof content === "string") {
          return !content.includes("[PLAN MODE ACTIVE]");
        }
        if (Array.isArray(content)) {
          return !content.some(
            (c: { type?: string; text?: string }) =>
              c.type === "text" && c.text?.includes("[PLAN MODE ACTIVE]")
          );
        }
        return true;
      }),
    };
  });

  // --- System prompt injection ---

  pi.on("before_agent_start", async () => {
    if (planMode === "plan") {
      return {
        message: {
          customType: "pi-plan-context",
          content: buildPlanModePrompt(PLAN_MODE_TOOLS),
          display: false,
        },
      };
    }

    if (planMode === "execute" && steps.length > 0) {
      const remaining = steps.filter((s) => !s.completed);
      const todoList = remaining.map((s) => `${s.step}. ${s.text}`).join("\n");
      return {
        message: {
          customType: "pi-plan-context",
          content: `[EXECUTING PLAN — Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
          display: false,
        },
      };
    }
  });

  // --- Track progress during execution ---

  pi.on("turn_end", async (event, ctx) => {
    if (planMode !== "execute" || steps.length === 0) return;
    const msg = event.message;
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    const text = (msg.content as Array<{ type: string; text?: string }>)
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (markCompletedSteps(text, steps) > 0) {
      updateUI(ctx);
      persistState();
    }
  });

  // --- After agent finishes: extract plan or check completion ---

  pi.on("agent_end", async (event, ctx) => {
    // Check if execution is complete
    if (planMode === "execute" && steps.length > 0) {
      const { allDone } = getCompletionStats(steps);
      if (allDone) {
        const completedList = steps.map((s) => `~~${s.text}~~`).join("\n");
        pi.sendMessage(
          {
            customType: "pi-plan-complete",
            content: `**Plan Complete!** ✓\n\n${completedList}`,
            display: true,
          },
          { triggerTurn: false }
        );
        planMode = "normal";
        steps = [];
        persistState();
        updateUI(ctx);
      }
      return;
    }

    if (planMode !== "plan" || !ctx.hasUI) return;

    // Extract todos from last assistant message
    let producedPlan = false;
    const messages = event.messages as Array<{
      role: string;
      content?: unknown;
    }>;
    const lastAssistant = [...messages].reverse().find(
      (m) => m.role === "assistant" && Array.isArray(m.content)
    ) as { role: string; content: Array<{ type: string; text?: string }> } | undefined;

    if (lastAssistant) {
      const text = lastAssistant.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const extracted = extractPlanSteps(text);
      if (extracted.length > 0) {
        steps = extracted;
        producedPlan = true;
        persistState();
      }
    }

    if (!producedPlan) return;

    // Show plan and prompt for next action
    if (steps.length > 0) {
      const list = steps.map((s) => `${s.step}. ☐ ${s.text}`).join("\n");
      pi.sendMessage(
        {
          customType: "pi-plan-todo-list",
          content: `**Plan Steps (${steps.length}):**\n\n${list}`,
          display: true,
        },
        { triggerTurn: false }
      );
    }

    const choice = await ctx.ui.select("Plan mode — what next?", [
      "Execute the plan",
      "Stay in plan mode",
      "Refine the plan",
    ]);

    if (choice?.startsWith("Execute")) {
      planMode = steps.length > 0 ? "execute" : "normal";
      persistState();
      updateUI(ctx);

      const execMsg =
        steps.length > 0
          ? `Execute the plan. Start with: ${steps[0].text}`
          : "Execute the plan you just created.";
      pi.sendMessage(
        { customType: "pi-plan-execute", content: execMsg, display: true },
        { triggerTurn: true }
      );
    } else if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement?.trim()) {
        pi.sendUserMessage(refinement.trim());
      }
    }
  });

  // --- Restore state on session start/resume ---

  pi.on("session_start", async (_event, ctx) => {
    // --plan flag
    if (pi.getFlag("plan") === true) {
      planMode = "plan";
    }

    // Restore from branch entries (branch-aware)
    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type === "custom" &&
        (entry as { customType?: string }).customType === "pi-plan"
      ) {
        const data = (entry as { data?: PlanState }).data;
        if (data) {
          planMode = data.mode ?? planMode;
          steps = data.steps ?? steps;
        }
      }
    }

    // On resume in execute mode: rebuild completion from messages after last execute marker
    if (planMode === "execute" && steps.length > 0) {
      const branch = ctx.sessionManager.getBranch() as Array<{
        type: string;
        customType?: string;
        data?: PlanState;
        message?: { role: string; content?: unknown };
      }>;
      let executeIndex = -1;
      for (let i = branch.length - 1; i >= 0; i--) {
        if (
          branch[i].type === "custom" &&
          branch[i].customType === "pi-plan" &&
          branch[i].data?.mode === "execute"
        ) {
          executeIndex = i;
          break;
        }
      }

      const relevantEntries = branch.slice(executeIndex + 1);
      const allText = relevantEntries
        .filter(
          (e) =>
            e.type === "message" &&
            e.message?.role === "assistant" &&
            Array.isArray(e.message?.content)
        )
        .flatMap((e) =>
          (e.message!.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text!)
        )
        .join("\n");

      markCompletedSteps(allText, steps);
    }

    updateUI(ctx);
  });
}
