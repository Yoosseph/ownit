# Ownit

**Own the code you ship.** After each `git push`, Ownit asks you one to three short questions about
the change, right in your terminal: why you made it, how it works, and what could come next.
NVIDIA Nemotron on Nebius writes the questions and grades your answers.

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

You need Node 20+, a GitHub repo and a [Nebius API key](https://tokenfactory.nebius.com/).

```sh
npm i -g getownit
ownit login       # sign in with GitHub
ownit key set     # paste your Nebius key (stays on your machine)
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

```text
ownit interview                  Answer questions for pending pushes
ownit interview --range A..B     Answer questions about any commit range
ownit key set|clear|status       Manage your Nebius key
ownit whoami                     Show login and key status
ownit uninstall                  Remove the hook
ownit logout
```

### Badge

Your repo gets a page and a badge, like `ownit | 90% verified`. Copy the badge code from
`https://ownit.ownit-worker.workers.dev/<owner>/<repo>` into your README.

## More

Privacy, self-hosting, how it works and limitations: [docs/DETAILS.md](docs/DETAILS.md).
Overview of the code: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

MIT licensed.
