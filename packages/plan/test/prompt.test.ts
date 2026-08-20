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
    assert.match(prompt, /Do not emit a final Plan: section on a clarification turn/);
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
