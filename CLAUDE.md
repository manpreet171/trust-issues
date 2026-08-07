# Working rules for trust-issues

A Claude Code plugin. Zero dependencies, Node 18+. No build step.
`plugins/trust-issues/scripts/plumb.mjs` is vendored from
[plumb](https://github.com/manpreet171/plumb) — fix bugs there and copy across,
never diverge the two.

## Commits

One short human line. **Never a `Co-Authored-By: Claude` trailer and no AI
attribution of any kind** — GitHub renders it as a second Contributor on the
repo front page, beside the author. Commit as `manpreet171
<singh.manpreet171900@gmail.com>`. Saying "Claude Code" in a body as a technical
term is fine; the attribution trailer is not.

## Always log what you did

**Every session that changes anything appends to `LOG.md` before it finishes.**
Newest date first, one line per change, what changed and *why*. Log decisions and
rejected ideas too. Get the date from the system, never guess it.

## The hook must fail open

Any unexpected error exits 0 silently. A broken guardrail degrades to *no*
guardrail, never to a blocked agent — a plugin that can wedge someone's session
gets uninstalled the same hour and deserves to be.

- `stop_hook_active` short-circuits, or a blocking hook re-triggers itself forever.
- Claims under 80 characters are ignored. "Done." is not worth checking and
  checking it only produces noise.
- Default is to inform. Blocking is opt-in via `TRUST_ISSUES=strict`.

## Tests

`node test/hook.test.mjs` builds a real git repo and a real transcript. The
transcript must live **outside** the repo under test — Claude Code keeps them in
`~/.claude/projects`, and one sitting in the working tree gets reported as an
unmentioned file and fails the honest case for the wrong reason.
