import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPlanQuestionAnswers,
  normalizePlanQuestions,
  PlanQuestionnaireState,
} from "../src/questions.js";
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

describe("normalizePlanQuestions", () => {
  it("trims values and permits duplicate headers", () => {
    const result = normalizePlanQuestions([
      question({
        id: " runtime ",
        header: " Choice ",
        question: " Which runtime? ",
        options: [
          { label: " Node ", description: " Existing runtime. " },
          { label: " Bun ", description: " Alternative runtime. " },
        ],
      }),
      question({ id: "storage", header: "Choice" }),
    ]);

    assert.equal(result[0].id, "runtime");
    assert.equal(result[0].header, "Choice");
    assert.equal(result[0].question, "Which runtime?");
    assert.deepEqual(result[0].options[0], {
      label: "Node",
      description: "Existing runtime.",
    });
    assert.equal(result[1].header, "Choice");
  });

  it("enforces question and option bounds", () => {
    assert.throws(() => normalizePlanQuestions([]), /1 to 4 questions/);
    assert.throws(
      () => normalizePlanQuestions(Array.from({ length: 5 }, (_, i) => question({ id: `q_${i}` }))),
      /1 to 4 questions/
    );
    assert.throws(
      () => normalizePlanQuestions([question({ options: [question().options[0]] })]),
      /2 to 4 options/
    );
    assert.throws(
      () =>
        normalizePlanQuestions([
          question({
            options: Array.from({ length: 5 }, (_, i) => ({
              label: `Option ${i}`,
              description: `Description ${i}`,
            })),
          }),
        ]),
      /2 to 4 options/
    );
  });

  it("rejects blank, invalid, and duplicate normalized fields", () => {
    assert.throws(() => normalizePlanQuestions([question({ id: " " })]), /id must not be blank/);
    assert.throws(() => normalizePlanQuestions([question({ id: "Not Snake" })]), /snake_case/);
    assert.throws(() => normalizePlanQuestions([question({ header: " " })]), /header must not be blank/);
    assert.throws(() => normalizePlanQuestions([question({ header: "More Than Twelve" })]), /at most 12/);
    assert.throws(() => normalizePlanQuestions([question({ question: " " })]), /prompt must not be blank/);
    assert.throws(
      () => normalizePlanQuestions([question(), question({ id: " runtime " })]),
      /duplicated/
    );
    assert.throws(
      () =>
        normalizePlanQuestions([
          question({
            options: [
              { label: "Node", description: "First." },
              { label: " Node ", description: "Second." },
            ],
          }),
        ]),
      /option label.*duplicated/
    );
    assert.throws(
      () =>
        normalizePlanQuestions([
          question({
            options: [
              { label: " ", description: "First." },
              { label: "Bun", description: "Second." },
            ],
          }),
        ]),
      /label must not be blank/
    );
    assert.throws(
      () =>
        normalizePlanQuestions([
          question({
            options: [
              { label: "Node", description: " " },
              { label: "Bun", description: "Second." },
            ],
          }),
        ]),
      /description must not be blank/
    );
  });
});

describe("PlanQuestionnaireState", () => {
  it("replaces single-select answers with custom text and clears empty custom answers", () => {
    const state = new PlanQuestionnaireState([question()]);
    state.selectSingle("Node", 0);
    assert.deepEqual(state.getAnswer("runtime"), {
      id: "runtime",
      selections: ["Node"],
    });
    state.setCustom("runtime", "  ");
    assert.deepEqual(state.getAnswer("runtime"), {
      id: "runtime",
      selections: ["Node"],
    });

    state.setCustom("runtime", "Use Deno instead");
    assert.deepEqual(state.getAnswer("runtime"), {
      id: "runtime",
      selections: [],
      custom: "Use Deno instead",
    });

    state.setCustom("runtime", "  ");
    assert.equal(state.getAnswer("runtime"), undefined);
    assert.equal(state.isAnswered("runtime"), false);
  });

  it("combines and removes multi-select and custom values", () => {
    const state = new PlanQuestionnaireState([
      question({ id: "features", multiSelect: true }),
    ]);
    state.toggleMulti("Node", 0);
    state.toggleMulti("Bun", 1);
    state.setCustom("features", "Deno");
    assert.deepEqual(state.getAnswer("features"), {
      id: "features",
      selections: ["Node", "Bun"],
      custom: "Deno",
    });

    state.toggleMulti("Node", 0);
    state.toggleMulti("Bun", 1);
    assert.equal(state.isAnswered("features"), true);
    state.setCustom("features", "");
    assert.equal(state.getAnswer("features"), undefined);
  });

  it("restores each question's option index across tab navigation", () => {
    const state = new PlanQuestionnaireState([
      question(),
      question({ id: "storage", header: "Storage" }),
    ]);
    state.setOptionIndex(2);
    state.moveTab(1);
    state.setOptionIndex(1);
    state.moveTab(-1);
    assert.equal(state.currentOptionIndex, 2);
    state.moveTab(1);
    assert.equal(state.currentOptionIndex, 1);
  });

  it("tracks completion and emits answers in question order", () => {
    const questions = [
      question(),
      question({ id: "features", header: "Features", multiSelect: true }),
    ];
    const state = new PlanQuestionnaireState(questions);
    state.moveTab(1);
    state.toggleMulti("Bun", 1);
    state.moveTab(-1);
    state.selectSingle("Node", 0);

    assert.equal(state.allAnswered, true);
    assert.deepEqual(state.orderedAnswers().map((answer) => answer.id), [
      "runtime",
      "features",
    ]);
  });
});

describe("formatPlanQuestionAnswers", () => {
  it("formats selections and custom answers in question order", () => {
    const questions = [
      question(),
      question({ id: "features", header: "Features", multiSelect: true }),
    ];
    const text = formatPlanQuestionAnswers(questions, [
      { id: "features", selections: ["Node", "Bun"], custom: "Deno" },
      { id: "runtime", selections: ["Node"] },
    ]);

    assert.equal(
      text,
      [
        "PLAN_QUESTION_STATUS: answered",
        '- runtime (Runtime): selected "Node"',
        '- features (Features): selected "Node", "Bun"; wrote "Deno"',
      ].join("\n")
    );
  });
});
