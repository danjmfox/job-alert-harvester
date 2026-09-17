# RCA: `--in` reports success while harvesting nothing

**Type:** Explanation
**Date:** 2026-09-17
**Author:** main instance, not `@nw-troubleshooter` — see *Process deviation* below.

## Summary

`harvest.mjs --in <dir> --out <file>` writes an empty workbook and exits 0 when the
directory holds no `*.json` at its top level. Pointed at the month-sharded cache root
— the documented full-reparse path — it silently produces a 146-row-shaped workbook
with zero rows and **overwrites whatever was at `--out`**.

## Reproduction

```
$ node src/cli/harvest.mjs --in .cache/messages --out /tmp/sz.xlsx
harvested 0 messages -> 0 jobs, 0 companies, 0 saved searches
wrote /tmp/sz.xlsx
$ echo $?
0
```

`.cache/messages` holds 59 messages, all under `.cache/messages/2026-09/`.

## Root cause chain

1. **Why 0 messages?** `readAllIn` (`src/adapters/json-message-reader.mjs:11`) calls
   `readdirSync(directory)` without `{ recursive: true }` and filters `.json` — the
   month shard is a directory, so nothing matches.
2. **Why does the cache disagree with the reader?** `ingest` writes shards
   (`.cache/messages/<YYYY-MM>/<id>.json`), and `idsIn` (line 18) *is* recursive. The
   adapter carries two listing strategies with different reaches and its header comment
   records the split as deliberate: `readAll()` for "a flat directory (fixtures, or one
   cache shard)", `ids()` for "the whole month-sharded cache root".
3. **Why did the asymmetry survive?** The only `readAll` caller is the `--in` branch
   (`src/cli/harvest.mjs:152`), and its only test is the walking skeleton, which points
   at the flat `fixtures/linkedin`. No test ever pointed `--in` at the real cache.
4. **Why is zero not an error?** The `--in` branch has no probe and no emptiness check.
   It reads, harvests, writes, and reports — the count appears in the success message
   rather than gating it.
5. **Why does this matter beyond a wrong count?** DR-0001 (persist what cannot be
   re-derived) makes full reparse the *default* repair path — the justification for
   caching raw mail at all. The command implementing that path cannot read the cache it
   was built for, and says so only as a `0` inside a success line.

## Contributing factor: a missing directory crashes raw

```
$ node src/cli/harvest.mjs --in .cache/nope --out /tmp/x.xlsx
Error: ENOENT: no such file or directory, scandir '.cache/nope'
    at readdirSync (node:fs:1583:26) ...
```

Exit 1 is correct; an unhandled stack trace is not. `cli/harvest.mjs:7` promises
"Wire, then probe, then use: a failed probe refuses to start". The subcommands probe;
the `--in` branch does not.

## Failure class

This is the **silent-zero** class: a denied or empty read reported as a completed one.
`~/.claude/CLAUDE.md` names it directly — "An empty result is not a pass" — and the
mitigation is to assert on something the work had to *cause*, not on absence of output.
DR-0003 made the same argument for the ingest path, where `--expect <n>` converts a
partial fetch into a refusal. The `--in` rebuild path never got the equivalent guard.

## Proposed fix

1. `readAll()` walks subdirectories, as `ids()` already does — one reach, not two.
2. The `--in` branch refuses when the input yields zero messages: non-zero exit, no
   file written. An empty corpus is never a legitimate rebuild.
3. The `--in` branch probes its input directory before reading and refuses with a
   readable message, no stack trace.

Nothing may be written to `--out` on any refusal path — a refusal that has already
clobbered the target is not a refusal.

## Risk

Low. `readAll` has exactly one caller. Recursion cannot change the walking skeleton's
result: `fixtures/linkedin` has no subdirectories, and `fixtures/linkedin-variants` is
a sibling, not a child. The emptiness guard is new behaviour on a path whose only
current use is the manual rebuild.

## Process deviation

`nw-bugfix` Phase 1 names `@nw-troubleshooter`. Not dispatched: the defect was
reproduced directly and the causal chain is three files with line numbers, so a
dispatched investigation would re-derive settled evidence. Flagged rather than silently
skipped, per standing orders. Phase 3 (the fix) goes to the crafter as normal — that is
the part needing the specialist, and the capture obligation is unchanged: the fix lands
behind a failing-first acceptance test.
