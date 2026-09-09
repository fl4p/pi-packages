/**
 * Dialog-based fallback for the plan questionnaire.
 *
 * The rich questionnaire is a TUI component driven through `ctx.ui.custom`,
 * which only interactive mode implements — RPC hosts (Paseo, and any other
 * embedder) return `undefined` from it, so the tool used to report
 * `unavailable` and the model fell back to asking in prose. `ui.select` and
 * `ui.input` are carried over the RPC protocol as `extension_ui_request`s, so
 * the same questions can be asked one dialog at a time wherever `custom` is
 * unavailable.
 */

import type {
  PlanQuestion,
  PlanQuestionAnswer,
  PlanQuestionnaireResult,
} from "./types.js";

export const FREEFORM_OPTION_LABEL = "✏️ Write my own answer";
export const DONE_OPTION_LABEL = "✓ Done with this question";

/** The subset of `ExtensionUIContext` the dialog fallback needs. */
export interface PlanQuestionDialogUI {
  select(
    title: string,
    options: string[],
    opts?: { signal?: AbortSignal }
  ): Promise<string | undefined>;
  input(
    title: string,
    placeholder?: string,
    opts?: { signal?: AbortSignal }
  ): Promise<string | undefined>;
}

export function supportsPlanQuestionDialogs(
  ui: unknown
): ui is PlanQuestionDialogUI {
  if (!ui || typeof ui !== "object") return false;
  const candidate = ui as Partial<PlanQuestionDialogUI>;
  return (
    typeof candidate.select === "function" &&
    typeof candidate.input === "function"
  );
}

/** `label — description`, so a host that can only render option strings still shows the tradeoff. */
export function renderOption(option: {
  label: string;
  description: string;
}): string {
  return `${option.label} — ${option.description}`;
}

function dialogTitle(question: PlanQuestion): string {
  return `${question.header}: ${question.question}`;
}

function result(
  questions: readonly PlanQuestion[],
  answers: PlanQuestionAnswer[],
  status: PlanQuestionnaireResult["status"]
): PlanQuestionnaireResult {
  return { questions: [...questions], answers, status };
}

/**
 * Ask every question through one-at-a-time dialogs.
 *
 * Dismissing any dialog cancels the whole batch: the plan-mode contract says a
 * cancelled questionnaire must not be re-asked or guessed at, so a partial set
 * of answers is worth less than an explicit `cancelled`.
 */
export async function runPlanQuestionDialogs(
  questions: readonly PlanQuestion[],
  ui: PlanQuestionDialogUI,
  signal?: AbortSignal
): Promise<PlanQuestionnaireResult> {
  const answers: PlanQuestionAnswer[] = [];

  for (const question of questions) {
    if (signal?.aborted) return result(questions, answers, "aborted");

    const answer = question.multiSelect
      ? await askMultiSelect(question, ui, signal)
      : await askSingleSelect(question, ui, signal);

    if (signal?.aborted) return result(questions, answers, "aborted");
    if (!answer) return result(questions, answers, "cancelled");
    answers.push(answer);
  }

  return result(questions, answers, "answered");
}

async function askFreeform(
  question: PlanQuestion,
  ui: PlanQuestionDialogUI,
  signal?: AbortSignal
): Promise<string | undefined> {
  const text = await ui.input(
    `${question.header}: your own answer`,
    "Type your answer",
    { ...(signal ? { signal } : {}) }
  );
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

async function askSingleSelect(
  question: PlanQuestion,
  ui: PlanQuestionDialogUI,
  signal?: AbortSignal
): Promise<PlanQuestionAnswer | undefined> {
  const byRendered = new Map(
    question.options.map((option) => [renderOption(option), option.label])
  );
  const choice = await ui.select(
    dialogTitle(question),
    [...byRendered.keys(), FREEFORM_OPTION_LABEL],
    { ...(signal ? { signal } : {}) }
  );

  if (choice === undefined) return undefined;
  if (choice === FREEFORM_OPTION_LABEL) {
    const custom = await askFreeform(question, ui, signal);
    return custom ? { id: question.id, selections: [], custom } : undefined;
  }

  const label = byRendered.get(choice);
  // An unrecognized string means the host answered with something we never
  // offered. Treat it as a dismissal rather than looping or guessing.
  if (!label) return undefined;
  return { id: question.id, selections: [label] };
}

async function askMultiSelect(
  question: PlanQuestion,
  ui: PlanQuestionDialogUI,
  signal?: AbortSignal
): Promise<PlanQuestionAnswer | undefined> {
  const selections: string[] = [];
  let custom: string | undefined;

  for (;;) {
    if (signal?.aborted) return undefined;

    const byRendered = new Map<string, string>();
    for (const option of question.options) {
      const marker = selections.includes(option.label) ? "☑ " : "☐ ";
      byRendered.set(`${marker}${renderOption(option)}`, option.label);
    }

    const hasAnswer = selections.length > 0 || Boolean(custom);
    const choices = [
      ...byRendered.keys(),
      FREEFORM_OPTION_LABEL,
      ...(hasAnswer ? [DONE_OPTION_LABEL] : []),
    ];

    const choice = await ui.select(dialogTitle(question), choices, {
      ...(signal ? { signal } : {}),
    });

    if (choice === undefined) return undefined;
    if (choice === DONE_OPTION_LABEL) {
      return {
        id: question.id,
        selections: [...selections],
        ...(custom ? { custom } : {}),
      };
    }
    if (choice === FREEFORM_OPTION_LABEL) {
      const written = await askFreeform(question, ui, signal);
      if (written) custom = written;
      continue;
    }

    const label = byRendered.get(choice);
    if (!label) return undefined;

    const index = selections.indexOf(label);
    if (index === -1) selections.push(label);
    else selections.splice(index, 1);
  }
}
