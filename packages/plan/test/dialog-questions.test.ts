import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DONE_OPTION_LABEL,
  FREEFORM_OPTION_LABEL,
  renderOption,
  runPlanQuestionDialogs,
  supportsPlanQuestionDialogs,
  type PlanQuestionDialogUI,
} from "../src/dialog-questions.js";
import type { PlanQuestion } from "../src/types.js";

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

interface ScriptedCall {
  title: string;
  options: string[];
}

/** Answers each dialog from a script, recording what it was shown. */
function scriptedUi(
  selections: (string | undefined | ((options: string[]) => string | undefined))[],
  inputs: (string | undefined)[] = []
): PlanQuestionDialogUI & { calls: ScriptedCall[]; inputTitles: string[] } {
  const calls: ScriptedCall[] = [];
  const inputTitles: string[] = [];
  let selectIndex = 0;
  let inputIndex = 0;
  return {
    calls,
    inputTitles,
    async select(title, options) {
      calls.push({ title, options: [...options] });
      const next = selections[selectIndex++];
      return typeof next === "function" ? next(options) : next;
    },
    async input(title) {
      inputTitles.push(title);
      return inputs[inputIndex++];
    },
  };
}

describe("supportsPlanQuestionDialogs", () => {
  it("requires both select and input", () => {
    assert.equal(supportsPlanQuestionDialogs(undefined), false);
    assert.equal(supportsPlanQuestionDialogs({}), false);
    assert.equal(supportsPlanQuestionDialogs({ select() {} }), false);
    assert.equal(supportsPlanQuestionDialogs({ select() {}, input() {} }), true);
  });
});

describe("runPlanQuestionDialogs", () => {
  it("shows each option's description and returns the chosen label", async () => {
    const ui = scriptedUi([(options) => options[0]]);
    const result = await runPlanQuestionDialogs([question()], ui);

    assert.equal(result.status, "answered");
    assert.deepEqual(result.answers, [{ id: "runtime", selections: ["Node"] }]);
    assert.equal(ui.calls[0].title, "Runtime: Which runtime should we use?");
    assert.deepEqual(ui.calls[0].options, [
      "Node — Use the existing Node runtime.",
      "Bun — Use Bun for faster startup.",
      FREEFORM_OPTION_LABEL,
    ]);
  });

  it("asks every question in order", async () => {
    const second = question({
      id: "storage",
      header: "Storage",
      question: "Where should results land?",
      options: [
        { label: "SQLite", description: "Single file." },
        { label: "Postgres", description: "Shared server." },
      ],
    });
    const ui = scriptedUi([(o) => o[0], (o) => o[1]]);
    const result = await runPlanQuestionDialogs([question(), second], ui);

    assert.equal(result.status, "answered");
    assert.deepEqual(result.answers, [
      { id: "runtime", selections: ["Node"] },
      { id: "storage", selections: ["Postgres"] },
    ]);
  });

  it("collects a freeform answer through the input dialog", async () => {
    const ui = scriptedUi([FREEFORM_OPTION_LABEL], ["  Deno, actually  "]);
    const result = await runPlanQuestionDialogs([question()], ui);

    assert.equal(result.status, "answered");
    assert.deepEqual(result.answers, [
      { id: "runtime", selections: [], custom: "Deno, actually" },
    ]);
    assert.deepEqual(ui.inputTitles, ["Runtime: your own answer"]);
  });

  it("treats a dismissed or blank freeform input as a cancellation", async () => {
    const dismissed = await runPlanQuestionDialogs(
      [question()],
      scriptedUi([FREEFORM_OPTION_LABEL], [undefined])
    );
    assert.equal(dismissed.status, "cancelled");

    const blank = await runPlanQuestionDialogs(
      [question()],
      scriptedUi([FREEFORM_OPTION_LABEL], ["   "])
    );
    assert.equal(blank.status, "cancelled");
  });

  it("cancels the whole batch when any dialog is dismissed", async () => {
    const ui = scriptedUi([(o) => o[0], undefined]);
    const result = await runPlanQuestionDialogs(
      [question(), question({ id: "storage", header: "Storage" })],
      ui
    );

    assert.equal(result.status, "cancelled");
    // The answers gathered so far are reported for context, but the cancelled
    // status is what the model acts on: a partial batch must not be used.
    assert.deepEqual(result.answers, [{ id: "runtime", selections: ["Node"] }]);
    assert.equal(ui.calls.length, 2);
  });

  it("cancels rather than looping when the host answers with an unknown option", async () => {
    const ui = scriptedUi(["something we never offered"]);
    const result = await runPlanQuestionDialogs([question()], ui);

    assert.equal(result.status, "cancelled");
    assert.equal(ui.calls.length, 1);
  });

  it("cancels when the multi-select freeform input is dismissed or blank", async () => {
    const multi = question({ multiSelect: true });

    const dismissed = await runPlanQuestionDialogs(
      [multi],
      scriptedUi([(o) => o[0], FREEFORM_OPTION_LABEL], [undefined])
    );
    assert.equal(dismissed.status, "cancelled");

    const blank = await runPlanQuestionDialogs(
      [multi],
      scriptedUi([(o) => o[0], FREEFORM_OPTION_LABEL], ["  "])
    );
    assert.equal(blank.status, "cancelled");
  });

  it("only repeats the full question on the first multi-select dialog", async () => {
    const multi = question({ multiSelect: true });
    const ui = scriptedUi([(o) => o[0], (o) => o[1], DONE_OPTION_LABEL]);
    await runPlanQuestionDialogs([multi], ui);

    assert.equal(ui.calls[0].title, "Runtime: Which runtime should we use?");
    assert.equal(ui.calls[1].title, "Runtime: select more, or finish");
    assert.equal(ui.calls[2].title, "Runtime: select more, or finish");
  });

  it("toggles multi-select options and finishes on Done", async () => {
    const multi = question({ multiSelect: true });
    const ui = scriptedUi([
      (o) => o[0],
      (o) => o[1],
      (o) => o[0],
      DONE_OPTION_LABEL,
    ]);
    const result = await runPlanQuestionDialogs([multi], ui);

    assert.equal(result.status, "answered");
    assert.deepEqual(result.answers, [{ id: "runtime", selections: ["Bun"] }]);

    // Done only appears once something is selected, and checkmarks track state.
    assert.equal(ui.calls[0].options.includes(DONE_OPTION_LABEL), false);
    assert.equal(ui.calls[1].options[0], `☑ ${renderOption(multi.options[0])}`);
    assert.equal(ui.calls[1].options.includes(DONE_OPTION_LABEL), true);
    assert.equal(ui.calls[3].options[0], `☐ ${renderOption(multi.options[0])}`);
  });

  it("keeps a freeform answer alongside multi-select choices", async () => {
    const multi = question({ multiSelect: true });
    const ui = scriptedUi(
      [(o) => o[0], FREEFORM_OPTION_LABEL, DONE_OPTION_LABEL],
      ["and also Deno"]
    );
    const result = await runPlanQuestionDialogs([multi], ui);

    assert.equal(result.status, "answered");
    assert.deepEqual(result.answers, [
      { id: "runtime", selections: ["Node"], custom: "and also Deno" },
    ]);
  });

  it("reports aborted without opening a dialog once the signal fires", async () => {
    const controller = new AbortController();
    controller.abort();
    const ui = scriptedUi([(o) => o[0]]);
    const result = await runPlanQuestionDialogs([question()], ui, controller.signal);

    assert.equal(result.status, "aborted");
    assert.equal(ui.calls.length, 0);
  });

  it("reports aborted when the signal fires between questions", async () => {
    const controller = new AbortController();
    const ui: PlanQuestionDialogUI & { calls: number } = {
      calls: 0,
      async select(_title, options) {
        ui.calls += 1;
        controller.abort();
        return options[0];
      },
      async input() {
        return undefined;
      },
    };
    const result = await runPlanQuestionDialogs(
      [question(), question({ id: "storage", header: "Storage" })],
      ui,
      controller.signal
    );

    assert.equal(result.status, "aborted");
    assert.equal(ui.calls, 1);
  });
});
