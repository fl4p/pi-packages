import { describe, it } from "node:test";
import assert from "node:assert/strict";
import piPlanExtension from "../extensions/plan/index.js";

function harness(branch: unknown[] = [], hasUI = false) {
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown }>();
  const events = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  let activeToolChanges = 0;
  let selectCalls = 0;

  const pi = {
    appendEntry() {},
    getFlag() {
      return false;
    },
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
      events.set(name, [...(events.get(name) ?? []), handler]);
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => unknown }) {
      commands.set(name, options);
    },
    registerFlag() {},
    registerShortcut() {},
    sendMessage() {},
    sendUserMessage() {},
    setActiveTools() {
      activeToolChanges += 1;
    },
  };

  const ctx = {
    hasUI,
    sessionManager: {
      getBranch() {
        return branch;
      },
    },
    ui: {
      notify() {},
      async select() {
        selectCalls += 1;
        return undefined;
      },
      setStatus() {},
      setWidget() {},
      theme: {
        fg(_color: string, text: string) {
          return text;
        },
        muted(text: string) {
          return text;
        },
        strikethrough(text: string) {
          return text;
        },
      },
    },
  };

  piPlanExtension(pi as never);
  return {
    commands,
    ctx,
    events,
    getActiveToolChanges: () => activeToolChanges,
    getSelectCalls: () => selectCalls,
  };
}

describe("pi-plan tool activation", () => {
  it("keeps the active tool schema unchanged when toggling plan mode", async () => {
    const { commands, ctx, getActiveToolChanges } = harness();
    const toggle = commands.get("plan");
    assert.ok(toggle);

    await toggle.handler("", ctx);
    await toggle.handler("", ctx);

    assert.equal(getActiveToolChanges(), 0);
  });

  it("keeps the active tool schema unchanged when restoring plan mode", async () => {
    const branch = [{ type: "custom", customType: "pi-plan", data: { mode: "plan", steps: [] } }];
    const { ctx, events, getActiveToolChanges } = harness(branch);
    const sessionStart = events.get("session_start")?.[0];
    assert.ok(sessionStart);

    await sessionStart({}, ctx);

    assert.equal(getActiveToolChanges(), 0);
  });

  it("waits for a final Plan section before offering execution", async () => {
    const { commands, ctx, events, getSelectCalls } = harness([], true);
    const toggle = commands.get("plan");
    const agentEnd = events.get("agent_end")?.[0];
    assert.ok(toggle);
    assert.ok(agentEnd);

    await toggle.handler("", ctx);
    await agentEnd(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Which compatibility policy should we use?" }],
          },
        ],
      },
      ctx
    );
    assert.equal(getSelectCalls(), 0);

    await agentEnd(
      {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Context:\nUse the existing policy.\n\nPlan:\n1. Update the policy\n2. Run the tests",
              },
            ],
          },
        ],
      },
      ctx
    );
    assert.equal(getSelectCalls(), 1);

    await agentEnd(
      {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Which error policy should refine the existing plan?" }],
          },
        ],
      },
      ctx
    );
    assert.equal(getSelectCalls(), 1);
  });
});
