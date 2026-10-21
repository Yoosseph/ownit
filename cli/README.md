# getownit

The `ownit` command. Right after you `git push`, it runs a short debrief in your terminal about
what you just shipped: why, how, and what's next. NVIDIA Nemotron (on Nebius or NVIDIA) writes the questions
and grades your answers generously.

```sh
npm i -g getownit
ownit login       # GitHub device flow
ownit key set     # pick Nebius or NVIDIA, then paste your key; stored only in ~/.ownit/config.json
ownit init        # in a repo: installs the pre-push hook
```

On each push: `Debrief now? [Y/n/s=skip]`. Ownit never blocks a push. Pending debriefs can be
finished any time with `ownit interview`.

Your code and answers are never stored, and your key is never stored or logged by the server.

Full documentation: [github.com/Yoosseph/ownit](https://github.com/Yoosseph/ownit).
