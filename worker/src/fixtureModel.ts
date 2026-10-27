import type { ChatModel } from './model';
import { KINDS } from './questionCount';

// Offline stand-in for Nemotron, used by tests and local development
// (MODEL_BACKEND = "fixture"). It never sees a network, and it answers by the
// prompt's task, so editing prompts/*.txt cannot change what it does.

const QUESTIONS = {
  why: {
    question: 'What problem does this push solve, and why was it worth solving now?',
    reference: 'A good answer names the user-facing or developer-facing problem the change addresses and what it enables.',
  },
  how: {
    question: 'At a high level, how does the change work, and why did you pick that approach?',
    reference: 'A good answer describes the main design choice and one reason it fits better than an alternative.',
  },
  next: {
    question: 'What could break or what would you improve next in this area?',
    reference: 'Acceptable directions: an edge case that is not handled, a missing test, or a performance or UX improvement.',
  },
} as const;

const NON_ANSWER = /i don'?t know|no idea|idk|ignore (all )?previous|"pass"\s*:\s*true|^\s*\W*\s*$/i;

function between(text: string, name: string): string {
  const match = text.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`));
  return match?.[1] ?? '';
}

/** Passes answers of four or more words that are not obvious non-answers. */
function grade(answer: string): string {
  const words = answer.split(/\s+/).filter(Boolean).length;
  const pass = words >= 4 && !NON_ANSWER.test(answer);
  return JSON.stringify({
    pass,
    feedback: pass
      ? 'Nice, you covered the main idea.'
      : 'Good start, but the answer does not explain the main idea yet. Try describing what the change is for.',
  });
}

function followUp(missed: string): string {
  const kind = KINDS.find((k) => QUESTIONS[k].question === missed) ?? 'why';
  return JSON.stringify({
    questions: [
      {
        kind,
        question: `Looking at it another way: who benefits from this change, and what would they notice? (${kind})`,
        reference: QUESTIONS[kind].reference,
      },
    ],
  });
}

export const fixtureModel: ChatModel = {
  async complete(prompt) {
    switch (prompt.task) {
      case 'grade':
        return grade(between(prompt.user, 'answer').trim());
      case 'follow_up':
        return followUp(between(prompt.user, 'missed_question'));
      case 'questions':
        // All three kinds; the caller keeps as many as it asked for.
        return JSON.stringify({ summary: 'Changes how order totals are calculated.', questions: KINDS.map((kind) => ({ kind, ...QUESTIONS[kind] })) });
    }
  },
};
