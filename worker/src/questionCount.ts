export const KINDS = ['why', 'how', 'next'] as const;
export type Kind = (typeof KINDS)[number];

/** Under 50 changed lines → 1 question, 50–300 → 2, over 300 → 3. */
export function questionCount(changedLines: number): 1 | 2 | 3 {
  if (!Number.isFinite(changedLines) || changedLines < 50) return 1;
  if (changedLines <= 300) return 2;
  return 3;
}

/** Counts added and removed lines in a unified diff, skipping file headers. */
export function countChangedLines(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+') || line.startsWith('-')) count++;
  }
  return count;
}
