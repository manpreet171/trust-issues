<p align="center">
  <img src="assets/mark.png" alt="A character squinting through a magnifying glass at an empty speech bubble" width="300">
</p>

<p align="center">
  <strong>Your agent says it's done.</strong><br>
  <strong>It said that last time, too.</strong>
</p>

<p align="center">
  A Claude Code plugin that reads the paragraph your agent just wrote,<br>
  holds it against the actual <code>git diff</code>, and tells you the difference.<br>
  <strong>You run nothing. You remember nothing.</strong>
</p>

<p align="center">
  Part of <a href="https://singhlabs.dev/trust-issues/">Singh Labs</a> — guardrails for AI coding agents.<br>
  Created by <a href="https://github.com/manpreet171">Manpreet Singh</a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-it-caught">What it caught</a> ·
  <a href="#why-a-hook-and-not-a-cli">Why a hook</a> ·
  <a href="#the-quiet-part">The quiet part</a>
</p>

---

## The problem, in one exchange

> **Agent:** Done. I simplified the guard clause in `auth.js` and updated the test
> in `auth.test.js` so the suite is green again. Everything passes now and the
> change is minimal — nothing else was touched.

Every sentence there is true. You read it, you're tired, and you merge.

Here is what `trust issues` said back, with nobody asking it to:

```
trust issues — the diff says otherwise:

plumb — 5 files changed, 2 named in the summary

changed but never mentioned  (read these first)
  · config.js modified
  · .env.local new, untracked

quiet cuts  (removed or silenced, whatever the summary says)
  · auth.js:1 error path removed
    if (!u) throw new Error("no user");
  · auth.test.js:1 test skipped
    it.skip('rejects blanks', () => { expect(login('')).toThrow(); });

5 things the summary did not tell you.
```

The suite is green because the test was skipped. There is a secret on disk in a
file nobody mentioned. "Nothing else was touched" was **not a lie** — it just
isn't how anybody writes down the parts that would make them look bad.

Nobody writes *"and I deleted an assertion so the tests would pass."* That
sentence isn't an explanation, it's a confession, and summaries are written to
explain.

## Install

```
/plugin marketplace add manpreet171/trust-issues
```

```
/plugin install trust-issues
```

Node 18+. No dependencies, no config, no API key, no LLM call, nothing to sign
up for. It reads your transcript and it reads `git`. That's the entire
integration surface.

## What it caught

Four checks, every time your agent stops talking:

| | What it means |
| - | ------------- |
| **Changed but never mentioned** | A file modified *or newly created* that appears nowhere in what the agent said |
| **Quiet cuts** | A guard, an assertion, a test case or an error path that is now gone |
| **Mutes** | `.skip`, `xit`, `@ts-ignore`, `# noqa`, `continue-on-error: true` |
| **Mentioned but not changed** | Work the agent described that the diff never touched |

Quiet cuts and mutes get reported whether or not the file was mentioned, because
they are never in the summary anyway.

## Why a hook and not a CLI

Because I shipped the CLI first and watched nobody use it — including me.

`plumb check summary.md` asks you to (a) remember the tool exists, (b) copy the
agent's paragraph into a file, (c) run a command. That's three steps at 11pm on
a Friday, and the whole reason you're merging without reading the diff is that
it's 11pm on a Friday.

A `Stop` hook does all three every single time and asks you for nothing. Same
checks. Same code. The difference between a tool you own and a tool you use.

## The quiet part

**It stays silent when the story holds.** That's the actual feature. A guardrail
that cries wolf gets uninstalled the same afternoon, and then the one real
finding ships with a green tick beside it.

So a cut is only reported if the thing is genuinely gone — if the token still
appears anywhere in the added lines, it's a rename or a reformat and you hear
nothing. It under-reports on purpose. One missed finding costs you a review; one
false alarm costs you the tool.

It also doesn't block. It tells you, and you decide. When you trust it:

```bash
export TRUST_ISSUES=strict
```

Now the agent has to answer for the diff before it's allowed to call it done.

## Run it by hand

```
/trust-issues
```

Checks the working tree right now. Give it a base to compare against, or a pull
request number from somebody you've never met:

```
/trust-issues main
/trust-issues 42
```

On a pull request there's one extra check, and it's the one maintainers keep
getting burned by: **symbols the description names that exist nowhere** — not in
the diff, not anywhere in the base branch. The confident
`fixes sanitizeUserInput()` where there has never been a `sanitizeUserInput`.

## Does it use an LLM?

No. Regexes and `git`. It runs offline, in a fraction of a second, and costs
nothing per run. Your code never leaves the machine.

## Uninstall

```
/plugin uninstall trust-issues
```

It writes nothing outside your repo — no config, no cache, no state directory.
That's all of it.

## Credit where it's due

The engine is [plumb](https://github.com/manpreet171/plumb), which is the same
checks as a standalone CLI if you'd rather have one. Its sibling
[slopguard](https://github.com/manpreet171/slopguard) works the other end of the
problem — it inspects generated code *before* Write and Edit touch disk.

Running plumb against eight real pull requests in three real repos found three
bugs **in plumb**, all of them false positives, all of them fixed. Every one of
them passed a green local test suite first. Make of that what you will.

## Author

**Manpreet Singh** — [GitHub](https://github.com/manpreet171) ·
[LinkedIn](https://www.linkedin.com/in/manpreet17/) ·
[Medium](https://medium.com/@singh.manpreet171900)

More guardrails for people shipping with AI agents: **[singhlabs.dev](https://singhlabs.dev/)**

## License

MIT
