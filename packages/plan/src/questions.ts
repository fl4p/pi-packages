import type {
  PlanQuestion,
  PlanQuestionAnswer,
  PlanQuestionOption,
} from "./types.js";

const QUESTION_ID = /^[a-z][a-z0-9_]*$/;

function requireTrimmed(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be blank.`);
  return trimmed;
}

export function normalizePlanQuestions(
  input: readonly PlanQuestion[]
): PlanQuestion[] {
  if (input.length < 1 || input.length > 4) {
    throw new Error("plan_question requires 1 to 4 questions.");
  }

  const ids = new Set<string>();
  return input.map((question, questionIndex) => {
    const prefix = `Question ${questionIndex + 1}`;
    const id = requireTrimmed(question.id, `${prefix} id`);
    if (!QUESTION_ID.test(id)) {
      throw new Error(`${prefix} id must be snake_case.`);
    }
    if (ids.has(id)) {
      throw new Error(`Question id "${id}" is duplicated.`);
    }
    ids.add(id);

    const header = requireTrimmed(question.header, `${prefix} header`);
    if (header.length > 12) {
      throw new Error(`${prefix} header must be at most 12 characters.`);
    }
    const prompt = requireTrimmed(question.question, `${prefix} prompt`);

    if (question.options.length < 2 || question.options.length > 4) {
      throw new Error(`${prefix} requires 2 to 4 options.`);
    }

    const labels = new Set<string>();
    const options: PlanQuestionOption[] = question.options.map(
      (option, optionIndex) => {
        const label = requireTrimmed(
          option.label,
          `${prefix} option ${optionIndex + 1} label`
        );
        if (labels.has(label)) {
          throw new Error(`${prefix} option label "${label}" is duplicated.`);
        }
        labels.add(label);
        return {
          label,
          description: requireTrimmed(
            option.description,
            `${prefix} option ${optionIndex + 1} description`
          ),
        };
      }
    );

    return {
      id,
      header,
      question: prompt,
      options,
      multiSelect: question.multiSelect,
    };
  });
}

function cloneAnswer(answer: PlanQuestionAnswer): PlanQuestionAnswer {
  return {
    id: answer.id,
    selections: [...answer.selections],
    ...(answer.custom ? { custom: answer.custom } : {}),
  };
}

export class PlanQuestionnaireState {
  readonly questions: readonly PlanQuestion[];
  private readonly answers = new Map<string, PlanQuestionAnswer>();
  private readonly optionIndexes = new Map<string, number>();
  private tab = 0;

  constructor(questions: readonly PlanQuestion[]) {
    this.questions = questions;
  }

  get currentTab(): number {
    return this.tab;
  }

  get onReview(): boolean {
    return this.tab === this.questions.length;
  }

  get currentQuestion(): PlanQuestion | undefined {
    return this.questions[this.tab];
  }

  get currentOptionIndex(): number {
    const question = this.currentQuestion;
    return question ? (this.optionIndexes.get(question.id) ?? 0) : 0;
  }

  setCurrentTab(tab: number): void {
    const tabCount = this.questions.length + 1;
    this.tab = ((tab % tabCount) + tabCount) % tabCount;
  }

  moveTab(delta: number): void {
    this.setCurrentTab(this.tab + delta);
  }

  moveOption(delta: number): void {
    const question = this.currentQuestion;
    if (!question) return;
    const maxIndex = question.options.length;
    const next = Math.max(
      0,
      Math.min(maxIndex, this.currentOptionIndex + delta)
    );
    this.optionIndexes.set(question.id, next);
  }

  setOptionIndex(index: number): void {
    const question = this.currentQuestion;
    if (!question) return;
    const maxIndex = question.options.length;
    this.optionIndexes.set(
      question.id,
      Math.max(0, Math.min(maxIndex, index))
    );
  }

  getAnswer(id: string): PlanQuestionAnswer | undefined {
    const answer = this.answers.get(id);
    return answer ? cloneAnswer(answer) : undefined;
  }

  selectSingle(label: string, optionIndex: number): void {
    const question = this.currentQuestion;
    if (!question || question.multiSelect) return;
    this.optionIndexes.set(question.id, optionIndex);
    this.answers.set(question.id, { id: question.id, selections: [label] });
  }

  toggleMulti(label: string, optionIndex: number): void {
    const question = this.currentQuestion;
    if (!question?.multiSelect) return;
    this.optionIndexes.set(question.id, optionIndex);
    const current = this.answers.get(question.id) ?? {
      id: question.id,
      selections: [],
    };
    const selections = [...current.selections];
    const index = selections.indexOf(label);
    if (index === -1) selections.push(label);
    else selections.splice(index, 1);

    if (selections.length === 0 && !current.custom) {
      this.answers.delete(question.id);
      return;
    }
    this.answers.set(question.id, { ...current, selections });
  }

  setCustom(id: string, value: string): void {
    const question = this.questions.find((item) => item.id === id);
    if (!question) throw new Error(`Unknown plan question id "${id}".`);

    const custom = value.trim();
    const current = this.answers.get(id) ?? { id, selections: [] };
    const selections =
      question.multiSelect || !custom ? [...current.selections] : [];
    if (!custom && selections.length === 0) {
      this.answers.delete(id);
      return;
    }

    this.answers.set(id, {
      id,
      selections,
      ...(custom ? { custom } : {}),
    });
  }

  isAnswered(id: string): boolean {
    const answer = this.answers.get(id);
    return Boolean(
      answer && (answer.selections.length > 0 || Boolean(answer.custom))
    );
  }

  get allAnswered(): boolean {
    return this.questions.every((question) => this.isAnswered(question.id));
  }

  advance(): void {
    if (this.tab < this.questions.length) this.tab += 1;
  }

  orderedAnswers(): PlanQuestionAnswer[] {
    return this.questions.flatMap((question) => {
      const answer = this.answers.get(question.id);
      return answer ? [cloneAnswer(answer)] : [];
    });
  }
}

export function formatPlanQuestionAnswers(
  questions: readonly PlanQuestion[],
  answers: readonly PlanQuestionAnswer[]
): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const lines = questions.map((question) => {
    const answer = byId.get(question.id);
    const parts: string[] = [];
    if (answer?.selections.length) {
      parts.push(`selected ${answer.selections.map((item) => JSON.stringify(item)).join(", ")}`);
    }
    if (answer?.custom) parts.push(`wrote ${JSON.stringify(answer.custom)}`);
    return `- ${question.id} (${question.header}): ${parts.join("; ") || "unanswered"}`;
  });
  return ["PLAN_QUESTION_STATUS: answered", ...lines].join("\n");
}
