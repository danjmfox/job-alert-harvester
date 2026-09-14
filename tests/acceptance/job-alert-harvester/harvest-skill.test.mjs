// @contract-shape:pure-function
// The harvest Claude Code skill (.claude/skills/harvest/SKILL.md) is prose an
// agent follows, not code — so its acceptance test is structural: it reads
// SKILL.md and asserts facts about the instructions it contains. Per
// DR-0003 (the agent couriers paths and control values, never records) and
// DR-0007 (the spill contract is what the harness writes), the skill must be
// thin by construction: two CLI verbs, control-value flags only, per-window
// spill staging by path, UTC-epoch Gmail bounds, and a hard stop on inline
// fetch results. Each rule below is one it() and is written so a scaffold
// (frontmatter + a placeholder sentence) cannot satisfy it — the assertion
// most likely to fail on empty content is asserted first in every case.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_PATH = join(new URL('../../../', import.meta.url).pathname, '.claude/skills/harvest/SKILL.md');

function readSkill() {
  return readFileSync(SKILL_PATH, 'utf8');
}

function frontmatterOf(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!match) return null;
  const yaml = match[1];
  const field = (key) => {
    const fieldMatch = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(yaml);
    return fieldMatch ? fieldMatch[1].trim() : null;
  };
  return { name: field('name'), description: field('description') };
}

function codeBlocksOf(text) {
  return text.match(/```[\s\S]*?```/g) ?? [];
}

describe('harvest skill contract — .claude/skills/harvest/SKILL.md (DR-0003, DR-0007)', () => {
  it('rule 1: has YAML frontmatter naming the skill and describing it', () => {
    const frontmatter = frontmatterOf(readSkill());

    expect(frontmatter).not.toBeNull();
    expect(frontmatter.name).toBeTruthy();
    expect(frontmatter.description).toBeTruthy();
  });

  it('rule 2: loops plan-fetch, fetch, ingest until plan-fetch reports full coverage', () => {
    const skill = readSkill();

    const mentionsPlanFetch = /\bplan-fetch\b/i.test(skill);
    const mentionsIngest = /\bingest\b/i.test(skill);
    const mentionsRepetition = /\b(repeat|loop|until)\b/i.test(skill);
    const mentionsFullCoverage = /\b(fully covered|full coverage|no uncovered window|coverage is complete)\b/i.test(skill);

    expect(mentionsPlanFetch, 'expected the skill to mention plan-fetch').toBe(true);
    expect(mentionsIngest, 'expected the skill to mention ingest').toBe(true);
    expect(mentionsRepetition, 'expected a repeat/loop/until instruction').toBe(true);
    expect(mentionsFullCoverage, 'expected a full-coverage stop condition').toBe(true);
  });

  it('rule 3: invokes the harvester only as plan-fetch or ingest, and no other command reads spill or cache content', () => {
    const skill = readSkill();
    const codeBlocks = codeBlocksOf(skill);

    const invokedVerbs = new Set();
    for (const block of codeBlocks) {
      for (const match of block.matchAll(/\bharvest\s+([a-zA-Z][a-zA-Z-]*)/g)) {
        invokedVerbs.add(match[1]);
      }
    }
    const forbiddenReads = skill.match(/\b(cat|jq|head|grep|sed)\b[^\n]*\b(spill|cache)\b/gi) ?? [];

    expect(invokedVerbs.size, 'expected at least one harvest CLI invocation in a code block').toBeGreaterThan(0);
    expect([...invokedVerbs].sort()).toEqual(['ingest', 'plan-fetch']);
    expect(forbiddenReads, 'expected no cat/jq/head/grep/sed against spill or cache files').toEqual([]);
  });

  it('rule 4: passes only control-value flags drawn from --source --from --to --batch --raw --window --expect --complete', () => {
    const skill = readSkill();
    const codeBlocks = codeBlocksOf(skill);
    const allowedFlags = new Set(['--source', '--from', '--to', '--batch', '--raw', '--window', '--expect', '--complete']);

    const foundFlags = new Set();
    for (const block of codeBlocks) {
      for (const match of block.matchAll(/--[a-zA-Z][a-zA-Z-]*/g)) {
        foundFlags.add(match[0]);
      }
    }

    expect(foundFlags.size, 'expected at least one control-value flag in a code block').toBeGreaterThan(0);
    for (const flag of foundFlags) {
      expect(allowedFlags.has(flag), `unexpected flag outside the approved control-value set: ${flag}`).toBe(true);
    }
  });

  it("rule 5: explicitly forbids opening, quoting, or summarising a spill file's contents (DR-0003 Rule 1)", () => {
    const skill = readSkill();

    const forbidsSpillContentAccess =
      /\b(never|do not|must not|don't)\b[^.\n]*\b(open|quote|summar(?:i[sz]e))\b[^.\n]*\bspill\b/i.test(skill) ||
      /\bspill\b[^.\n]*\b(never|do not|must not|don't)\b[^.\n]*\b(open|quote|summar(?:i[sz]e))\b/i.test(skill);

    expect(forbidsSpillContentAccess, 'expected an explicit prohibition on opening/quoting/summarising spill file content').toBe(true);
  });

  it('rule 6: Gmail message ids are fetch hints only, never keys or data (DR-0003 Rule 2)', () => {
    const skill = readSkill();

    const describesFetchHint =
      /\bmessage id\b[\s\S]{0,150}\bhint\b/i.test(skill) || /\bhint\b[\s\S]{0,150}\bmessage id\b/i.test(skill);
    const forbidsKeyUse = /\bnever\b[\s\S]{0,80}\b(key|keys|data)\b/i.test(skill);

    expect(describesFetchHint, 'expected message ids to be described as fetch hints').toBe(true);
    expect(forbidsKeyUse, 'expected an explicit prohibition on using ids as keys/data').toBe(true);
  });

  it('rule 7: stages each window\'s newly spilled files, by path, into a fresh per-window directory passed as --raw (DR-0007)', () => {
    const skill = readSkill();

    const mentionsSpillFilePattern = /mcp-[^\n]{0,30}get_message[^\n]{0,10}\.txt/i.test(skill);
    const mentionsMove = /\b(move|moves|moving)\b/i.test(skill);
    const mentionsFreshPerWindowDirectory = /\b(fresh|new|per-window|separate|its own)\b[^.\n]*\bdirectory\b/i.test(skill);
    const mentionsRawFlag = /--raw\b/.test(skill);

    expect(mentionsSpillFilePattern, 'expected the mcp-*-get_message-*.txt spill filename pattern').toBe(true);
    expect(mentionsMove, 'expected an instruction to move spilled files').toBe(true);
    expect(mentionsFreshPerWindowDirectory, 'expected a fresh per-window staging directory').toBe(true);
    expect(mentionsRawFlag, 'expected the staged directory to be passed as --raw').toBe(true);
  });

  it('rule 8: Gmail queries use after:/before: Unix-second UTC-midnight bounds, never YYYY/MM/DD dates', () => {
    const skill = readSkill();

    const mentionsAfterBefore = /\bafter:/i.test(skill) && /\bbefore:/i.test(skill);
    const mentionsUtcMidnight = /\bUTC\b[^.\n]*\bmidnight\b/i.test(skill) || /\bmidnight\b[^.\n]*\bUTC\b/i.test(skill);
    const mentionsUnixSeconds = /\b(unix|epoch)\b[^.\n]*\bsecond/i.test(skill);
    const forbidsLocalDateFormat =
      /\b(never|not|don't|do not)\b[^.\n]{0,80}(YYYY\/MM\/DD|local day)/i.test(skill) ||
      /(YYYY\/MM\/DD|local day)[^.\n]{0,80}\b(never|not|don't|do not)\b/i.test(skill);

    expect(mentionsAfterBefore, 'expected after:/before: query bounds').toBe(true);
    expect(mentionsUtcMidnight, 'expected UTC-midnight bound derivation').toBe(true);
    expect(mentionsUnixSeconds, 'expected Unix/epoch second units').toBe(true);
    expect(forbidsLocalDateFormat, 'expected an explicit prohibition on YYYY/MM/DD local-day dates').toBe(true);
  });

  it('rule 9: fetches messages with messageFormat: FULL_CONTENT so they spill to disk', () => {
    const skill = readSkill();

    expect(/messageFormat/.test(skill), 'expected a messageFormat instruction').toBe(true);
    expect(/FULL_CONTENT/.test(skill), 'expected messageFormat: FULL_CONTENT').toBe(true);
  });

  it('rule 10: stops the window without --complete and reports when a fetch returns inline instead of a saved path (DR-0007 Exceptions)', () => {
    const skill = readSkill();

    const mentionsInline = /\binline\b/i.test(skill);
    const forbidsTranscription = /\b(not|never|must not|don't)\b[^.\n]*\btranscri/i.test(skill);
    const mentionsStop = /\bstop\b/i.test(skill);
    const mentionsWithholdComplete = /without\s+--complete/i.test(skill) || /--complete\b[^.\n]*\b(not|never)\b/i.test(skill);
    const mentionsReport = /\breport\b/i.test(skill);

    expect(mentionsInline, 'expected the inline-result case to be named').toBe(true);
    expect(forbidsTranscription, 'expected a prohibition on transcribing an inline result').toBe(true);
    expect(mentionsStop, 'expected an instruction to stop the window').toBe(true);
    expect(mentionsWithholdComplete, 'expected --complete to be withheld on an inline result').toBe(true);
    expect(mentionsReport, 'expected an instruction to report the stop').toBe(true);
  });

  it('rule 11: passes --complete only when every search page is exhausted and every message fetched, with --expect equal to the fetched count', () => {
    const skill = readSkill();

    const mentionsCompleteFlag = /--complete\b/.test(skill);
    const mentionsExpectFlag = /--expect\b/.test(skill);
    const mentionsPageExhaustion = /\b(exhaust|every page|all pages)\b/i.test(skill);
    const mentionsExpectEqualsFetched = /--expect[^.\n]*\b(equal|number of messages fetched)\b/i.test(skill) || /number of messages fetched/i.test(skill);

    expect(mentionsCompleteFlag, 'expected the --complete flag to be discussed').toBe(true);
    expect(mentionsExpectFlag, 'expected the --expect flag to be discussed').toBe(true);
    expect(mentionsPageExhaustion, 'expected a page-exhaustion condition for --complete').toBe(true);
    expect(mentionsExpectEqualsFetched, 'expected --expect to be tied to the fetched count').toBe(true);
  });

  it('rule 12: delegates field extraction to the CLI and contains no record-field placeholders or extraction instructions', () => {
    const skill = readSkill();

    const delegatesExtractionToCli = /\b(no parsing|no domain knowledge|stays in the (cli|core)|lives in the (cli|core))\b/i.test(skill);
    const placeholderPattern =
      /\{\{\s*(subject|snippet|sender|plaintextBody|salary|company|title)\s*\}\}|<plaintextBody>|\$\{\s*(subject|snippet|sender|plaintextBody|salary|company|title)\s*\}/i;
    const extractionInstruction = /\bextract\b[^.\n]*\b(job|jobs|company|companies|salary|salaries|title|titles)\b/i;

    expect(delegatesExtractionToCli, 'expected an explicit statement that field extraction stays in the CLI/core').toBe(true);
    expect(placeholderPattern.test(skill), 'expected no message-field template placeholders').toBe(false);
    expect(extractionInstruction.test(skill), 'expected no instruction to extract jobs/companies/salaries/titles').toBe(false);
  });

  it('rule 13: ingest --window is exactly the window plan-fetch printed, never the requested range', () => {
    const skill = readSkill();
    const codeBlocks = codeBlocksOf(skill);

    // The requested-range placeholder is whatever --from/--to spell in the
    // plan-fetch invocation, joined the same way --window joins a range. If
    // the ingest command's --window token is built from those same two
    // tokens, the skill is passing the *requested* range — not the window
    // plan-fetch actually returned — which is the bug: with --complete it
    // commits coverage for days plan-fetch never offered, let alone fetched.
    const planFetchBlock = codeBlocks.find((block) => /\bplan-fetch\b/.test(block) && /--from\b/.test(block));
    const fromPlaceholder = planFetchBlock && /--from\s+(\S+)/.exec(planFetchBlock)?.[1];
    const toPlaceholder = planFetchBlock && /--to\s+(\S+)/.exec(planFetchBlock)?.[1];
    const requestedRangePlaceholder = fromPlaceholder && toPlaceholder ? `${fromPlaceholder}..${toPlaceholder}` : undefined;

    const ingestBlock = codeBlocks.find((block) => /\bingest\b/.test(block) && /--window\b/.test(block));
    const ingestWindowPlaceholder = ingestBlock && /--window\s+(\S+)/.exec(ingestBlock)?.[1];

    const mentionsTiedToPlanFetch =
      /--window\b[^.\n]*\bplan-fetch\b[^.\n]*\b(returned|printed|reported|offered)\b/i.test(skill) ||
      /\bplan-fetch\b[^.\n]*\b(returned|printed|reported|offered)\b[^.\n]*--window\b/i.test(skill);

    expect(fromPlaceholder && toPlaceholder, 'expected a plan-fetch command line with --from and --to placeholders').toBeTruthy();
    expect(ingestWindowPlaceholder, 'expected an ingest command line with a --window flag').toBeTruthy();
    expect(
      ingestWindowPlaceholder,
      '--window must not reuse the requested-range placeholder — it must be the window plan-fetch returned',
    ).not.toBe(requestedRangePlaceholder);
    expect(mentionsTiedToPlanFetch, 'expected the prose to state that ingest --window is the window plan-fetch returned').toBe(true);
  });
});
