/**
 * Core types for plan-mode extension.
 */

export type PlanMode = "normal" | "plan" | "execute";

export interface PlanStep {
  step: number;
  text: string;
  completed: boolean;
}

export interface PlanState {
  mode: PlanMode;
  steps: PlanStep[];
}

export interface PlanQuestionOption {
  label: string;
  description: string;
}

export interface PlanQuestion {
  id: string;
  header: string;
  question: string;
  options: PlanQuestionOption[];
  multiSelect: boolean;
}

export interface PlanQuestionAnswer {
  id: string;
  selections: string[];
  custom?: string;
}

export type PlanQuestionnaireStatus =
  | "answered"
  | "cancelled"
  | "unavailable"
  | "aborted";

export interface PlanQuestionnaireResult {
  questions: PlanQuestion[];
  answers: PlanQuestionAnswer[];
  status: PlanQuestionnaireStatus;
}
