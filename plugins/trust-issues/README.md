# Trust Issues

Your agent says it's done. It said that last time, too.

Every time Claude Code (or one of its subagents) finishes, this plugin takes the
paragraph the agent just wrote and holds it against the real `git diff`. It reports
four things the summary left out:

- **Changed but never mentioned**: files modified or newly created that the agent never named
- **Quiet cuts**: a guard, an assertion, a test case or an error path that is now gone
- **Mutes**: `.skip`, `xit`, `@ts-ignore`, `# noqa`, `continue-on-error: true`
- **Mentioned but not changed**: work the agent described that the diff never touched

When the story holds, it says nothing. By default it informs and never blocks. Set
`TRUST_ISSUES=strict` and the agent has to answer for the diff before it can call
the work done.

Run it by hand with `/trust-issues`, `/trust-issues main` (compare against a
branch) or `/trust-issues 42` (check a pull request).

## What it runs and touches

- **Hooks:** `Stop` and `SubagentStop`, running `scripts/stop-check.mjs` with Node 18+.
- **Reads:** the agent's last message from the Claude Code transcript on your
  machine, and your repository through `git`. Outside a git repository it does nothing.
- **Writes:** one temporary file holding that message while the check runs,
  deleted straight after.
- **Network:** none from the hooks. Only `/trust-issues <PR number>` reaches the
  network: it calls the GitHub CLI (`gh pr view`) with your own `gh` login.
- No dependencies, no LLM call, no API key, no telemetry. Nothing is sent to
  Singh Labs.

Full documentation: https://github.com/manpreet171/trust-issues ·
https://singhlabs.dev/trust-issues/ · MIT licence.
