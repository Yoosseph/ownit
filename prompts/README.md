# Prompts

Every prompt Ownit sends to Nemotron. The worker loads these files directly
(`worker/src/prompts.ts`), so this folder is the only place to change them.

| File | Used when | Sees the code? |
| --- | --- | --- |
| `question-writer.txt` | A debrief starts: writes the questions and a hidden reference for each. | Yes |
| `grader.txt` | You answer: decides pass or fail and writes the feedback. | No |
| `follow-up-writer.txt` | You miss a question: writes one easier question on the same topic. | Yes |

These are the system prompts. The worker builds the user message from data, with each part wrapped
in a tag so the model can tell data from instructions:

- question writer: `<commits>`, `<diff>`, plus `Diff truncated: yes|no`
- grader: `<question>`, `<reference>`, `<answer>`
- follow-up writer: `<commits>`, `<diff>`, `<missed_question>`, `<reference>`, `<feedback>`

`{n}` in `question-writer.txt` becomes the number of questions (1–3, from the size of the push).
The grader runs at temperature 0, the writers at 0.3.

## Changing a prompt

1. Edit the file. Keep the data-tag names and the JSON reply format: the worker validates replies
   against them and retries once.
2. Run `npm test` at the repo root, then `scripts/live-injection-check` to try the real model:
   injected answers must still fail, and rough honest answers must still pass.
3. Redeploy the worker (`cd worker && npx wrangler deploy`). The change is live for everyone at once,
   with no CLI update.
