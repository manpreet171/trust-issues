---
description: Hold the last thing the agent said against the real diff
---

Run the check by hand, right now, without waiting for the agent to finish.

Run this and show the output verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/plumb.mjs" check --base "${1:-HEAD}"
```

If `$1` is a pull request number instead of a git ref, run this instead:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/plumb.mjs" check --pr "$1"
```

Then say, in one or two sentences, which finding you would read first and why.
Do not summarize the whole report back — it is already on screen. Do not
reassure the user that the findings are probably fine. If there are no
findings, say so in one line and stop.
