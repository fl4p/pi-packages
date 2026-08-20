import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPlanToolCall } from "../src/tool-policy.js";

describe("checkPlanToolCall", () => {
  it("allows read-only built-in tools", () => {
    for (const tool of ["read", "grep", "find", "ls"]) {
      assert.deepEqual(checkPlanToolCall(tool, {}), { safe: true });
    }
  });

  it("applies command safety to shell runners", () => {
    for (const tool of ["bash", "bash_background", "monitor"]) {
      assert.equal(
        checkPlanToolCall(tool, { command: "tail -F /tmp/report.md" }).safe,
        true
      );
      assert.equal(
        checkPlanToolCall(tool, { command: "rm /tmp/report.md" }).safe,
        false
      );
    }
  });

  it("requires shell runners to receive a command", () => {
    const result = checkPlanToolCall("monitor", {});
    assert.equal(result.safe, false);
    assert.match(result.reason ?? "", /command string/);
  });

  it("allows background job inspection and cleanup", () => {
    assert.deepEqual(checkPlanToolCall("background_list", {}), { safe: true });
    assert.deepEqual(checkPlanToolCall("background_stop", { id: "bg-0" }), { safe: true });
  });

  it("blocks mutation and unknown extension tools", () => {
    for (const tool of ["edit", "write", "subagent", "unknown_tool"]) {
      const result = checkPlanToolCall(tool, {});
      assert.equal(result.safe, false);
      assert.match(result.reason ?? "", new RegExp(tool));
    }
  });
});
