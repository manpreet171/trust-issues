#!/usr/bin/env node
// Stop hook. The agent has just finished talking. Take what it actually said —
// not a summary anyone remembered to save — and hold it against the diff.
//
// This is the whole point of shipping as a plugin rather than a CLI. `plumb
// check summary.md` requires a human to (a) remember, (b) copy the paragraph,
// (c) run a command. Nobody does all three at 11pm. A Stop hook does it every
// time, for free, and the human does nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Never let a guardrail be the reason a session dies. Any unexpected failure
// exits 0 silently — a broken checker must degrade to no checker, not to a
// blocked agent.
function bail() { process.exit(0); }

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch { bail(); }

let ctx = {};
try { ctx = JSON.parse(input || '{}'); } catch { bail(); }

// The hook can trigger itself when it blocks. Without this the session loops.
if (ctx.stop_hook_active) bail();

const cwd = ctx.cwd || process.cwd();

// Only meaningful inside a git repo — everything plumb does is a diff.
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'],
    { cwd, stdio: 'ignore' });
} catch { bail(); }

// Pull the agent's last spoken message out of the transcript. This is the
// claim: whatever it just told the human it did.
function lastAssistantText(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return ''; }
  const lines = raw.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

const claim = ctx.transcript_path ? lastAssistantText(ctx.transcript_path) : '';
// A one-line "done" is not a claim worth checking, and checking it would only
// produce noise. Silence beats a finding nobody asked for.
if (claim.length < 80) bail();

let report = '';
let found = false;
let dir;
try {
  dir = mkdtempSync(join(tmpdir(), 'trust-'));
  const claimFile = join(dir, 'claim.md');
  writeFileSync(claimFile, claim);
  execFileSync(process.execPath, [join(HERE, 'plumb.mjs'), 'check', claimFile], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  // Exit 1 is plumb's "I found something" — the only case worth reporting.
  if (err.status === 1) {
    report = String(err.stdout || '').trim();
    found = true;
  }
} finally {
  // The claim is the agent's own words; don't leave a copy in the temp folder.
  if (dir) rmSync(dir, { recursive: true, force: true });
}

if (!found || !report) bail();

// Default is to inform, never to block. A guardrail that interrupts you on its
// first false positive gets uninstalled the same afternoon. Opt into blocking
// with TRUST_ISSUES=strict once you trust it — same soft-rollout path as
// --warn-only, just pointed the other way.
if (process.env.TRUST_ISSUES === 'strict') {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason:
      `Before you call this done — the summary and the diff disagree:\n\n${report}\n\n` +
      'Either fix what was quietly changed, or say plainly what you did and why.',
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  systemMessage: `trust issues — the diff says otherwise:\n\n${report}`,
}));
process.exit(0);
