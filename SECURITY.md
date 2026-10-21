# Security

## Reporting a vulnerability

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/Yoosseph/ownit/security/advisories/new),
not in a public issue. Include what you found, how to reproduce it, and what an attacker could do.
You'll get a reply within a few days, and credit in the fix if you'd like it.

Especially in scope:

- Leaking or storing code, answers, API keys or GitHub tokens.
- Getting a push marked verified without passing its questions, including prompt injection through
  a diff, a commit message or an answer.
- Debriefing or changing pushes in a repo you have no push access to.
- Forging webhooks, session tokens or the sealed debrief state.

## Supported versions

Fixes go into the latest `getownit` release and the hosted server at
`ownit.ownit-worker.workers.dev`. Self-hosters should update to the latest `main`.

## If you leaked a key

If you pasted a Nebius or NVIDIA key somewhere public (an issue, a commit, a chat), revoke it in the
provider's console and create a new one. Ownit never needs your key anywhere except `ownit key set`.
