import { z } from 'zod';
import { KINDS, type Kind } from './questionCount';
import { ProviderError, type ChatModel } from './model';
import { followUpPrompt, graderPrompt, questionWriterPrompt, type ChatPrompt, type PushContext } from './prompts';

export const MAX_ANSWER_CHARS = 2000;

const questionSchema = z.object({
  kind: z.enum(KINDS),
  question: z.string().trim().min(10).max(600),
  reference: z.string().trim().min(10).max(2000),
});
const questionsReplySchema = z.object({ questions: z.array(questionSchema).min(1) });
const summarySchema = z.object({ summary: z.string().trim().min(1).max(300) });
const gradeReplySchema = z.object({ pass: z.boolean(), feedback: z.string().trim().min(1).max(800) });

export type Question = z.infer<typeof questionSchema>;
export type Grade = z.infer<typeof gradeReplySchema>;

/** Parses a model reply as JSON, tolerating a code fence or prose around the object. */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

/**
 * Calls the model and validates its JSON reply. An invalid reply is retried
 * once; a second invalid reply becomes a provider error.
 */
async function callJson<T>(
  model: ChatModel,
  prompt: ChatPrompt,
  maxTokens: number,
  validate: (value: unknown) => T | undefined,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const value = validate(parseJsonReply(await model.complete(prompt, maxTokens)));
    if (value !== undefined) return value;
  }
  throw new ProviderError('bad_output');
}

/** Valid when there are at least n questions; kinds are assigned in the fixed order. */
export function validateQuestions(value: unknown, n: number): Question[] | undefined {
  const parsed = questionsReplySchema.safeParse(value);
  if (!parsed.success || parsed.data.questions.length < n) return undefined;
  return parsed.data.questions.slice(0, n).map((q, i) => ({ ...q, kind: KINDS[i] as Kind }));
}

export function validateGrade(value: unknown): Grade | undefined {
  const parsed = gradeReplySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The model's one-sentence summary of the push, or undefined when it wrote none worth showing. */
function summaryOf(value: unknown): string | undefined {
  const parsed = summarySchema.safeParse(value);
  return parsed.success ? parsed.data.summary : undefined;
}

/** The questions for a push, plus a one-sentence summary of it when the model wrote one. */
export function writeDebrief(model: ChatModel, n: number, push: PushContext): Promise<{ questions: Question[]; summary?: string }> {
  return callJson(model, questionWriterPrompt(n, push), 4000, (v) => {
    const questions = validateQuestions(v, n);
    return questions && { questions, summary: summaryOf(v) };
  });
}

export async function writeQuestions(model: ChatModel, n: number, push: PushContext): Promise<Question[]> {
  return (await writeDebrief(model, n, push)).questions;
}

export async function gradeAnswer(model: ChatModel, question: Question, answer: string): Promise<Grade> {
  const text = answer.trim().slice(0, MAX_ANSWER_CHARS);
  if (!text) {
    return { pass: false, feedback: 'Give it a try: even a rough sentence about the main idea is enough to pass.' };
  }
  return callJson(model, graderPrompt(question.question, question.reference, text), 1500, validateGrade);
}

export async function writeFollowUp(model: ChatModel, push: PushContext, missed: Question, feedback: string): Promise<Question> {
  const [question] = await callJson(model, followUpPrompt(push, missed, feedback), 2000, (v) => validateQuestions(v, 1));
  return { ...question!, kind: missed.kind };
}

export type Verdict = Grade & { followUp?: Question };

/** Grades an answer and, on a miss, writes a follow-up question for another try. */
export async function judgeAnswer(model: ChatModel, push: PushContext, question: Question, answer: string): Promise<Verdict> {
  const grade = await gradeAnswer(model, question, answer);
  if (grade.pass) return grade;
  return { ...grade, followUp: await writeFollowUp(model, push, question, grade.feedback) };
}
