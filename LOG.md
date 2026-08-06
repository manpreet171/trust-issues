# Change log

What changed here and why. Appended every session. Newest first.

---

## 2026-08-06 — v1.0.0: because nobody ran the CLI, including me

- **This exists because `plumb check summary.md` asks for three things at the
  worst possible moment**: remember the tool, copy the agent's paragraph into a
  file, run a command. That's 11pm on a Friday, which is the exact reason you're
  merging without reading the diff in the first place. A `Stop` hook does all
  three every time and asks for nothing.
- **The hook reads the agent's real last message out of the Claude Code
  transcript** (`transcript_path` → last `assistant` entry → its `text` blocks)
  and hands it to plumb as the claim. Nothing to save, nothing to remember.
- **Fail-open, always.** Any unexpected error exits 0 silently. A broken
  guardrail must degrade to *no* guardrail, never to a blocked agent. Proven
  accidentally during testing: handed an MSYS-style temp path that Node could
  not chdir into, the hook went quiet instead of breaking the session.
- **Silent by default; `TRUST_ISSUES=strict` blocks.** Same soft-rollout logic
  as plumb's `--warn-only`, pointed the other way. A guardrail that interrupts
  you on its first false positive is uninstalled by lunchtime.
- **`stop_hook_active` short-circuit.** Without it, a blocking hook re-triggers
  itself and the session loops forever.
- **Claims under 80 characters are ignored.** "Done." is not a claim worth
  checking, and checking it only produces noise.
- **The honest-case test failed on its own artifact**, not on the logic: the
  test wrote its transcript *inside* the repo, so plumb correctly reported an
  unmentioned untracked file. Fixed by writing it outside, which is where Claude
  Code actually keeps transcripts. The assertion stayed as strict as it was —
  weakening it would have hidden the real behaviour.
- **Why "trust issues".** The shelf it comes from is four tools with serious
  names and zero users. The one thing measurably winning in this ecosystem
  (`caveman`, 96k stars) is a joke with a real number behind it. This is the
  first Singh Labs product whose name is funny before it is descriptive.
