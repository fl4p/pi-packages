import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  type Focusable,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
  formatPlanQuestionAnswers,
  normalizePlanQuestions,
  PlanQuestionnaireState,
} from "../../src/questions.js";
import type {
  PlanMode,
  PlanQuestion,
  PlanQuestionnaireResult,
  PlanQuestionnaireStatus,
} from "../../src/types.js";

const QuestionOptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, description: "Concise user-facing label" }),
    description: Type.String({
      minLength: 1,
      description: "One short sentence explaining the impact or tradeoff",
    }),
  },
  { additionalProperties: false }
);

const QuestionSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      pattern: "^[a-z][a-z0-9_]*$",
      description: "Stable snake_case identifier",
    }),
    header: Type.String({
      minLength: 1,
      maxLength: 12,
      description: "Short tab label, at most 12 characters",
    }),
    question: Type.String({ minLength: 1, description: "Complete question" }),
    options: Type.Array(QuestionOptionSchema, {
      minItems: 2,
      maxItems: 4,
      description: "Two to four choices",
    }),
    multiSelect: Type.Boolean({
      description: "Whether more than one listed option may be selected",
    }),
  },
  { additionalProperties: false }
);

export const PlanQuestionParameters = Type.Object(
  {
    questions: Type.Array(QuestionSchema, {
      minItems: 1,
      maxItems: 4,
      description: "One to four related planning questions",
    }),
  },
  { additionalProperties: false }
);

type QuestionTheme = ExtensionContext["ui"]["theme"];
type FinishQuestionnaire = (result: PlanQuestionnaireResult) => void;

function resultForStatus(
  questions: readonly PlanQuestion[],
  status: Exclude<PlanQuestionnaireStatus, "answered">
): PlanQuestionnaireResult {
  return { questions: [...questions], answers: [], status };
}

function statusText(status: Exclude<PlanQuestionnaireStatus, "answered">): string {
  if (status === "unavailable") {
    return [
      "PLAN_QUESTION_STATUS: unavailable",
      "Interactive questionnaire UI is unavailable. Ask the same questions in plain text and end this turn without a final Plan: section.",
    ].join("\n");
  }
  if (status === "cancelled") {
    return [
      "PLAN_QUESTION_STATUS: cancelled",
      "The user cancelled the questionnaire. Do not re-ask, infer answers, or emit a final Plan: section this turn.",
    ].join("\n");
  }
  return [
    "PLAN_QUESTION_STATUS: aborted",
    "The questionnaire was aborted. Make no assumptions and do not emit a final Plan: section this turn.",
  ].join("\n");
}

export class PlanQuestionnaireComponent implements Focusable {
  private readonly state: PlanQuestionnaireState;
  private readonly editor: Editor;
  private inputQuestionId: string | undefined;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;
  private finished = false;
  private _focused = false;
  private readonly abortListener: (() => void) | undefined;

  constructor(
    questions: readonly PlanQuestion[],
    private readonly tui: TUI,
    private readonly theme: QuestionTheme,
    private readonly done: FinishQuestionnaire,
    private readonly signal?: AbortSignal
  ) {
    this.state = new PlanQuestionnaireState(questions);
    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };
    this.editor = new Editor(tui, editorTheme);
    this.editor.onSubmit = (value) => this.submitCustom(value);

    if (signal) {
      this.abortListener = () => this.finish("aborted");
      signal.addEventListener("abort", this.abortListener, { once: true });
      if (signal.aborted) this.finish("aborted");
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.updateEditorFocus();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  private updateEditorFocus(): void {
    this.editor.focused = this._focused && this.inputQuestionId !== undefined;
  }

  private refresh(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.tui.requestRender();
  }

  private openCustom(): void {
    const question = this.state.currentQuestion;
    if (!question) return;
    this.inputQuestionId = question.id;
    this.editor.setText(this.state.getAnswer(question.id)?.custom ?? "");
    this.updateEditorFocus();
    this.refresh();
  }

  private closeCustom(): void {
    this.inputQuestionId = undefined;
    this.editor.setText("");
    this.updateEditorFocus();
  }

  private submitCustom(value: string): void {
    const id = this.inputQuestionId;
    if (!id) return;
    this.state.setCustom(id, value);
    const answered = this.state.isAnswered(id);
    this.closeCustom();
    if (answered) this.state.advance();
    this.refresh();
  }

  private finish(status: PlanQuestionnaireStatus): void {
    if (this.finished) return;
    this.finished = true;
    if (this.signal && this.abortListener) {
      this.signal.removeEventListener("abort", this.abortListener);
    }
    this.done({
      questions: [...this.state.questions],
      answers: this.state.orderedAnswers(),
      status,
    });
  }

  dispose(): void {
    this.finish("aborted");
  }

  handleInput(data: string): void {
    if (this.finished) return;

    if (this.inputQuestionId) {
      if (matchesKey(data, Key.escape)) {
        this.closeCustom();
        this.refresh();
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.state.moveTab(1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
      this.state.moveTab(-1);
      this.refresh();
      return;
    }

    if (this.state.onReview) {
      if (matchesKey(data, Key.enter) && this.state.allAnswered) {
        this.finish("answered");
      } else if (matchesKey(data, Key.escape)) {
        this.finish("cancelled");
      }
      return;
    }

    const question = this.state.currentQuestion;
    if (!question) return;

    if (matchesKey(data, Key.up)) {
      this.state.moveOption(-1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.state.moveOption(1);
      this.refresh();
      return;
    }

    const optionIndex = this.state.currentOptionIndex;
    const customRow = optionIndex === question.options.length;
    if (matchesKey(data, Key.space)) {
      if (customRow) {
        this.openCustom();
      } else if (question.multiSelect) {
        this.state.toggleMulti(question.options[optionIndex].label, optionIndex);
        this.refresh();
      } else {
        this.state.selectSingle(question.options[optionIndex].label, optionIndex);
        this.state.advance();
        this.refresh();
      }
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (customRow) {
        this.openCustom();
      } else if (question.multiSelect) {
        if (this.state.isAnswered(question.id)) {
          this.state.advance();
          this.refresh();
        }
      } else {
        this.state.selectSingle(question.options[optionIndex].label, optionIndex);
        this.state.advance();
        this.refresh();
      }
      return;
    }

    if (matchesKey(data, Key.escape)) this.finish("cancelled");
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, width);
    if (this.cachedLines && this.cachedWidth === renderWidth) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const addWrapped = (text: string, prefix = "") => {
      const prefixWidth = visibleWidth(prefix);
      if (prefixWidth >= renderWidth) {
        lines.push(...wrapTextWithAnsi(prefix + text, renderWidth));
        return;
      }
      const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
      if (wrapped.length === 0) {
        lines.push(prefix);
        return;
      }
      const continuation = " ".repeat(prefixWidth);
      wrapped.forEach((line, index) => {
        lines.push(`${index === 0 ? prefix : continuation}${line}`);
      });
    };
    const blank = () => lines.push("");

    addWrapped(this.theme.fg("accent", "─".repeat(renderWidth)));

    const tabs = this.state.questions.map((question, index) => {
      const answered = this.state.isAnswered(question.id);
      const active = this.state.currentTab === index;
      const text = ` ${answered ? "■" : "□"} ${question.header} `;
      return active
        ? this.theme.bg("selectedBg", this.theme.fg("text", text))
        : this.theme.fg(answered ? "success" : "muted", text);
    });
    const reviewText = " ✓ Review ";
    tabs.push(
      this.state.onReview
        ? this.theme.bg("selectedBg", this.theme.fg("text", reviewText))
        : this.theme.fg(this.state.allAnswered ? "success" : "dim", reviewText)
    );
    addWrapped(tabs.join(" "), " ");
    blank();

    const question = this.state.currentQuestion;
    if (question) {
      addWrapped(this.theme.fg("text", question.question), " ");
      blank();
      const answer = this.state.getAnswer(question.id);
      question.options.forEach((option, index) => {
        const highlighted = index === this.state.currentOptionIndex;
        const selected = answer?.selections.includes(option.label) ?? false;
        const marker = question.multiSelect
          ? `[${selected ? "x" : " "}]`
          : selected
            ? "(●)"
            : "(○)";
        addWrapped(
          this.theme.fg(highlighted ? "accent" : "text", `${marker} ${option.label}`),
          highlighted ? this.theme.fg("accent", "> ") : "  "
        );
        addWrapped(this.theme.fg("muted", option.description), "      ");
      });

      const customIndex = question.options.length;
      const customHighlighted = customIndex === this.state.currentOptionIndex;
      const customValue = answer?.custom;
      const customLabel = customValue
        ? `Type your own answer: ${customValue}`
        : "Type your own answer";
      addWrapped(
        this.theme.fg(customHighlighted ? "accent" : "text", customLabel),
        customHighlighted ? this.theme.fg("accent", "> ") : "  "
      );

      if (this.inputQuestionId) {
        blank();
        addWrapped(this.theme.fg("muted", "Your answer:"), " ");
        for (const line of this.editor.render(Math.max(1, renderWidth - 2))) {
          addWrapped(line, " ");
        }
        addWrapped(this.theme.fg("dim", "Enter save • Esc keep previous answer"), " ");
      }
    } else {
      addWrapped(this.theme.fg("accent", this.theme.bold("Review answers")), " ");
      blank();
      for (const item of this.state.questions) {
        const answer = this.state.getAnswer(item.id);
        const values = [
          ...(answer?.selections ?? []),
          ...(answer?.custom ? [`wrote: ${answer.custom}`] : []),
        ];
        addWrapped(
          this.theme.fg("muted", `${item.header}: `) +
            this.theme.fg(values.length ? "text" : "warning", values.join(", ") || "unanswered"),
          " "
        );
      }
      blank();
      addWrapped(
        this.theme.fg(
          this.state.allAnswered ? "success" : "warning",
          this.state.allAnswered
            ? "Press Enter to submit"
            : "Answer every question before submitting"
        ),
        " "
      );
    }

    blank();
    if (!this.inputQuestionId) {
      const help = question?.multiSelect
        ? "Tab/←→ navigate • ↑↓ select • Space toggle • Enter confirm • Esc cancel"
        : "Tab/←→ navigate • ↑↓ select • Enter choose • Esc cancel";
      addWrapped(this.theme.fg("dim", help), " ");
    }
    addWrapped(this.theme.fg("accent", "─".repeat(renderWidth)));

    this.cachedWidth = renderWidth;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.editor.invalidate();
  }
}

export function registerPlanQuestionTool(
  pi: ExtensionAPI,
  getPlanMode: () => PlanMode
): void {
  pi.registerTool({
    name: "plan_question",
    label: "Plan Questions",
    description:
      "Ask the user one batch of 1-4 related planning questions. Each question requires 2-4 labeled options and may allow multiple selections. Freeform answers are always available. Use only for material decisions that cannot be discovered from the repository; put the recommended option first and suffix its label with '(Recommended)'.",
    executionMode: "sequential",
    parameters: PlanQuestionParameters,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (getPlanMode() !== "plan") {
        throw new Error("plan_question is available only while Plan Mode is active.");
      }

      const questions = normalizePlanQuestions(params.questions as PlanQuestion[]);
      if (signal?.aborted) {
        const result = resultForStatus(questions, "aborted");
        return {
          content: [{ type: "text", text: statusText("aborted") }],
          details: result,
        };
      }
      if (!ctx.hasUI) {
        const result = resultForStatus(questions, "unavailable");
        return { content: [{ type: "text", text: statusText("unavailable") }], details: result };
      }

      onUpdate?.({
        content: [{ type: "text", text: "Waiting for planning answers..." }],
        details: undefined,
      });

      const result = await ctx.ui.custom<PlanQuestionnaireResult | undefined>(
        (tui, theme, _keybindings, done) =>
          new PlanQuestionnaireComponent(
            questions,
            tui,
            theme,
            (value) => done(value),
            signal
          )
      );

      if (!result) {
        const unavailable = resultForStatus(questions, "unavailable");
        return {
          content: [{ type: "text", text: statusText("unavailable") }],
          details: unavailable,
        };
      }
      if (result.status !== "answered") {
        return {
          content: [{ type: "text", text: statusText(result.status) }],
          details: result,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: formatPlanQuestionAnswers(questions, result.answers),
          },
        ],
        details: result,
      };
    },

    renderCall(args, theme) {
      const questions = (args.questions as PlanQuestion[]) ?? [];
      const headers = questions.map((question) => question.header).join(", ");
      return new Text(
        theme.fg("toolTitle", theme.bold("plan_question ")) +
          theme.fg("muted", `${questions.length} question${questions.length === 1 ? "" : "s"}`) +
          (headers ? theme.fg("dim", ` (${headers})`) : ""),
        0,
        0
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as PlanQuestionnaireResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.status !== "answered") {
        return new Text(theme.fg("warning", details.status), 0, 0);
      }
      const lines = details.answers.map((answer) => {
        const values = [
          ...answer.selections,
          ...(answer.custom ? [`wrote: ${answer.custom}`] : []),
        ];
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${values.join(", ")}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
