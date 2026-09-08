// @contract-shape:pure-function
// DR-0004, DR-0005 — every column has exactly one owner; merge is pure and
// returns a WritePlan rather than writing. Unit layer, table-driven examples.
import { describe, it, expect } from 'vitest';
import { planMerge, KEY_COLUMN, HUMAN_COLUMNS } from '../../../src/core/merge.mjs';
import { aSheetRow, aTrackerContaining, aHarvestOf } from './support/domain-types.mjs';

describe('planMerge (DR-0004, DR-0005) — the merge is a plan, not a write', () => {
  it('harvester-owned columns are always overwritten with the freshly derived value', () => {
    // Given a tracker row for a job the harvester has seen before
    const existing = aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Company: 'OldCo Ltd' });
    const sheetState = aTrackerContaining([existing]);
    // When the harvester derives a new value for a harvester-owned column
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Company: 'NewCo Ltd' })]);
    const plan = planMerge(sheetState, harvestModel);
    // Then the plan overwrites it
    const update = plan.updates.find((u) => u.key === 'linkedin:1');
    expect(update.cells['Company']).toBe('NewCo Ltd');
  });

  it('human-owned columns are never rewritten after row creation', () => {
    // Given a tracker row where the human has already set Status
    const existing = aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Status: 'Applied' });
    const sheetState = aTrackerContaining([existing]);
    // When the harvester re-derives the same job, even carrying a differing Status
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Status: 'REJECTED-BY-HARVESTER' })]);
    const plan = planMerge(sheetState, harvestModel);
    // Then the human-owned cell is never touched by the plan at all
    const update = plan.updates.find((u) => u.key === 'linkedin:1');
    for (const column of HUMAN_COLUMNS) {
      expect(update?.cells ?? {}).not.toHaveProperty(column);
    }
  });

  it('unknown columns are preserved verbatim, in position and value', () => {
    // Given a tracker with a column the harvester does not recognise
    const columns = [...Object.keys(aSheetRow()), 'My Notes'];
    const existing = { ...aSheetRow({ [KEY_COLUMN]: 'linkedin:1' }), 'My Notes': 'call recruiter Tue' };
    const sheetState = aTrackerContaining([existing], { columns });
    // When the harvester merges an update for that same row
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Company: 'NewCo Ltd' })]);
    const plan = planMerge(sheetState, harvestModel);
    // Then the unknown column is never referenced by the plan
    expect(plan.appendColumns).not.toContain('My Notes');
    const update = plan.updates.find((u) => u.key === 'linkedin:1');
    expect(update.cells).not.toHaveProperty('My Notes');
  });

  it('@error never deletes a row — a job absent from this harvest is left completely untouched', () => {
    // Given a tracker row for a job no longer present in the harvest window
    const existing = aSheetRow({ [KEY_COLUMN]: 'linkedin:old-job' });
    const sheetState = aTrackerContaining([existing]);
    // When this harvest run produces nothing
    const harvestModel = aHarvestOf([]);
    const plan = planMerge(sheetState, harvestModel);
    // Then the row is referenced nowhere in the plan — not updated, not removed
    expect(JSON.stringify(plan)).not.toContain('linkedin:old-job');
  });

  it('@error never matches a blank Dedup Key — a hand-added row is a human artefact', () => {
    // Given a hand-added tracker row with no Dedup Key
    const handAdded = { ...aSheetRow({ [KEY_COLUMN]: '' }), Job: 'Hand-added role, no key' };
    const sheetState = aTrackerContaining([handAdded]);
    // When the harvester brings a genuinely new job
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:2', Job: 'Harvested role' })]);
    const plan = planMerge(sheetState, harvestModel);
    // Then the blank-key row is never treated as a merge target
    expect(plan.updates.some((u) => u.key === '')).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('Hand-added role, no key');
    // And the genuinely new job is appended
    expect(plan.appends.some((row) => row[KEY_COLUMN] === 'linkedin:2')).toBe(true);
  });

  it('never reorders columns — new harvester columns are appended, existing order is untouched', () => {
    // Given a tracker missing one harvester-owned column the schema now expects
    const columns = Object.keys(aSheetRow()).filter((c) => c !== 'Fit Reason');
    const existing = { ...aSheetRow({ [KEY_COLUMN]: 'linkedin:1' }) };
    delete existing['Fit Reason'];
    const sheetState = aTrackerContaining([existing], { columns });
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:1' })]);
    // When the plan is computed
    const plan = planMerge(sheetState, harvestModel);
    // Then the missing column is appended, and no existing column moves
    expect(plan.appendColumns).toContain('Fit Reason');
    expect(columns.every((c, i) => sheetState.tabs.Jobs.columns[i] === c)).toBe(true);
  });

  it('a new job absent from the tracker is appended with human-owned columns blank', () => {
    // Given an empty tracker
    const sheetState = aTrackerContaining([]);
    // When the harvester brings one new job
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:9', Job: 'Brand new role' })]);
    const plan = planMerge(sheetState, harvestModel);
    // Then it is appended, and every human-owned column starts blank
    const appended = plan.appends.find((row) => row[KEY_COLUMN] === 'linkedin:9');
    expect(appended).toBeDefined();
    for (const column of HUMAN_COLUMNS) {
      expect(appended[column] == null).toBe(true);
    }
  });

  it('reports derived-cell changes between runs, so a parser fix reaching history is visible', () => {
    // Given a tracker row whose harvester-owned Company was previously derived as "OldCo"
    const existing = aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Company: 'OldCo' });
    const sheetState = aTrackerContaining([existing]);
    // When a parser improvement re-derives it as "NewCo"
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Company: 'NewCo' })]);
    const plan = planMerge(sheetState, harvestModel);
    // Then the change is reported
    expect(plan.changes).toContainEqual({ key: 'linkedin:1', column: 'Company', from: 'OldCo', to: 'NewCo' });
  });

  it('is pure — the same inputs produce the identical plan on repeated calls', () => {
    const sheetState = aTrackerContaining([aSheetRow({ [KEY_COLUMN]: 'linkedin:1' })]);
    const harvestModel = aHarvestOf([aSheetRow({ [KEY_COLUMN]: 'linkedin:1', Company: 'NewCo' })]);
    expect(planMerge(sheetState, harvestModel)).toEqual(planMerge(sheetState, harvestModel));
  });
});
