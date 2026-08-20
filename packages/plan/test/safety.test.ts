import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeCommand, checkCommand } from "../src/safety.js";

describe("isSafeCommand", () => {
  describe("safe read-only commands", () => {
    const safe = [
      "cat file.txt",
      "head -n 10 file.txt",
      "tail -f log.txt",
      "less file.txt",
      "more file.txt",
      "grep -r pattern .",
      "rg pattern",
      "fd name",
      "find . -name '*.ts'",
      "ls -la",
      "pwd",
      "tree -L 2",
      "echo hello",
      "printf '%s' hello",
      "wc -l file.txt",
      "sort file.txt",
      "diff a.txt b.txt",
      "jq '.key' file.json",
      "cut -d: -f1 file.txt",
      "tr a b",
      "column -t file.txt",
      "file file.txt",
      "stat file.txt",
      "du -sh .",
      "df -h",
      "which node",
      "whereis python",
      "type ls",
      "printenv PATH",
      "uname -a",
      "whoami",
      "id",
      "date",
      "uptime",
      "ps aux",
      "git status",
      "git log --oneline",
      "git diff",
      "git show HEAD",
      "git branch",
      "git ls-files",
      "npm list",
      "npm outdated",
      "npm view react",
      "bat file.txt",
    ];

    for (const cmd of safe) {
      it(`allows: ${cmd}`, () => {
        assert.equal(isSafeCommand(cmd), true, `Expected safe: ${cmd}`);
      });
    }
  });

  describe("destructive commands blocked", () => {
    const blocked = [
      "rm -rf /",
      "rm file.txt",
      "rmdir dir",
      "mv a b",
      "cp a b",
      "mkdir dir",
      "touch file.txt",
      "chmod 777 file.txt",
      "chown root file.txt",
      "ln -s a b",
      "tee file.txt",
      "truncate -s 0 file.txt",
      "dd if=/dev/zero of=file",
      "echo hello > file.txt",
      "echo hello >> file.txt",
      "npm install express",
      "npm uninstall express",
      "yarn add react",
      "pip install requests",
      "apt-get install vim",
      "brew install git",
      "git add .",
      "git commit -m msg",
      "git push",
      "git pull",
      "git merge branch",
      "git rebase main",
      "git reset --hard",
      "git checkout branch",
      "git stash",
      "sudo ls",
      "kill 1234",
      "pkill node",
      "vim file.txt",
      "nano file.txt",
      "code .",
      "echo 'rm /tmp/file' | sh",
      "printf 'touch /tmp/file' | bash",
      "echo $(touch /tmp/file)",
      "cat <(touch /tmp/file)",
      "find . $PREDICATE",
      "find . {-delete,-print}",
      "find . -name *.ts",
      "find . -delete",
      "find . -exec rm {} +",
      "fd file -x rm",
      "sort file.txt -o output.txt",
      "git remote add evil https://example.com/repo.git",
      "git branch new-branch",
      "npm audit fix",
      "curl -X DELETE https://example.com/resource",
      "env sh -c 'rm /tmp/file'",
      "xargs rm",
      "awk 'BEGIN { system(\"rm /tmp/file\") }'",
    ];

    for (const cmd of blocked) {
      it(`blocks: ${cmd}`, () => {
        assert.equal(isSafeCommand(cmd), false, `Expected blocked: ${cmd}`);
      });
    }
  });
});

describe("checkCommand", () => {
  describe("shell construct blocking", () => {
    it("blocks semicolons", () => {
      const result = checkCommand("ls ; rm -rf /");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("shell constructs"));
    });

    it("blocks ampersand chaining", () => {
      const result = checkCommand("cat file && rm file");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("shell constructs"));
    });

    it("blocks backticks", () => {
      const result = checkCommand("cat `whoami`");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("shell constructs"));
    });

    it("blocks embedded newlines", () => {
      const result = checkCommand("ls\nrm -rf /");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("shell constructs"));
    });

    it("blocks command substitution", () => {
      const result = checkCommand("echo $(touch /tmp/file)");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("substitution"));
    });

    it("blocks process substitution", () => {
      const result = checkCommand("cat <(touch /tmp/file)");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("substitution"));
    });

    it("blocks variable, brace, and glob expansion", () => {
      for (const command of [
        "find . $PREDICATE",
        "find . {-delete,-print}",
        "find . -name *.ts",
      ]) {
        const result = checkCommand(command);
        assert.equal(result.safe, false);
        assert.ok(result.reason?.includes("expansion"));
      }
    });
  });

  describe("redirect blocking", () => {
    it("blocks stdout redirect", () => {
      const result = checkCommand("echo hello > file.txt");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("redirect"));
    });

    it("blocks append redirect", () => {
      const result = checkCommand("echo hello >> file.txt");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("redirect"));
    });
  });

  describe("pipe safety", () => {
    it("blocks pipe to rm", () => {
      const result = checkCommand("echo file | rm");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("pipe"));
    });

    it("blocks pipe to sudo", () => {
      const result = checkCommand("echo cmd | sudo bash");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("pipe"));
    });

    it("allows pipe to safe command", () => {
      const result = checkCommand("cat file | grep pattern");
      assert.equal(result.safe, true);
    });

    it("ignores pipe characters inside quotes", () => {
      const result = checkCommand("grep 'a|b' file.txt | head -n 1");
      assert.equal(result.safe, true);
    });

    it("blocks pipe to a shell interpreter", () => {
      const result = checkCommand("echo 'rm /tmp/file' | sh");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("pipeline"));
    });

    it("blocks conditional pipelines", () => {
      const result = checkCommand("cat file || rm file");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("pipeline"));
    });
  });

  describe("destructive commands", () => {
    it("gives destructive reason", () => {
      const result = checkCommand("rm -rf /");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("destructive"));
    });

    for (const command of [
      "find . -delete",
      "find . '-delete'",
      "find . -exec rm {} +",
      "find . '-exec' rm {} +",
      "fd file --exec rm",
      "sort file.txt --output=output.txt",
      "git diff --output=diff.txt",
      "npm audit --fix",
    ]) {
      it(`blocks write or execute option: ${command}`, () => {
        const result = checkCommand(command);
        assert.equal(result.safe, false);
        assert.ok(result.reason?.includes("write or execute option"));
      });
    }
  });

  describe("unknown commands", () => {
    it("blocks unknown commands", () => {
      const result = checkCommand("some-unknown-tool --do-stuff");
      assert.equal(result.safe, false);
      assert.ok(result.reason?.includes("allowlist"));
    });
  });
});
