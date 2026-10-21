# Ownit

**Own the code you ship.** After each `git push`, Ownit asks you one to three short questions about
the change, right in your terminal: why you made it, how it works, and what could come next.
NVIDIA Nemotron (on Nebius or NVIDIA) writes the questions and grades your answers.

```text
$ git push
Ownit (2 commits to octo/shop) Debrief now? [Y/n/s=skip] y

Question 1/2 (why)
  Why does checkout now retry some failed card payments instead of failing the order right away?
> so temporary card errors dont lose the sale
✓ Passed.

Question 2/2 (how)
  How does the retry decide when to give up?
> permanent declines fail right away, temporary ones retry up to 3 times
✓ Passed.

✓ Push verified. 2 commits owned. Nice work.
```

## Why

Coding agents let you ship code faster than you can read it. Ownit makes understanding your own
code a habit: a two-minute check while the change is still fresh. Rough answers are fine. A miss
gets a hint and a new question, and you can always retry or skip.

## Setup

You need Node 20+, a GitHub repo and an API key from [Nebius Token Factory](https://tokenfactory.nebius.com/)
or, if you have no Nebius account, from [NVIDIA](https://build.nvidia.com/). Both serve the same Nemotron
model. `ownit key set` asks which one your key is for (or name it: `ownit key set nvidia`).

```sh
npm i -g getownit
ownit login       # sign in with GitHub
ownit key set     # pick Nebius or NVIDIA, then paste your key (stays on your machine)
cd your-repo
ownit init        # installs the pre-push hook
```

Then install the Ownit GitHub App on the repo. `ownit init` prints the link.

## Use

Push as usual. Ownit asks before each push:

| Answer | What happens |
| --- | --- |
| **Y** or Enter | Answer the questions now. |
| **n** | Do it later with `ownit interview`. |
| **s** | Skip this push. |

Your push always goes through, whatever you answer.

Each push is marked **verified** (all questions passed), **skipped**, or **pending** (not done yet;
it becomes skipped after 24 hours). GitHub shows the result as a check on the commit.

### Commands

| Command | What it does |
| --- | --- |
| `ownit login` | Sign in with GitHub. |
| `ownit init` | Install the pre-push hook in this repo and register it. |
| `ownit interview` | Debrief your pending pushes, including ones an AI agent made. |
| `ownit interview --range A..B` | Debrief any commit range. |
| `ownit key set [nebius\|nvidia]` | Save your API key. Paste it at the hidden prompt, never after the command. |
| `ownit key status` / `ownit key clear` | Show or remove the key. |
| `ownit whoami` | Show the server, your GitHub login and your key. |
| `ownit uninstall` | Remove the hook from this repo. |
| `ownit logout` | Sign out. |
| `OWNIT_SKIP=1 git push` | Push once without the prompt. The push is pending. |

### Pushes from AI agents

When a coding agent (Claude Code, Cursor, Codex, CI…) pushes, nobody is at the terminal, so Ownit
records the push as **pending** and lets it through. Run `ownit interview` yourself within 24 hours
to answer for the change, or it counts as skipped.

### Where to see your record

- **GitHub:** each commit gets an **Ownit** check: verified, skipped, or pending.
- **Repo page:** `https://ownit.ownit-worker.workers.dev/<owner>/<repo>` lists recent pushes and stats.
- **Badge:** like `ownit | 90% verified`. Copy its code from the repo page into your README.

## More

Privacy, self-hosting, how it works and limitations: [docs/DETAILS.md](docs/DETAILS.md).
Overview of the code: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

MIT licensed.
