# Ownit

**Own the code you ship.** Right after you push, Ownit asks one to three short questions about the
change, in the same terminal: why you made it, how it works, and what could come next. NVIDIA
Nemotron, served by Nebius, writes the questions and grades your answers generously. Each push is
recorded as verified, skipped, or pending, and a badge shows your repo's record.

An example session:

```text
$ git push
Ownit (2 commits to octo/shop) Debrief now? [Y/n/s=skip] y

Ownit debrief · octo/shop · 2 commits · 143 changed lines
Answer in your own words, up to 5 sentences. Rough is fine. Type "s" to skip.

Question 1/2 (why)
  Why does checkout now retry some failed card payments instead of failing the order right away?
> so temporary card errors dont lose the sale
✓ Passed.
  Right: temporary failures no longer cost the order.

Question 2/2 (how)
  How does the retry decide when to give up?
> it just tries again
Not quite yet.
  You've got the retry part. What's missing is which errors get retried and when it stops.
Here's another angle on the same topic:

Question 2/2 (how, follow-up)
  What happens when the card is declined for good, as opposed to a network blip?
> permanent declines throw right away, only temporary codes retry, max 3 times with backoff
✓ Passed.

✓ Push verified. 2 commits owned. Nice work.
```

## Why

Coding agents let anyone ship code faster than they can read it. Ownit is a learning tool that
makes understanding the code you ship a habit: a two-minute debrief while the change is still
fresh, asked by a friendly senior engineer who is happy with a rough answer.

Grading is lenient on purpose. Typing a rough answer and passing is better than giving up. A
failed answer gets encouraging feedback and a fresh follow-up question from another angle, and
retries are unlimited. Skipping takes one key. Gaming the score only hurts the person doing it,
the first time an interviewer asks about the repo.

## Quick start

```sh
npm i -g getownit       # installs the `ownit` command (Node 20+)
ownit login             # sign in with GitHub (device flow)
ownit key set           # your Nebius API key; see "Bring your own key"
cd your-repo
ownit init              # installs the pre-push hook and registers the repo
```

Then install the Ownit GitHub App on the repo (`ownit init` prints the link). The App posts an
**Ownit** check run on every push and lets pushes count toward the badge.

Push as usual. At the prompt:

| Key | What happens |
| --- | --- |
| **Y** (or Enter) | The debrief runs inline, then the push continues. |
| **n** | The push is recorded as **pending**. Run `ownit interview` whenever you're ready. |
| **s** | The push is recorded as **skipped**. |

The push always goes through. Ownit never blocks a push. If you had a `pre-push` hook, it moves
to `pre-push.local`, still runs first, and its failure still blocks the push as before.

### Commands

```text
ownit login [--server URL]       Sign in with GitHub
ownit key set|clear|status       Manage your Nebius key (stored only on your machine)
ownit init [--repo owner/name]   Install the hook in this repo
ownit interview                  Debrief pushes that are still pending
ownit interview --range A..B     Debrief any commit range
ownit whoami                     Show server, login, and key status
ownit uninstall                  Remove the hook (restores your previous one)
ownit logout
```

## How a push is recorded

| Status | Meaning | Counts on the badge |
| --- | --- | --- |
| **verified** | Every question passed. All commits in the push are verified. | Yes |
| **skipped** | You pressed `s`, or a pending push went 24 hours without a debrief. | Yes |
| **pending** | No debrief yet. This covers no terminal (GUI clients, coding agents, CI), `--no-verify`, edits on github.com, the hook not installed, or `n` at the prompt. Run `ownit interview`. | Not until it resolves |
| **provider_error** | Nebius rejected the key, ran out of credit, or was down. | No, until you retry with `ownit interview` |

How a push becomes a debrief:

1. The pre-push hook works out which commits are being pushed. Because git uses the hook's stdin
   for the ref list, it reads your answers from `/dev/tty`.
2. The CLI builds the diff locally and filters it (see [What the model sees](#what-the-model-sees)).
   It sends the diff, the commit messages, and your Nebius key to the Ownit worker.
3. The worker makes the model calls and records the push and its questions.
4. When GitHub's push webhook arrives, the worker matches the landed commits to the debrief by
   SHA and sets the check run: **Ownit: verified**, **skipped**, or **pending**. Commits that
   landed without a debrief become a pending push.
5. An hourly cron turns pending pushes older than 24 hours into skips.

The number of questions grows with the size of the push, counted as changed lines in non-ignored
files: under 50 → 1 question, 50–300 → 2, over 300 → 3. They come in this order:

1. **why**: the purpose of the change
2. **how**: the approach at a high level
3. **next**: what could break, a limitation, or an improvement

Questions name the feature or area, never a file path or function name.

## Bring your own key

Ownit runs on **your own Nebius account**. Create a key in
[Nebius Token Factory](https://tokenfactory.nebius.com/), then run `ownit key set`. The key is
saved in `~/.ownit/config.json` (mode 600) and sent only with debrief requests. The worker uses it
for that request and then drops it. It never stores or logs the key. A debrief usually costs
under a cent, and a few cents at most for a large push with several follow-ups.

The server chooses the endpoint and model: `nvidia/nemotron-3-super-120b-a12b` at
`https://api.tokenfactory.nebius.com/v1/`. The client cannot change them.

Hackathon judges can try Ownit without a key. A server may set an optional shared
`DEMO_NEBIUS_KEY`, which has a daily cap and is used only when a request carries no key.

## Privacy

- **Code is never stored.** The diff exists only for the duration of a request. It goes to the
  model on **your** Nebius account and is then discarded.
- **Your answers are never stored.** Each answer goes to the grader and is then discarded.
- **Keys are never stored or logged.** Logs hold metadata only: repo, status, timings.
- **What is stored:** repos (owner, name, App installation, tracked-since date), GitHub user IDs and
  logins, pushes (SHAs, status, timestamps), commit SHAs and authors, and each question's text with
  pass/fail and attempt count.
- **Answer keys stay sealed.** Each question has a reference describing a good answer. It travels
  between requests inside an encrypted token that only the server can open. It is never stored,
  and your CLI cannot read it.
- **GitHub tokens are not kept.** Login uses GitHub's device flow. The worker reads your identity,
  discards the GitHub token, and issues its own session token, storing only a hash of it. Push
  access is checked with the GitHub App's installation token.
- **Public page:** `/<owner>/<repo>` shows stats and question text. It never shows code or answers.
  For private repos it hides the question text too.

## What the model sees

The CLI drops lockfiles, `node_modules`, `dist`/`build` and similar output folders, minified files,
binaries, and generated files (files marked `@generated` or `DO NOT EDIT`, protobuf output, and so
on). It also drops anything listed in a `.ownitignore` at the repo root, which uses `.gitignore`
syntax:

```gitignore
# .ownitignore
fixtures/
*.snap
docs/api/
```

The diff is capped at about 60,000 characters. Every file header is kept, the remaining space is
shared fairly between files, and the model is told when the diff was truncated.

### Prompt-injection design

Three separate calls, and **the grader never sees the code**:

1. **Question writer** reads the commits and diff and writes the questions, each with a reference
   answer.
2. **Grader** reads one question, its reference, and your answer.
3. **Follow-up writer** reads the diff, the missed question, its reference, and the grader's
   feedback. It never sees your raw answer.

An instruction hidden in a code comment can only reach the question writers, and the worst it can
do there is make the questions easier. All data sits inside tags that it cannot close (`</diff>` in
your code is escaped). Every reply is strict JSON, validated against a schema; an invalid reply
is retried once, and a second failure records a provider error.
`scripts/live-injection-check` runs these attacks against the real model.

## The badge

```markdown
[![Ownit](https://<server>/badge/<owner>/<repo>.svg)](https://<server>/<owner>/<repo>)
```

It reads, for example, `ownit | 90% verified`, colored by percentage. The percentages are
commit-weighted: verified commits over commits whose push is verified or skipped. Only commits
GitHub confirmed after the repo's "tracked since" date count. History before Ownit doesn't count.
Copy the snippet from your repo's page.

### Is a badge real?

Ownit is open source, so anyone can run their own copy, and a copy can show any number it likes.
To check a badge:

- **Click it.** It opens the repo's page on the server that made it. The official server is
  `https://ownit.ownit-worker.workers.dev`; any other address is a copy.
- **Look at the check run** on a commit in GitHub. Official ones come from the **ownit-app** GitHub
  App. GitHub App names are unique, so a copy has to use a different one.
- **Look the repo up yourself** at `https://ownit.ownit-worker.workers.dev/<owner>/<repo>`. If it
  isn't there, the official server never tracked it.

## Hook managers and custom hooks paths

- **Plain repos:** `ownit init` writes `.git/hooks/pre-push`.
- **`core.hooksPath`:** the hook goes into that directory, with the same chaining.
- **husky:** husky owns the hooks directory, so `ownit init` prints three lines to append to
  `.husky/pre-push`.

To push once without the prompt, use `OWNIT_SKIP=1 git push`. The push then shows up as pending.

## Self-hosting

The server is one Cloudflare Worker with a D1 database and an hourly Cron Trigger.

```sh
git clone https://github.com/<you>/ownit && cd ownit && npm install
cd worker
npx wrangler d1 create ownit              # paste the database_id into wrangler.toml
npx wrangler d1 migrations apply ownit --remote
npx wrangler secret put SESSION_SECRET     # e.g. openssl rand -hex 32
npx wrangler deploy
```

Then create your own GitHub App ([docs/github-app.md](docs/github-app.md)), put its ID, slug, and
client ID in `wrangler.toml`, set the `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`
secrets, and deploy again. Optionally set `DEMO_NEBIUS_KEY` and `DEMO_DAILY_CALL_CAP`.
Point the CLI at your server with `ownit login --server https://ownit.<you>.workers.dev`.

For local development, see [docs/HANDOFF.md](docs/HANDOFF.md#running-locally). `MODEL_BACKEND =
"fixture"` gives an offline fake model.

## Limitations

- **A learning tool, not proof of authorship.** A pass means someone at the keyboard could explain
  the change roughly. It doesn't prove who wrote the code, and nobody should treat a badge as a
  hiring signal on its own.
- Grading is deliberately generous, and determined cheating is possible. That's by design: Ownit
  invests in encouragement, not anti-cheat.
- The interactive prompt needs a terminal. GUI clients, coding agents, and CI produce pending
  pushes that you finish with `ownit interview`. On Windows, use Git Bash in Windows Terminal. If
  the prompt ever gets no input, it gives up after 2 minutes and the push is pending.
- Only GitHub is supported. Pushes count once the GitHub App is installed.
- Model output varies. Questions are usually specific, but occasionally generic.

## Development

```sh
npm install
npm test                          # worker + CLI, offline (fixture model, node:sqlite D1 shim)
scripts/live-injection-check      # live injection checks against Nemotron (needs a Nebius key)
```

The layout: `cli/` is the `getownit` npm package, `worker/` is the Cloudflare Worker, and `docs/`
holds the guides. [docs/SPEC.md](docs/SPEC.md) is the full spec and
[docs/demo.md](docs/demo.md) is the demo script.

## Credits

- [NVIDIA Nemotron](https://www.nvidia.com/en-us/ai-data-science/foundation-models/nemotron/)
  writes and grades the debriefs, served by [Nebius Token Factory](https://tokenfactory.nebius.com/).
  Built for the Nebius x NVIDIA Global AI Hackathon.
- [parthh01/sphinx](https://github.com/parthh01/sphinx) (MIT): Ownit's hook chaining (keep the
  existing hook and run it first), `core.hooksPath` detection, recursion guard, and launcher
  fallback follow its approach.
- Related projects that shaped the thinking:
  [shekharrs/explainit](https://github.com/shekharrs/explainit), a multiple-choice quiz on staged
  changes, and [bhaskargurram-ai/proofcheck](https://github.com/bhaskargurram-ai/proofcheck),
  "evidence, not authorship" for pull requests.

## License

MIT. See [LICENSE](LICENSE).
