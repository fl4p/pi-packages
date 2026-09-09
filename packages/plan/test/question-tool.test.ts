import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER, visibleWidth } from "@mariozechner/pi-tui";
import {
  PlanQuestionParameters,
  PlanQuestionnaireComponent,
  registerPlanQuestionTool,
} from "../extensions/plan/question-tool.js";
import type {
  PlanMode,
  PlanQuestion,
  PlanQuestionnaireResult,
} from "../src/types.js";

const ENTER = "\r";
const SPACE = " ";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const ESCAPE = "\x1b";
const TAB = "\t";
const BACKSPACE = "\x7f";

function question(overrides: Partial<PlanQuestion> = {}): PlanQuestion {
  return {
    id: "runtime",
    header: "Runtime",
    question: "Which runtime should we use?",
    options: [
      { label: "Node", description: "Use the existing Node runtime." },
      { label: "Bun", description: "Use Bun for faster startup." },
    ],
    multiSelect: false,
    ...overrides,
  };
}

const theme = {
  fg(_color: string, text: string) {
    return text;
  },
  bg(_color: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
};

function componentHarness(
  questions: PlanQuestion[],
  signal?: AbortSignal
): {
  component: PlanQuestionnaireComponent;
  results: PlanQuestionnaireResult[];
  renders: () => number;
} {
  const results: PlanQuestionnaireResult[] = [];
  let renderCount = 0;
  const tui = {
    terminal: { rows: 40 },
    requestRender() {
      renderCount += 1;
    },
  };
  const component = new PlanQuestionnaireComponent(
    questions,
    tui as never,
    theme as never,
    (result) => results.push(result),
    signal
  );
  return { component, results, renders: () => renderCount };
}

class FakeAbortSignal {
  aborted = false;
  addCount = 0;
  removeCount = 0;
  private listener: (() => void) | undefined;

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.addCount += 1;
    this.listener =
      typeof listener === "function" ? () => listener(new Event("abort")) : () => listener.handleEvent(new Event("abort"));
  }

  removeEventListener(): void {
    this.removeCount += 1;
    this.listener = undefined;
  }

  abort(): void {
    this.aborted = true;
    this.listener?.();
  }
}

describe("PlanQuestionParameters", () => {
  it("emits a strict provider-safe bounded schema", () => {
    const schema = PlanQuestionParameters as unknown as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        questions: {
          minItems: number;
          maxItems: number;
          items: {
            additionalProperties: boolean;
            required: string[];
            properties: {
              header: { maxLength: number };
              options: {
                minItems: number;
                maxItems: number;
                items: { additionalProperties: boolean; required: string[] };
              };
            };
          };
        };
      };
    };

    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ["questions"]);
    assert.equal(schema.properties.questions.minItems, 1);
    assert.equal(schema.properties.questions.maxItems, 4);
    assert.equal(schema.properties.questions.items.additionalProperties, false);
    assert.deepEqual(schema.properties.questions.items.required, [
      "id",
      "header",
      "question",
      "options",
      "multiSelect",
    ]);
    assert.equal(schema.properties.questions.items.properties.header.maxLength, 12);
    assert.equal(schema.properties.questions.items.properties.options.minItems, 2);
    assert.equal(schema.properties.questions.items.properties.options.maxItems, 4);
    assert.equal(
      schema.properties.questions.items.properties.options.items.additionalProperties,
      false
    );
    assert.deepEqual(
      schema.properties.questions.items.properties.options.items.required,
      ["label", "description"]
    );
    assert.doesNotMatch(JSON.stringify(schema), /anyOf|oneOf/);
  });
});

describe("PlanQuestionnaireComponent", () => {
  it("requires Review submission even for one single-select question", () => {
    const { component, results } = componentHarness([question()]);
    component.handleInput(ENTER);
    assert.equal(results.length, 0);
    assert.match(component.render(80).join("\n"), /Review answers/);

    component.handleInput(ENTER);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "answered");
    assert.deepEqual(results[0].answers, [
      { id: "runtime", selections: ["Node"] },
    ]);

    component.handleInput(ESCAPE);
    component.dispose();
    assert.equal(results.length, 1);
  });

  it("navigates a batch and submits answers in question order", () => {
    const { component, results } = componentHarness([
      question(),
      question({ id: "storage", header: "Storage" }),
    ]);
    component.handleInput(ENTER);
    assert.match(component.render(80).join("\n"), /Which runtime/);
    component.handleInput(DOWN);
    component.handleInput(ENTER);
    assert.match(component.render(80).join("\n"), /Review answers/);
    component.handleInput(ENTER);

    assert.deepEqual(results[0].answers, [
      { id: "runtime", selections: ["Node"] },
      { id: "storage", selections: ["Bun"] },
    ]);
  });

  it("supports multi-select plus custom text and restores the custom editor", () => {
    const { component, results } = componentHarness([
      question({ id: "features", multiSelect: true }),
    ]);
    component.focused = true;
    component.handleInput(SPACE);
    component.handleInput(DOWN);
    component.handleInput(SPACE);
    component.handleInput(DOWN);
    component.handleInput(ENTER);
    assert.ok(component.render(80).join("\n").includes(CURSOR_MARKER));
    for (const character of "Deno") component.handleInput(character);
    component.handleInput(ENTER);
    assert.match(component.render(80).join("\n"), /Review answers/);

    component.handleInput(LEFT);
    component.handleInput(ENTER);
    const editing = component.render(80).join("\n");
    assert.match(editing, /Deno/);
    assert.ok(editing.includes(CURSOR_MARKER));
    component.handleInput(ESCAPE);
    assert.ok(!component.render(80).join("\n").includes(CURSOR_MARKER));

    component.handleInput(TAB);
    component.handleInput(ENTER);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].answers, [
      { id: "features", selections: ["Node", "Bun"], custom: "Deno" },
    ]);
  });

  it("does not advance or submit when the last custom value is cleared", () => {
    const { component, results } = componentHarness([question()]);
    component.handleInput(DOWN);
    component.handleInput(DOWN);
    component.handleInput(ENTER);
    for (const character of "Deno") component.handleInput(character);
    component.handleInput(ENTER);
    component.handleInput(LEFT);
    component.handleInput(ENTER);
    for (let i = 0; i < 4; i += 1) component.handleInput(BACKSPACE);
    component.handleInput(ENTER);

    assert.match(component.render(80).join("\n"), /Which runtime/);
    component.handleInput(TAB);
    component.handleInput(ENTER);
    assert.equal(results.length, 0);
  });

  it("keeps every rendered line within changing widths", () => {
    const { component } = componentHarness([question()]);
    for (const width of [1, 8, 24, 80, 12]) {
      for (const line of component.render(width)) {
        assert.ok(
          visibleWidth(line) <= width,
          `line width ${visibleWidth(line)} exceeded ${width}: ${line}`
        );
      }
    }

    component.handleInput(DOWN);
    component.handleInput(DOWN);
    component.focused = true;
    component.handleInput(ENTER);
    for (const width of [1, 10, 40]) {
      for (const line of component.render(width)) {
        assert.ok(visibleWidth(line) <= width);
      }
    }
  });

  it("handles a signal that aborts before listener registration completes", () => {
    const signal = new FakeAbortSignal();
    signal.aborted = true;
    const { component, results } = componentHarness(
      [question()],
      signal as unknown as AbortSignal
    );
    assert.equal(component.isFinished, true);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "aborted");
    assert.equal(signal.addCount, 1);
    assert.equal(signal.removeCount, 1);
  });

  it("guards cancellation races and removes the abort listener once", () => {
    const signal = new FakeAbortSignal();
    const { component, results } = componentHarness(
      [question()],
      signal as unknown as AbortSignal
    );
    assert.equal(signal.addCount, 1);

    signal.abort();
    component.handleInput(ESCAPE);
    component.dispose();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "aborted");
    assert.equal(signal.removeCount, 1);
    assert.equal(component.isFinished, true);
  });

  it("cancels the questionnaire but not an in-progress custom edit", () => {
    const { component, results } = componentHarness([question()]);
    component.handleInput(DOWN);
    component.handleInput(DOWN);
    component.handleInput(ENTER);
    component.handleInput(ESCAPE);
    assert.equal(results.length, 0);
    component.handleInput(ESCAPE);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "cancelled");
  });
});

type RegisteredTool = {
  name: string;
  executionMode?: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: { questions: PlanQuestion[] },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: {
      hasUI: boolean;
      ui: {
        custom: <T>(factory: (...args: never[]) => unknown) => Promise<T | undefined>;
      };
    }
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: PlanQuestionnaireResult;
  }>;
};

function registeredTool(initialMode: PlanMode = "plan") {
  let mode = initialMode;
  const tools: RegisteredTool[] = [];
  registerPlanQuestionTool(
    {
      registerTool(tool: unknown) {
        tools.push(tool as RegisteredTool);
      },
    } as never,
    () => mode
  );
  return {
    tool: tools[0],
    tools,
    setMode(next: PlanMode) {
      mode = next;
    },
  };
}

describe("registerPlanQuestionTool", () => {
  it("registers one sequential tool and rejects non-plan modes", async () => {
    const { tool, tools, setMode } = registeredTool("normal");
    assert.equal(tools.length, 1);
    assert.equal(tool.name, "plan_question");
    assert.equal(tool.executionMode, "sequential");

    const ctx = { hasUI: false, ui: { async custom() { return undefined; } } };
    await assert.rejects(
      tool.execute("call", { questions: [question()] }, undefined, undefined, ctx),
      /only while Plan Mode is active/
    );
    setMode("execute");
    await assert.rejects(
      tool.execute("call", { questions: [question()] }, undefined, undefined, ctx),
      /only while Plan Mode is active/
    );
  });

  it("returns unavailable without UI and when the TUI questionnaire has no result", async () => {
    const { tool } = registeredTool();
    const noUi = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      { hasUI: false, mode: "tui", ui: { async custom() { return undefined; } } }
    );
    assert.equal(noUi.details.status, "unavailable");
    assert.match(noUi.content[0].text, /ask the same questions in plain text/i);

    const dismissed = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      { hasUI: true, mode: "tui", ui: { async custom() { return undefined; } } }
    );
    assert.equal(dismissed.details.status, "unavailable");
  });

  it("returns unavailable when a non-TUI host offers no dialog surface", async () => {
    const { tool } = registeredTool();
    const result = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      { hasUI: true, mode: "print", ui: { async custom() { return undefined; } } }
    );
    assert.equal(result.details.status, "unavailable");
  });

  it("asks through dialogs instead of the TUI questionnaire in rpc mode", async () => {
    const { tool } = registeredTool();
    const titles: string[] = [];
    let customCalls = 0;
    const result = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      {
        hasUI: true,
        mode: "rpc",
        ui: {
          async custom() {
            customCalls += 1;
            return undefined;
          },
          async select(title: string, options: string[]) {
            titles.push(title);
            return options[1];
          },
          async input() {
            return undefined;
          },
        },
      }
    );

    assert.equal(customCalls, 0);
    assert.deepEqual(titles, ["Runtime: Which runtime should we use?"]);
    assert.equal(result.details.status, "answered");
    assert.deepEqual(result.details.answers, [
      { id: "runtime", selections: ["Bun"] },
    ]);
    assert.match(result.content[0].text, /PLAN_QUESTION_STATUS: answered/);
  });

  it("falls back to dialogs when a host too old to report its mode has no component", async () => {
    const { tool } = registeredTool();
    let customCalls = 0;
    const result = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      {
        hasUI: true,
        ui: {
          async custom() {
            customCalls += 1;
            return undefined;
          },
          async select(_title: string, options: string[]) {
            return options[0];
          },
          async input() {
            return undefined;
          },
        },
      }
    );

    assert.equal(customCalls, 1);
    assert.equal(result.details.status, "answered");
    assert.deepEqual(result.details.answers, [
      { id: "runtime", selections: ["Node"] },
    ]);
  });

  it("reports cancelled when an rpc dialog is dismissed", async () => {
    const { tool } = registeredTool();
    const result = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      {
        hasUI: true,
        mode: "rpc",
        ui: {
          async select() {
            return undefined;
          },
          async input() {
            return undefined;
          },
        },
      }
    );
    assert.equal(result.details.status, "cancelled");
    assert.match(result.content[0].text, /Do not re-ask/);
  });

  it("returns aborted before opening UI", async () => {
    const { tool } = registeredTool();
    const controller = new AbortController();
    controller.abort();
    let customCalls = 0;
    const result = await tool.execute(
      "call",
      { questions: [question()] },
      controller.signal,
      undefined,
      {
        hasUI: true,
        mode: "tui",
        ui: {
          async custom() {
            customCalls += 1;
            return undefined;
          },
        },
      }
    );
    assert.equal(customCalls, 0);
    assert.equal(result.details.status, "aborted");
    assert.match(result.content[0].text, /Make no assumptions/);
  });

  it("returns answered and cancelled structured UI results", async () => {
    const { tool } = registeredTool();
    const answered: PlanQuestionnaireResult = {
      questions: [question()],
      answers: [{ id: "runtime", selections: ["Node"] }],
      status: "answered",
    };
    const answerResult = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      { hasUI: true, mode: "tui", ui: { async custom<T>() { return answered as T; } } }
    );
    assert.match(answerResult.content[0].text, /PLAN_QUESTION_STATUS: answered/);
    assert.match(answerResult.content[0].text, /runtime.*Node/);

    const cancelled: PlanQuestionnaireResult = {
      questions: [question()],
      answers: [],
      status: "cancelled",
    };
    const cancelResult = await tool.execute(
      "call",
      { questions: [question()] },
      undefined,
      undefined,
      { hasUI: true, mode: "tui", ui: { async custom<T>() { return cancelled as T; } } }
    );
    assert.match(cancelResult.content[0].text, /PLAN_QUESTION_STATUS: cancelled/);
    assert.match(cancelResult.content[0].text, /Do not re-ask/);
  });
});
