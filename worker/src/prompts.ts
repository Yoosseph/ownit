// The system prompts for the three Nemotron calls live in /prompts at the repo root, so they can
// be read and edited in one place; Wrangler uploads them as text modules. The grader never sees the
// code: an instruction hidden in a diff can only reach the question writers.
import followUpWriter from '../../prompts/follow-up-writer.txt';
import grader from '../../prompts/grader.txt';
import questionWriter from '../../prompts/question-writer.txt';

export const QUESTION_WRITER_SYSTEM = questionWriter.trim();
export const GRADER_SYSTEM = grader.trim();
export const FOLLOWUP_WRITER_SYSTEM = followUpWriter.trim();

const DATA_TAGS = ['commits', 'diff', 'answer', 'question', 'reference', 'missed_question', 'feedback'];
const TAG_PATTERN = new RegExp(`<(/?)(${DATA_TAGS.join('|')})(?=[\\s>/])`, 'gi');

/**
 * Escapes anything that looks like one of our data tags, so text inside a tag
 * can never close it early and pose as a prompt section of its own.
 */
export function neutralize(text: string): string {
  return text.replace(TAG_PATTERN, (_match, slash: string, name: string) => `&lt;${slash}${name}`);
}

export function tag(name: string, content: string): string {
  return `<${name}>\n${neutralize(content)}\n</${name}>`;
}

export interface CommitInfo {
  sha: string;
  message: string;
}

export interface PushContext {
  commits: CommitInfo[];
  diff: string;
  truncated: boolean;
}

export interface ChatPrompt {
  system: string;
  user: string;
  /** Defaults to 0.3. The grader uses 0 so the same answer gets the same grade. */
  temperature?: number;
}

function formatCommits(commits: CommitInfo[]): string {
  return commits.map((c) => `${c.sha.slice(0, 12)} ${c.message.trim()}`).join('\n\n');
}

function pushSections(push: PushContext): string {
  return `${tag('commits', formatCommits(push.commits))}\n${tag('diff', push.diff)}\nDiff truncated: ${push.truncated ? 'yes' : 'no'}`;
}

export function questionWriterPrompt(n: number, push: PushContext): ChatPrompt {
  return { system: QUESTION_WRITER_SYSTEM.replaceAll('{n}', String(n)), user: pushSections(push) };
}

export function graderPrompt(question: string, reference: string, answer: string): ChatPrompt {
  return {
    system: GRADER_SYSTEM,
    user: `${tag('question', question)}\n${tag('reference', reference)}\n${tag('answer', answer)}`,
    temperature: 0,
  };
}

export function followUpPrompt(
  push: PushContext,
  missed: { question: string; reference: string },
  feedback: string,
): ChatPrompt {
  return {
    system: FOLLOWUP_WRITER_SYSTEM,
    user: [
      pushSections(push),
      tag('missed_question', missed.question),
      tag('reference', missed.reference),
      tag('feedback', feedback),
    ].join('\n'),
  };
}
