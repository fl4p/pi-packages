import { checkCommand } from "./safety.js";

export const PLAN_READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
export const PLAN_SHELL_TOOLS = ["bash", "bash_background", "monitor"] as const;
export const PLAN_CONTROL_TOOLS = ["background_list", "background_stop"] as const;

const readOnlyTools = new Set<string>(PLAN_READ_ONLY_TOOLS);
const shellTools = new Set<string>(PLAN_SHELL_TOOLS);
const controlTools = new Set<string>(PLAN_CONTROL_TOOLS);

export function checkPlanToolCall(
  toolName: string,
  input: unknown
): { safe: boolean; reason?: string } {
  if (readOnlyTools.has(toolName) || controlTools.has(toolName)) {
    return { safe: true };
  }

  if (shellTools.has(toolName)) {
    const command =
      input && typeof input === "object" && "command" in input
        ? (input as { command?: unknown }).command
        : undefined;
    if (typeof command !== "string") {
      return {
        safe: false,
        reason: `Plan mode: ${toolName} requires a command string.`,
      };
    }
    return checkCommand(command);
  }

  return {
    safe: false,
    reason: `Plan mode: tool "${toolName}" is not allowed. Use /plan to disable.`,
  };
}
