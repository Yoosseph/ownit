import { afterEach, describe, expect, it, vi } from 'vitest';
import { gradeAnswer, parseJsonReply, validateGrade, validateQuestions, writeFollowUp, writeQuestions } from '../src/debrief';
import { createModel, firstResponse, openAiCompatibleModel, ProviderError, stripThinking, type ChatModel } from '../src/model';
import { countChangedLines, questionCount } from '../src/questionCount';
import { SAMPLE_DIFF, testEnv } from './helpers/env';

const push = { commits: [{ sha: 'a'.repeat(40), message: 'Round totals' }], diff: SAMPLE_DIFF, truncated: false };
const q = (kind: string) => ({ kind, question: `A question about the ${kind} of it?`, reference: 'A good answer mentions rounding.' });

function scripted(...replies: string[]): ChatModel & { calls: number } {
  const model = {
    calls: 0,
    async complete() {
      return replies[Math.min(model.calls++, replies.length - 1)]!;
    },
  };
  return model;
}

describe('questionCount', () => {
  it('scales with changed lines', () => {
    expect(questionCount(0)).toBe(1);
    expect(questionCount(49)).toBe(1);
    expect(questionCount(50)).toBe(2);
    expect(questionCount(300)).toBe(2);
    expect(questionCount(301)).toBe(3);
    expect(questionCount(1_000_000)).toBe(3);
  });

  it('counts added and removed lines, not file headers', () => {
    expect(countChangedLines(SAMPLE_DIFF)).toBe(3);
  });
});

describe('model JSON validation', () => {
  it('parses plain, fenced, and prose-wrapped JSON', () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure! {"a":1} Hope that helps')).toEqual({ a: 1 });
    expect(parseJsonReply('not json')).toBeUndefined();
  });

  it('requires n valid questions and assigns kinds in order', () => {
    const value = { questions: [q('how'), q('why'), q('next')] };
    expect(validateQuestions(value, 2)?.map((x) => x.kind)).toEqual(['why', 'how']);
    expect(validateQuestions({ questions: [q('why')] }, 2)).toBeUndefined();
    expect(validateQuestions({ questions: [{ kind: 'why', question: '', reference: 'x'.repeat(20) }] }, 1)).toBeUndefined();
    expect(validateQuestions({ questions: [{ ...q('why'), kind: 'what' }] }, 1)).toBeUndefined();
    expect(validateQuestions(undefined, 1)).toBeUndefined();
  });

  it('validates grades strictly', () => {
    expect(validateGrade({ pass: true, feedback: 'Nice.' })).toEqual({ pass: true, feedback: 'Nice.' });
    expect(validateGrade({ pass: 'true', feedback: 'Nice.' })).toBeUndefined();
    expect(validateGrade({ pass: true })).toBeUndefined();
  });
});

describe('model calls', () => {
  it('retries once on invalid JSON, then succeeds', async () => {
    const model = scripted('oops', JSON.stringify({ questions: [q('why')] }));
    const questions = await writeQuestions(model, 1, push);
    expect(questions).toHaveLength(1);
    expect(model.calls).toBe(2);
  });

  it('becomes a provider error after two invalid replies', async () => {
    const model = scripted('oops', '{"questions": []}');
    await expect(writeQuestions(model, 1, push)).rejects.toMatchObject({ kind: 'bad_output' });
    expect(model.calls).toBe(2);
  });

  it('fails an empty answer without calling the model', async () => {
    const model = scripted('{"pass":true,"feedback":"x"}');
    const grade = await gradeAnswer(model, q('why') as any, '   ');
    expect(grade.pass).toBe(false);
    expect(model.calls).toBe(0);
  });

  it('keeps the missed kind on a follow-up', async () => {
    const model = scripted(JSON.stringify({ questions: [q('why')] }));
    const followUp = await writeFollowUp(model, push, q('next') as any, 'Missing the edge cases.');
    expect(followUp.kind).toBe('next');
  });
});

describe('provider client', () => {
  const prompt = { task: 'questions' as const, system: 's', user: 'u' };

  it('sends the server-chosen model with JSON response format and strips thinking', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: '<think>hmm</think>\n{"pass":true,"feedback":"ok"}' } }] }),
    );
    const model = openAiCompatibleModel('Nebius', 'https://api.example/v1/', 'nvidia/x', 'key-123', fetcher as any);
    expect(await model.complete(prompt, 100)).toBe('{"pass":true,"feedback":"ok"}');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('nvidia/x');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.3);
  });

  it('grades at temperature 0', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"pass":true,"feedback":"ok"}' } }] }));
    const model = openAiCompatibleModel('Nebius', 'https://api.example/v1/', 'nvidia/x', 'key-123', fetcher as any);
    await gradeAnswer(model, q('why') as any, 'Totals were wrong.');
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).temperature).toBe(0);
  });

  it('adds provider-specific fields to the request', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    const model = openAiCompatibleModel('NVIDIA', 'https://api.example/v1', 'm', 'k', fetcher as any, { extraBody: { chat_template_kwargs: { enable_thinking: false } } });
    await model.complete(prompt, 10);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'm', response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } });
  });

  describe('hedged requests', () => {
    /** A request that never answers until it is cancelled. */
    const stall = (signal: AbortSignal) =>
      new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

    it('answers from a second copy when the first stalls, and cancels the first', async () => {
      const signals: AbortSignal[] = [];
      const send = vi.fn(async (signal: AbortSignal) => {
        signals.push(signal);
        return signals.length === 1 ? stall(signal) : new Response('second');
      });
      const response = await firstResponse(send, [20], 1_000);
      expect(await response.text()).toBe('second');
      expect(send).toHaveBeenCalledTimes(2);
      expect(signals[0]!.aborted).toBe(true);
    });

    it('sends one request when the first answers before the hedge', async () => {
      const send = vi.fn(async () => new Response('first'));
      expect(await (await firstResponse(send, [50], 1_000)).text()).toBe('first');
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('gives up at the deadline when nothing answers', async () => {
      await expect(firstResponse(stall, [10], 60)).rejects.toBeDefined();
    });

    it('sends another copy at once after a 5xx, without waiting for the hedge', async () => {
      const send = vi.fn(async () => (send.mock.calls.length === 1 ? new Response('busy', { status: 503 }) : new Response('ok')));
      const started = Date.now();
      expect(await (await firstResponse(send, [500], 1_000)).text()).toBe('ok');
      expect(Date.now() - started).toBeLessThan(400);
    });

    it('returns the last 5xx when every copy fails', async () => {
      const send = vi.fn(async () => new Response('busy', { status: 502 }));
      const response = await firstResponse(send, [10, 20], 1_000);
      expect(response.status).toBe(502);
      expect(send).toHaveBeenCalledTimes(3);
    });
  });

  it.each([
    [401, '', 'invalid_key'],
    [403, '', 'invalid_key'],
    [402, '', 'no_credit'],
    [400, '{"detail":"Insufficient balance"}', 'no_credit'],
    [429, 'slow down', 'rate_limited'],
    [503, '', 'unavailable'],
    [404, '{"title":"Not Found","detail":"Function \'x\': Not found for account \'y\'"}', 'model_unavailable'],
  ])('maps HTTP %i to %s', async (status, body, kind) => {
    const model = openAiCompatibleModel('Nebius', 'https://api.example/v1', 'm', 'k', (async () => new Response(body, { status })) as any);
    await expect(model.complete(prompt, 10)).rejects.toMatchObject({ kind });
  });

  it('maps network failures to unavailable', async () => {
    const model = openAiCompatibleModel('Nebius', 'https://api.example/v1', 'm', 'k', (async () => {
      throw new TypeError('fetch failed');
    }) as any);
    await expect(model.complete(prompt, 10)).rejects.toBeInstanceOf(ProviderError);
  });

  it('names the provider in error messages', async () => {
    const model = openAiCompatibleModel('NVIDIA', 'https://api.example/v1', 'm', 'k', (async () => new Response('', { status: 401 })) as any);
    await expect(model.complete(prompt, 10)).rejects.toMatchObject({ kind: 'invalid_key', message: expect.stringContaining('NVIDIA') });
  });

  it('strips multiple think blocks', () => {
    expect(stripThinking('<think>a</think>{"x":1}<think>b</think>')).toBe('{"x":1}');
  });
});

describe('provider choice', () => {
  const prompt = { task: 'questions' as const, system: 's', user: 'u' };
  const env = testEnv({ MODEL_BACKEND: 'nebius', NEBIUS_MODEL: 'nvidia/on-nebius', NVIDIA_MODEL: 'nvidia/on-nvidia' });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['nvidia', 'https://nvidia.invalid/v1/chat/completions', 'nvidia/on-nvidia'],
    ['nebius', 'https://nebius.invalid/v1/chat/completions', 'nvidia/on-nebius'],
  ] as const)('sends %s keys to that provider\'s endpoint and model', async (provider, url, model) => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetcher);
    await createModel(env, 'key-123', provider).complete(prompt, 10);
    const [calledUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(JSON.parse(init.body as string).model).toBe(model);
  });

  it.each(['nvidia', 'nebius'] as const)('turns thinking off on %s', async (provider) => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetcher);
    await createModel(env, 'key-123', provider).complete(prompt, 10);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});
