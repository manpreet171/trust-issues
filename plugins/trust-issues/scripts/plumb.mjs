#!/usr/bin/env node
// plumb — hold the agent's summary against what it actually changed.
// Zero dependencies. Node 18+.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const VERSION = '1.1.0';

// ---------------------------------------------------------------- git

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], // git's line-ending warnings are not ours to print
    });
  } catch (err) {
    const msg = (err.stderr || err.message || '').trim().split('\n')[0];
    die(`git ${args.join(' ')} failed — ${msg}`);
  }
}

// Files changed, as [{ status, path }]. base is a ref, or null for the working
// tree (staged + unstaged, which is what you have right after an agent run).
//
// Untracked files count. `git diff` never lists them, and an agent that drops a
// new .env.local or deploy.sh is doing the exact thing this tool exists to
// catch — so they are collected separately and merged in.
function changedFiles(base, head) {
  const args = base
    ? ['diff', '--name-status', '--find-renames', base, ...(head ? [head] : [])]
    : ['diff', '--name-status', '--find-renames', 'HEAD'];
  const tracked = git(args)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      // Renames are "R100\told\tnew" — report the destination.
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });

  // A PR has no working tree, so untracked files are meaningless there.
  if (head) return tracked;

  // --exclude-standard honours .gitignore, so build output and node_modules
  // stay out of the report.
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .map((path) => ({ status: 'U', path }));

  const seen = new Set(tracked.map((f) => f.path));
  return tracked.concat(untracked.filter((f) => !seen.has(f.path)));
}

function unifiedDiff(base, head) {
  const args = base ? ['diff', '-U0', base, ...(head ? [head] : [])] : ['diff', '-U0', 'HEAD'];
  return git(args);
}

// ---------------------------------------------------------------- the claim

// Pull every path-ish token out of the agent's prose. Agents write paths three
// ways: in backticks, bare with a slash, and as a bare filename with an
// extension. All three count.
const EXT = 'js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|php|cs|swift|sh|bash|sql|css|scss|html|md|json|yml|yaml|toml|ini|env|lock|txt|xml|vue|svelte';
const TOKEN = new RegExp(`[\\w.\\-/\\\\]+\\.(?:${EXT})\\b`, 'gi');

function claimedNames(text) {
  const found = new Set();
  // A link to a file on github.com is not a claim to have changed it, and the
  // path inside it is not a path in this repo. Drop URLs before matching.
  for (const raw of text.replace(/\bhttps?:\/\/\S+/gi, ' ').match(TOKEN) || []) {
    const clean = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    found.add(clean.toLowerCase());
    found.add(basename(clean).toLowerCase());
  }
  return found;
}

// A file counts as claimed if its full path or its basename was named.
function isClaimed(path, names) {
  const p = path.toLowerCase();
  return names.has(p) || names.has(basename(p));
}

// ---------------------------------------------------------- the quiet cuts

// Things that get removed when an agent is making a problem go away rather than
// solving it. These are reported whether or not the file was claimed, because
// nobody writes "and I deleted an assertion" in a summary.
const CUTS = [
  [/\b(assert\w*|expect)\s*\(/i, 'assertion removed'],
  [/^\s*(it|test|describe|context)\s*\(/i, 'test case removed'],
  [/\b(try|catch|except|rescue|finally)\b\s*[:({]/i, 'error handling removed'],
  [/\b(throw|raise)\b/i, 'error path removed'],
  [/\b(validate|verify|sanitize|escape|authoriz|authenticat|csrf|checksum)\w*/i, 'check removed'],
  [/^\s*if\s*\(?\s*!/i, 'guard removed'],
];

// Things that get added for the same reason.
const MUTES = [
  [/\.(skip|only)\s*\(|^\s*x(it|describe)\s*\(/i, 'test skipped'],
  [/@pytest\.mark\.(skip|xfail)/i, 'test skipped'],
  [/@ts-(ignore|expect-error)|eslint-disable|# type:\s*ignore|# noqa|#\s*nosec/i, 'linter or type check silenced'],
  [/\bcontinue-on-error\s*:\s*true/i, 'CI failure silenced'],
];

// A line that came back wearing a mute is not a deletion. `it(...)` removed and
// `it.skip(...)` added is one line being skipped, not a test being deleted — say
// the true thing, or nobody believes the rest of the report.
function skeleton(s) {
  return s
    .replace(/\.(skip|only)\b/gi, '')
    .replace(/\bx(it|describe)\b/gi, '$1')
    .replace(/\s+/g, '')
    .toLowerCase();
}

// Walk a -U0 unified diff, tracking which file each hunk belongs to.
function scanDiff(text) {
  const hits = [];
  const added = new Set();
  const addedText = new Map(); // file -> everything added to it, for the survival check
  let file = null;
  let line = 0;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
      if (file === '/dev/null') file = null;
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      line = m ? Number(m[1]) : 0;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('-') && !raw.startsWith('---')) {
      const body = raw.slice(1);
      if (!body.trim()) continue;
      for (const [re, label] of CUTS) {
        const m = body.match(re);
        if (m) { hits.push({ file, line, label, body: body.trim(), cut: skeleton(body), token: m[0].toLowerCase().trim() }); break; }
      }
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const body = raw.slice(1);
      if (body.trim()) {
        added.add(file + '|' + skeleton(body));
        addedText.set(file, (addedText.get(file) || '') + '\n' + body.toLowerCase());
        for (const [re, label] of MUTES) {
          if (re.test(body)) { hits.push({ file, line, label, body: body.trim() }); break; }
        }
      }
      line++;
    }
  }
  // Only report a cut if the thing is actually gone. A reformatted or renamed
  // line still has its guard, and crying wolf about a refactor is how a tool
  // like this stops being read.
  // ponytail: token-level survival check, not scope-aware — one assertion of
  // three dropped from a rewritten test goes unreported. Parse properly if that
  // ever bites.
  return hits.filter((h) => {
    if (!h.cut) return true;
    if (added.has(h.file + '|' + h.cut)) return false;
    return !(addedText.get(h.file) || '').includes(h.token);
  });
}

// ---------------------------------------------------------------- output

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', yellow: '', green: '', bold: '', off: '' };

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'retyped', U: 'new, untracked' };

function report(r) {
  const out = [];
  out.push(`${C.bold}plumb${C.off} ${C.dim}— ${r.changed.length} file${r.changed.length === 1 ? '' : 's'} changed, ${r.claimedCount} named in the summary${C.off}`);
  out.push('');

  if (r.unclaimed.length) {
    out.push(r.pr
      ? `${C.yellow}touched but not described${C.off}  ${C.dim}(context, not a failure — PRs describe intent)${C.off}`
      : `${C.red}changed but never mentioned${C.off}  ${C.dim}(read these first)${C.off}`);
    for (const f of r.unclaimed) out.push(`  ${C.red}·${C.off} ${f.path} ${C.dim}${STATUS[f.status] || f.status}${C.off}`);
    out.push('');
  }
  if (r.cuts.length) {
    out.push(`${C.yellow}quiet cuts${C.off}  ${C.dim}(removed or silenced, whatever the summary says)${C.off}`);
    for (const h of r.cuts) {
      out.push(`  ${C.yellow}·${C.off} ${h.file}:${h.line} ${C.dim}${h.label}${C.off}`);
      out.push(`    ${C.dim}${h.body.length > 76 ? h.body.slice(0, 73) + '...' : h.body}${C.off}`);
    }
    out.push('');
  }
  if (r.phantom.length) {
    out.push(`${C.yellow}mentioned but not changed${C.off}`);
    for (const p of r.phantom) out.push(`  ${C.yellow}·${C.off} ${p}`);
    out.push('');
  }

  if (r.pr) {
    // On a PR only the hard findings count — see the note in emit().
    const hard = r.cuts.length + (r.ghosts ? r.ghosts.length : 0);
    out.push(hard === 0
      ? `${C.green}nothing here contradicts the description.${C.off}`
      : `${C.dim}${hard} thing${hard === 1 ? '' : 's'} to read before you merge this.${C.off}`);
    return out.join('\n');
  }
  const n = r.unclaimed.length + r.cuts.length + r.phantom.length;
  if (n === 0) out.push(`${C.green}the summary holds.${C.off} ${C.dim}Every change was named, nothing was quietly cut.${C.off}`);
  else out.push(`${C.dim}${n} thing${n === 1 ? '' : 's'} the summary did not tell you.${C.off}`);
  return out.join('\n');
}

// ---------------------------------------------------------------- commands

// A pull request is the same shape as an agent's summary: a written claim about
// a diff. `--pr` fetches the description and the base ref from GitHub so the
// same checks apply to a contribution nobody in your team wrote.
function prClaim(number) {
  const raw = git(['config', '--get', 'remote.origin.url']) || '';
  const m = raw.match(/github\.com[:/]([^/]+)\/([^/.\s]+)/);
  if (!m) die('--pr needs a github remote on origin.');
  const repo = `${m[1]}/${m[2]}`;
  let json;
  try {
    json = execFileSync('gh', ['pr', 'view', String(number), '--repo', repo,
      '--json', 'title,body,baseRefName,baseRefOid,headRefName,author'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = (err.stderr || err.message || '').trim().split('\n')[0];
    die(`could not read PR #${number} — ${msg}\n  plumb --pr needs the GitHub CLI: https://cli.github.com`);
  }
  const pr = JSON.parse(json);
  return {
    text: `${pr.title}\n\n${pr.body || ''}`,
    // baseRefOid, not the branch tip: once a PR is merged its head is an
    // ancestor of the branch, so merge-base against today's tip is the head
    // itself and the diff comes back empty.
    base: pr.baseRefOid,
    branch: pr.baseRefName,
    label: `#${number} by ${pr.author?.login || 'unknown'} → ${pr.baseRefName}`,
  };
}

function check(argv) {
  const prNumber = flag(argv, '--pr');
  if (prNumber) return checkPr(argv, prNumber);

  const base = flag(argv, '--base');
  const claimPath = flag(argv, '--claim') || argv.find((a) => !a.startsWith('-'));

  let claim = '';
  if (claimPath) {
    if (!existsSync(claimPath)) die(`no such file: ${claimPath}`);
    claim = readFileSync(claimPath, 'utf8');
  } else if (!process.stdin.isTTY) {
    claim = readFileSync(0, 'utf8');
  } else {
    die('nothing to hold the diff against.\n  Paste the agent\'s summary:  plumb check summary.md\n  Or pipe it:                 pbpaste | plumb check');
  }

  // The summary file is usually written into the repo you are checking. It is
  // not part of the agent's work, so reporting it every single time would be a
  // guaranteed false positive.
  const self = claimPath ? basename(claimPath).toLowerCase() : null;
  const changed = changedFiles(base).filter((f) => basename(f.path).toLowerCase() !== self);
  if (!changed.length) die('no changes to check — the working tree is clean.');

  const names = claimedNames(claim);
  const unclaimed = changed.filter((f) => !isClaimed(f.path, names));
  const changedSet = new Set(changed.flatMap((f) => [f.path.toLowerCase(), basename(f.path).toLowerCase()]));
  const phantom = [...names].filter((n) => !changedSet.has(n) && n.includes('/'));
  const cuts = scanDiff(unifiedDiff(base));

  const result = {
    changed,
    claimedCount: changed.length - unclaimed.length,
    unclaimed,
    phantom,
    cuts,
  };

  emit(result, argv);
}

function emit(result, argv, extra = []) {
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(report(result));
    for (const line of extra) console.log(line);
  }
  // An agent names the files it touched; a human writes "adds X to the docs"
  // and never types README.md. So on a pull request an unnamed file is context,
  // not a finding — otherwise this fires on every honest PR ever opened.
  const findings = result.pr
    ? result.cuts.length + result.ghosts.length
    : result.unclaimed.length + result.cuts.length + result.phantom.length;
  process.exit(findings && !argv.includes('--warn-only') ? 1 : 0);
}

// Symbols a PR description names that exist nowhere in the repo or the diff.
// This is the curl failure: reports citing functions deleted years ago and APIs
// that never existed. A human needs hours to disprove one; grep needs a second.
function ghostSymbols(claim, base, head) {
  const words = claim.match(/`([A-Za-z_][\w.]{3,60})`|\b([a-z][A-Za-z0-9]{4,40})\(\)/g) || [];
  const named = [...new Set(words.map((w) => w.replace(/[`()]/g, '')).filter(Boolean))]
    // `httpx` in a sentence is a library being compared against, not a symbol
    // this PR claims to have written. Require something that reads like an
    // identifier — a capital, an underscore, a dot, or a call — before
    // accusing anyone of inventing it.
    .filter((s) => /[A-Z_.]/.test(s) || claim.includes(`${s}()`));
  if (!named.length) return [];
  // Anything added by this PR counts as existing — it is being created here.
  const added = unifiedDiff(base, head)
    .split('\n')
    .filter((l) => l.startsWith('+'))
    .join('\n');
  const ghosts = [];
  for (const sym of named) {
    if (added.includes(sym)) continue;
    // Not git(): grep exits 1 when it finds nothing, which is the answer we
    // want, not a failure. git() would treat that as fatal and kill the run.
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-l', '--fixed-strings', sym, base],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { hits = ''; }
    if (!hits.trim()) ghosts.push(sym);
  }
  return ghosts;
}

function checkPr(argv, number) {
  const pr = prClaim(number);
  // A PR's commits are not in a normal clone — they live on a fork or an
  // unfetched branch. Fetch the head into a private ref, then compare the base
  // against it, so this works on a fresh checkout with no setup.
  const head = `refs/plumb/pr-${number}`;
  git(['fetch', '--quiet', 'origin', `pull/${number}/head:${head}`, '--force']);
  git(['fetch', '--quiet', 'origin', pr.branch]);
  const base = git(['merge-base', pr.base, head]).trim();
  if (!base) die(`cannot find a common ancestor for PR #${number}.`);

  const changed = changedFiles(base, head);
  if (!changed.length) die(`PR ${pr.label} changes nothing against ${base}.`);

  const names = claimedNames(pr.text);
  const unclaimed = changed.filter((f) => !isClaimed(f.path, names));
  const changedSet = new Set(changed.flatMap((f) => [f.path.toLowerCase(), basename(f.path).toLowerCase()]));
  const phantom = [...names].filter((n) => !changedSet.has(n) && n.includes('/'));

  const result = {
    pr: pr.label,
    changed,
    claimedCount: changed.length - unclaimed.length,
    unclaimed,
    phantom,
    cuts: scanDiff(unifiedDiff(base, head)),
    ghosts: ghostSymbols(pr.text, base, head),
    disclosed: /assisted-by\s*:|\bllm\b|\bai[- ]assisted\b|claude|copilot|cursor|chatgpt/i.test(pr.text),
  };

  const extra = [];
  if (result.ghosts.length) {
    extra.push('');
    extra.push(`${C.red}named in the description, found nowhere${C.off}  ${C.dim}(neither in this diff nor in ${base})${C.off}`);
    for (const g of result.ghosts) extra.push(`  ${C.red}·${C.off} ${g}`);
  }
  extra.push('');
  extra.push(result.disclosed
    ? `${C.dim}The description mentions AI assistance.${C.off}`
    : `${C.dim}No AI disclosure in the description — that may be fine, or it may be undisclosed.${C.off}`);

  console.log(`${C.dim}PR ${result.pr}${C.off}`);
  emit(result, argv, extra);
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

function die(msg) {
  console.error(`plumb: ${msg}`);
  process.exit(2);
}

const USAGE = `plumb ${VERSION} — hold the agent's summary against what it actually changed.

  plumb check <summary-file>     compare the summary to the working tree
  plumb check --pr 42            check a pull request: does the description match the diff?
  plumb check --base main        compare against a branch or commit instead
  cat summary.md | plumb check   read the summary from stdin

  --claim <file>   the agent's summary (same as the positional argument)
  --base <ref>     diff against this ref instead of HEAD
  --json           machine-readable output
  --warn-only      always exit 0, for a soft rollout

exit 0 clean · 1 findings · 2 usage error
`;

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'check': check(rest); break;
  case 'version': case '--version': case '-v': console.log(VERSION); break;
  default: console.log(USAGE); process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 2 : 0);
}
