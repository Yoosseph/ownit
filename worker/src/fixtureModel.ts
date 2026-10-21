import type { ChatModel } from './model';

// Offline stand-in for Nemotron, used by tests and local development
// (MODEL_BACKEND = "fixture"). It never sees a network.

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

export const fixtureModel: ChatModel = {
  async complete(prompt) {
    if (prompt.system.startsWith('You grade one answer')) {
      const answer = between(prompt.user, 'answer').trim();
      const words = answer.split(/\s+/).filter(Boolean).length;
      const pass = words >= 4 && !NON_ANSWER.test(answer);
      return JSON.stringify({
        pass,
        feedback: pass
          ? 'Nice, you covered the main idea.'
          : 'Good start, but the answer does not explain the main idea yet. Try describing what the change is for.',
      });
    }
    if (prompt.system.includes('The developer missed a question')) {
      const missed = between(prompt.user, 'missed_question');
      const kind = (Object.keys(QUESTIONS) as (keyof typeof QUESTIONS)[]).find((k) => QUESTIONS[k].question === missed) ?? 'why';
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
    const n = Number(prompt.system.match(/Write exactly (\d+) questions/)?.[1] ?? 1);
    const kinds = (['why', 'how', 'next'] as const).slice(0, n);
    return JSON.stringify({ questions: kinds.map((kind) => ({ kind, ...QUESTIONS[kind] })) });
  },
};
