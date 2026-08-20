/**
 * Bash command safety checking for plan mode.
 * Determines whether a command is read-only (safe) or destructive (blocked).
 *
 * Four layers of protection:
 * 1. Shell construct blocking — prevents chaining and command substitution
 * 2. Redirect blocking — prevents file writes via >, >>
 * 3. Pipeline validation — checks every command independently
 * 4. Whitelist + blacklist — allows known-safe commands, blocks known-destructive ones
 */

// === Layer 1: Shell construct blocking ===

/** Block dangerous shell constructs (but allow pipes for safe command chaining) */
const UNSAFE_SHELL_CHARS = /[;&`\r\n]/;

function hasUnsafeExpansion(command: string): boolean {
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else if (quote === '"' && char === "$") return true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "$" || "*?[".includes(char)) return true;
    if (char === "{") {
      const end = command.indexOf("}", i + 1);
      const body = end === -1 ? "" : command.slice(i + 1, end);
      if (body.includes(",") || body.includes("..")) return true;
    }
    if ((char === "<" || char === ">") && command[i + 1] === "(") return true;
  }

  return false;
}

// === Layer 2: Redirect blocking ===

const REDIRECT_PATTERN = />{1,2}/;

// === Layer 3: Pipeline validation ===

function splitPipeline(command: string): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== "|") continue;
    if (command[i + 1] === "|") return undefined;

    const part = command.slice(start, i).trim();
    if (!part) return undefined;
    parts.push(part);
    start = i + 1;
  }

  if (quote || escaped) return undefined;
  const finalPart = command.slice(start).trim();
  if (!finalPart) return undefined;
  parts.push(finalPart);
  return parts;
}

// === Layer 4: Whitelist & blacklist ===

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // File system modification
  /\brm\b/,
  /\brmdir\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bchgrp\b/,
  /\bln\b/,
  /\btee\b/,
  /\btruncate\b/,
  /\bdd\b/,
  /\bshred\b/,
  // Package managers (install/uninstall/update)
  /\bnpm\s+(install|uninstall|update|ci|link|publish)\b/,
  /\byarn\s+(add|remove|install|publish)\b/,
  /\bpnpm\s+(add|remove|install|publish)\b/,
  /\bpip\s+(install|uninstall)\b/,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/,
  /\bbrew\s+(install|uninstall|upgrade)\b/,
  // Git write operations
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b/,
  // System
  /\bsudo\b/,
  /\bsu\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bsystemctl\s+(start|stop|restart|enable|disable)\b/,
  /\bservice\s+\S+\s+(start|stop|restart)\b/,
  // Editors
  /\b(vim?|nano|emacs|code|subl)\b/,
];

function tokenizeCommand(command: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }

  if (quote || escaped) return undefined;
  if (token) tokens.push(token);
  return tokens;
}

function hasUnsafeCommandOptions(command: string): boolean {
  const tokens = tokenizeCommand(command);
  if (!tokens || tokens.length === 0) return true;

  const [executable, ...args] = tokens;
  if (executable === "find") {
    return args.some((arg) =>
      /^-(?:delete|exec(?:dir)?|ok(?:dir)?|fprint(?:0)?|fprintf|fls)$/.test(arg)
    );
  }
  if (executable === "fd") {
    return args.some(
      (arg) =>
        arg === "-x" ||
        arg === "-X" ||
        arg === "--exec" ||
        arg === "--exec-batch" ||
        arg.startsWith("--exec=") ||
        arg.startsWith("--exec-batch=")
    );
  }
  if (executable === "sort" || executable === "tree") {
    return args.some(
      (arg) =>
        arg === "-o" ||
        arg.startsWith("-o") ||
        arg === "--output" ||
        arg.startsWith("--output=")
    );
  }
  if (executable === "diff") {
    return args.some((arg) => arg === "--output" || arg.startsWith("--output="));
  }
  if (executable === "git" && ["log", "diff", "show"].includes(args[0])) {
    return args.slice(1).some(
      (arg) =>
        arg === "--output" ||
        arg.startsWith("--output=") ||
        arg === "--ext-diff" ||
        arg === "--textconv"
    );
  }
  if (executable === "npm" && args[0] === "audit") {
    return args.slice(1).some((arg) => arg === "fix" || arg === "--fix");
  }
  if (executable === "yarn" && args[0] === "audit") {
    return args.slice(1).some((arg) => arg === "--fix");
  }
  return false;
}

const SAFE_PATTERNS: RegExp[] = [
  // File inspection
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  // Search & find
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*find\b/,
  // Directory listing
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*tree\b/,
  /^\s*eza\b/,
  // Text processing (read-only)
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*diff\b/,
  /^\s*jq\b/,
  /^\s*cut\b/,
  /^\s*tr\b/,
  /^\s*column\b/,
  // File metadata
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  // System info
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  // Process (read-only)
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  // Git read-only
  /^\s*git\s+(?:status|log|diff|show)\b/,
  /^\s*git\s+branch(?:\s+(?:-a|-r|-v|-vv|--list|--show-current))*\s*$/,
  /^\s*git\s+remote(?:\s+-v)?\s*$/,
  /^\s*git\s+config\s+--get\b/,
  /^\s*git\s+ls-/,
  // Package info (read-only)
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/,
  /^\s*yarn\s+(list|info|why|audit)\b/,
  /^\s*node\s+--version\b/,
  /^\s*python\s+--version\b/,
  // Code display
  /^\s*bat\b/,
];

/**
 * Normalize command: strip line continuations and collapse newlines.
 */
function normalizeCommand(command: string): string {
  return command.trim().replace(/\\\n\s*/g, "").replace(/\n\s*/g, " ");
}

/**
 * Check whether a bash command is safe (read-only) for plan mode.
 *
 * Returns an object with `safe` boolean and optional `reason` string.
 */
function checkSingleCommand(command: string): {
  safe: boolean;
  reason?: string;
} {
  if (hasUnsafeCommandOptions(command)) {
    return {
      safe: false,
      reason: `Plan mode: write or execute option is not allowed.\nBlocked: ${command}`,
    };
  }

  if (SAFE_PATTERNS.some((pattern) => pattern.test(command))) {
    return { safe: true };
  }

  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
    return {
      safe: false,
      reason: `Plan mode: command blocked (destructive). Use /plan to disable.\nBlocked: ${command}`,
    };
  }

  return {
    safe: false,
    reason: `Plan mode: command not in allowlist. Use /plan to disable.\nBlocked: ${command}`,
  };
}

export function checkCommand(command: string): {
  safe: boolean;
  reason?: string;
} {
  if (UNSAFE_SHELL_CHARS.test(command)) {
    return {
      safe: false,
      reason: "Plan mode: shell constructs (;, &, `, newlines) are not allowed.",
    };
  }

  if (hasUnsafeExpansion(command)) {
    return {
      safe: false,
      reason: "Plan mode: shell expansion and substitution are not allowed.",
    };
  }

  const cmd = normalizeCommand(command);
  if (REDIRECT_PATTERN.test(cmd)) {
    return {
      safe: false,
      reason: "Plan mode: file redirects (>, >>) are not allowed.",
    };
  }

  const pipeline = splitPipeline(cmd);
  if (!pipeline) {
    return {
      safe: false,
      reason: "Plan mode: malformed or conditional pipelines are not allowed.",
    };
  }

  for (const part of pipeline) {
    const result = checkSingleCommand(part);
    if (!result.safe) {
      return pipeline.length === 1
        ? result
        : {
            safe: false,
            reason: `Plan mode: unsafe pipeline segment "${part}". ${result.reason}`,
          };
    }
  }

  return { safe: true };
}

/**
 * Simple boolean check for backwards compatibility.
 */
export function isSafeCommand(command: string): boolean {
  return checkCommand(command).safe;
}
