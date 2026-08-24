import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlanModePrompt } from "../src/prompt.js";

describe("buildPlanModePrompt", () => {
  it("states the runtime read-only policy and available tools", () => {
    const prompt = buildPlanModePrompt(["read", "bash", "monitor"]);

    assert.match(prompt, /MUST NOT edit files/);
    assert.match(prompt, /read, bash, monitor/);
    assert.match(prompt, /Shell commands must pass Pi's read-only allowlist/);
    assert.match(prompt, /Do not write a plan file/);
  });

  it("defines the adapted five-phase planning workflow", () => {
    const prompt = buildPlanModePrompt(["read"]);

    assert.match(prompt, /### Phase 1: Initial understanding/);
    assert.match(prompt, /### Phase 2: Design/);
    assert.match(prompt, /### Phase 3: Review/);
    assert.match(prompt, /### Phase 4: Final plan/);
    assert.match(prompt, /### Phase 5: Handoff/);
    assert.match(prompt, /resolve facts.*before asking the user/i);
    assert.match(prompt, /Do not emit a final Plan: section while any material decision remains unresolved/);
  });

  it("defines Claude-style batched question and result handling", () => {
    const prompt = buildPlanModePrompt(["read", "plan_question"]);

    assert.match(prompt, /Batch 1–4 related questions/);
    assert.match(prompt, /2–4 options per question/);
    assert.match(prompt, /recommended option first.*\(Recommended\)/i);
    assert.match(prompt, /multiSelect.*only when multiple choices can validly coexist/);
    assert.match(prompt, /one plan_question call at a time/);
    assert.match(prompt, /PLAN_QUESTION_STATUS: answered.*authoritative/);
    assert.match(prompt, /PLAN_QUESTION_STATUS: cancelled.*do not re-ask/i);
    assert.match(prompt, /PLAN_QUESTION_STATUS: unavailable.*plain text/i);
    assert.match(prompt, /PLAN_QUESTION_STATUS: aborted.*no assumptions/i);
  });

  it("uses Pi's final response and UI handoff contract", () => {
    const prompt = buildPlanModePrompt(["read"]);

    assert.match(prompt, /Begin with a Context section/);
    assert.match(prompt, /The Plan: section must be the final section/);
    assert.match(prompt, /Do not ask whether to proceed/);
    assert.match(prompt, /Pi will present Execute, Stay, and Refine actions/);
    assert.doesNotMatch(prompt, /AskUserQuestion|ExitPlanMode|plan_exit/);
  });
});
