// Metadata only: repo, status, timings. Never request bodies, diffs, answers, or keys.
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function log(event: string, fields: LogFields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}
