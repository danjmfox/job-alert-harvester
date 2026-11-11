// @contract-shape:unbounded-preservation
// welcome-to-the-jungle-source, slice 01a (US-01a, AC-2) and the guardrail of slices 01b and 05: a LinkedIn-only
// folder builds cell for cell the workbook it built before the build was routed through the source registry
// (DR-0023). The expectation in support/linkedin-baseline.json was captured from the code as it stood before
// slice 01a, with every cell of every tab. No existing test pins this: walking-skeleton.test.mjs asserts selected
// fields and merge-every-tab.test.mjs plans merges over invented rows, neither builds fixtures/linkedin-variants.
// Subprocess acceptance layer (real CLI, real filesystem): example-only (Mandate 9), universe is the workbook.
// This is a preservation guard: it passes before the change and must keep passing, so it is GREEN by design.
import { afterEach, describe, expect, it } from 'vitest';
import { aFolderHolding, cleanUpFolders, LINKEDIN_BASELINE, LINKEDIN_FIXTURES_DIR, LINKEDIN_VARIANT_FIXTURES_DIR, rebuild } from './support/wttj-fixtures.mjs';
import { assertStateDelta } from '../../common/state-delta.mjs';

afterEach(cleanUpFolders);

const BASELINE_FOLDERS = [
  { name: 'fixtures/linkedin', directory: LINKEDIN_FIXTURES_DIR, jobCount: 14 },
  { name: 'fixtures/linkedin-variants', directory: LINKEDIN_VARIANT_FIXTURES_DIR, jobCount: 29 },
];

describe('@driving_port LinkedIn rows are untouched by the new routing (US-01a, guardrail KPI 3)', () => {
  it.each(BASELINE_FOLDERS)('a folder holding only $name builds every cell of every tab as it did before the routing', ({ name, directory, jobCount }) => {
    // Given a folder holding only the LinkedIn fixtures
    const folder = aFolderHolding({ folders: [directory] });
    const expected = LINKEDIN_BASELINE[name];
    expect(expected.grids.Jobs.length - 1, 'the pinned expectation holds the jobs of this folder').toBe(jobCount);

    // When Dan builds a workbook from the folder
    const built = rebuild(folder);

    // Then the build succeeds, and the tabs, their order, their columns and every cell are what they were
    expect(built.status, built.stderr).toBe(0);
    const before = { 'workbook.tabs': expected.sheetNames, ...Object.fromEntries(Object.entries(expected.grids).map(([tab, grid]) => [`tab.${tab}`, grid])) };
    const after = { 'workbook.tabs': built.grids.sheetNames, ...Object.fromEntries(Object.entries(built.grids.grids).map(([tab, grid]) => [`tab.${tab}`, grid])) };
    assertStateDelta(before, after, { universe: Object.keys(before) });
  });
});
