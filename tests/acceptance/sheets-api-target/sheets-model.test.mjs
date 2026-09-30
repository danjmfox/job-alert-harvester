// @contract-shape:pure-function
// The response anti-corruption layer (DESIGN Q1, Q3, Q4): the only code that knows the Sheets JSON shape. It turns
// spreadsheets.get, values:batchGet and developerMetadata:search bodies into the SheetState merge.mjs already reads,
// and into a Resolution: where every planned row and column is right now. The key column is the truth; row-key
// metadata is a second locator, and a disagreement between them refuses the whole apply (OQ-3).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encodeRowKey, parseMetadata, parseSpreadsheet, parseValueRanges, resolveTabs, rowKeyOf, toSheetState } from '../../../src/core/sheets-model.mjs';
import { COMPANIES_COLUMNS, JOBS_COLUMNS, SOURCES_COLUMNS, SPREADSHEET_ID, SheetsRefusal, aMetadataBody, aSpreadsheetBody, aValueRangesBody, refusalOf } from './support/sheets-domain-types.mjs';
import { holds } from './support/property.mjs';

const refusalDetail = (action) => {
  try {
    action();
  } catch (error) {
    return { code: error.code, message: error.message };
  }
  return null;
};

describe('reading spreadsheets.get', () => {
  it('yields the recorded id and every tab with its id, title and grid size', () => {
    const body = aSpreadsheetBody({ tabs: [{ sheetId: 1, title: 'Jobs', rowCount: 1200, columnCount: 30 }, { sheetId: 7, title: 'Notes' }] });

    expect(parseSpreadsheet(body, { expectedId: SPREADSHEET_ID })).toEqual({
      spreadsheetId: SPREADSHEET_ID,
      tabs: [{ sheetId: 1, title: 'Jobs', rowCount: 1200, columnCount: 30 }, { sheetId: 7, title: 'Notes', rowCount: 1000, columnCount: 26 }],
    });
  });

  it('@error refuses sheets.id-mismatch when the Sheet answering is not the recorded one', () => {
    expect(refusalOf(() => parseSpreadsheet(aSpreadsheetBody({ id: 'some-other-sheet' }), { expectedId: SPREADSHEET_ID }))).toBe(SheetsRefusal.ID_MISMATCH);
  });

  const NOT_A_SHEET = [
    ['null', null],
    ['an array', []],
    ['an empty object', {}],
    ['text', '<html>Service Unavailable</html>'],
    ['no tab list', { spreadsheetId: SPREADSHEET_ID }],
    ['a tab with no properties', { spreadsheetId: SPREADSHEET_ID, sheets: [{}] }],
    ['a tab with no id', { spreadsheetId: SPREADSHEET_ID, sheets: [{ properties: { title: 'Jobs' } }] }],
    ['a tab with no title', { spreadsheetId: SPREADSHEET_ID, sheets: [{ properties: { sheetId: 1 } }] }],
  ];
  for (const [title, body] of NOT_A_SHEET) {
    it(`@error refuses sheets.response-malformed when a 200 answer is ${title}`, () => {
      expect(refusalOf(() => parseSpreadsheet(body, { expectedId: SPREADSHEET_ID }))).toBe(SheetsRefusal.RESPONSE_MALFORMED);
    });
  }
});

describe('reading values:batchGet', () => {
  it('yields one grid per requested tab, in order, and an empty grid for a range that answers with no values', () => {
    const body = aValueRangesBody({ Jobs: [['Dedup Key'], ['linkedin:1']], Companies: [] });

    expect(parseValueRanges(body, ['Jobs', 'Companies'])).toEqual({ Jobs: [['Dedup Key'], ['linkedin:1']], Companies: [] });
  });

  const MALFORMED = [
    ['no valueRanges', { spreadsheetId: SPREADSHEET_ID }],
    ['fewer ranges than tabs asked for', aValueRangesBody({ Jobs: [['Dedup Key']] })],
    ['a range whose values are not rows', { valueRanges: [{ range: 'Jobs', values: 'x' }, { range: 'Companies' }] }],
    ['null', null],
  ];
  for (const [title, body] of MALFORMED) {
    it(`@error refuses sheets.response-malformed when the answer has ${title}`, () => {
      expect(refusalOf(() => parseValueRanges(body, ['Jobs', 'Companies']))).toBe(SheetsRefusal.RESPONSE_MALFORMED);
    });
  }
});

describe('a grid becomes the SheetState the merge already reads (A1)', () => {
  it('row 1 is the header, and a blank cell reads as null, a short row is padded, and typed values survive', () => {
    const state = toSheetState({ Jobs: [['Dedup Key', 'Job', 'Fit Score', 'Applied?'], ['linkedin:1', '', 0, false], ['linkedin:2', 'Coach', 5]] });

    expect(state).toEqual({
      tabs: {
        Jobs: {
          columns: ['Dedup Key', 'Job', 'Fit Score', 'Applied?'],
          rows: [
            { 'Dedup Key': 'linkedin:1', Job: null, 'Fit Score': 0, 'Applied?': false },
            { 'Dedup Key': 'linkedin:2', Job: 'Coach', 'Fit Score': 5, 'Applied?': null },
          ],
        },
      },
    });
  });

  it('a blank interior row is kept, so rows[i] is always sheet row i+2', () => {
    const state = toSheetState({ Jobs: [['Dedup Key', 'Job'], ['linkedin:1', 'a'], [], ['linkedin:3', 'c']] });

    expect(state.tabs.Jobs.rows).toEqual([
      { 'Dedup Key': 'linkedin:1', Job: 'a' },
      { 'Dedup Key': null, Job: null },
      { 'Dedup Key': 'linkedin:3', Job: 'c' },
    ]);
  });

  it('an empty tab has no columns and no rows', () => {
    expect(toSheetState({ Companies: [] })).toEqual({ tabs: { Companies: { columns: [], rows: [] } } });
  });

  it('@property every data row is kept in place with its typed values, whatever the header and the blanks', () => {
    const cell = fc.oneof(fc.constant(''), fc.stringMatching(/^[A-Za-z0-9]{1,6}$/), fc.integer(), fc.boolean());
    const grids = fc.uniqueArray(fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,8}$/), { minLength: 1, maxLength: 5 }).chain((header) =>
      fc.array(fc.array(cell, { maxLength: header.length }), { minLength: 1, maxLength: 6 }).map((rows) => ({ header, rows: [...rows, header.map(() => 'last')] })),
    );
    holds(
      fc.property(grids, ({ header, rows }) => {
        const state = toSheetState({ Jobs: [header, ...rows] });
        expect(state.tabs.Jobs.columns).toEqual(header);
        expect(state.tabs.Jobs.rows).toHaveLength(rows.length);
        rows.forEach((row, index) => header.forEach((name, column) => expect(state.tabs.Jobs.rows[index][name]).toEqual(row[column] === '' || row[column] === undefined ? null : row[column])));
      }),
    );
  });
});

describe('reading developerMetadata:search', () => {
  it('yields each row-key metadata with its row and tab, and nothing when none matched', () => {
    const body = aMetadataBody([{ metadataId: 11, key: 'linkedin:1', sheetId: 1, rowIndex: 1 }, { metadataId: 12, key: '["LinkedIn","coach"]', sheetId: 3, rowIndex: 4 }]);

    expect(parseMetadata(body)).toEqual([
      { metadataId: 11, key: 'harvester.row-key', value: 'linkedin:1', sheetId: 1, rowIndex: 1 },
      { metadataId: 12, key: 'harvester.row-key', value: '["LinkedIn","coach"]', sheetId: 3, rowIndex: 4 },
    ]);
    expect(parseMetadata({})).toEqual([]);
  });

  it('@error refuses sheets.response-malformed for an answer that is not an object, or a match with no location', () => {
    expect(refusalOf(() => parseMetadata(null))).toBe(SheetsRefusal.RESPONSE_MALFORMED);
    expect(refusalOf(() => parseMetadata({ matchedDeveloperMetadata: [{ developerMetadata: { metadataId: 1, metadataKey: 'harvester.row-key', metadataValue: 'x' } }] }))).toBe(SheetsRefusal.RESPONSE_MALFORMED);
  });
});

describe('a row key is one value, or an ordered JSON array of several, never a joined string (DR-0010)', () => {
  it('one key value is its own text and several are a JSON array', () => {
    expect(encodeRowKey(['linkedin:1'])).toBe('linkedin:1');
    expect(encodeRowKey(['LinkedIn', 'agile coach'])).toBe('["LinkedIn","agile coach"]');
  });

  it('@property two different composite keys never share an encoding, however the words are cut', () => {
    holds(
      fc.property(fc.array(fc.string(), { minLength: 2, maxLength: 3 }), fc.array(fc.string(), { minLength: 2, maxLength: 3 }), (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(encodeRowKey(a)).not.toBe(encodeRowKey(b));
      }),
    );
  });

  it('@error a row with any blank key column has no key, so it is never matched and never given metadata', () => {
    expect(rowKeyOf(['Source', 'Search Term'], { Source: 'LinkedIn', 'Search Term': 'coach' })).toBe('["LinkedIn","coach"]');
    for (const blank of [null, '', undefined]) expect(rowKeyOf(['Source', 'Search Term'], { Source: 'LinkedIn', 'Search Term': blank })).toBeNull();
    expect(rowKeyOf(['Dedup Key'], { 'Dedup Key': null })).toBeNull();
  });
});

describe('resolution: where every row and column is now (Q3, Q4)', () => {
  const tab = (title, sheetId, extra = {}) => ({ sheetId, title, rowCount: 1000, columnCount: 26, ...extra });
  const bound = (entries) => entries.map(([key, rowIndex, sheetId = 1], index) => ({ metadataId: 100 + index, key: 'harvester.row-key', value: key, sheetId, rowIndex }));
  const jobsGrid = (header, rows) => ({ Jobs: [header, ...rows] });
  const HEADER = ['Dedup Key', 'Job', 'Status', 'My Notes'];

  it('locates every column by its header text, wherever a human has put it', () => {
    holds(
      fc.property(fc.shuffledSubarray(['Job', 'Status', 'My Notes', 'Fit Score', 'Company'], { minLength: 1 }), fc.nat(5), (others, at) => {
        const header = [...others];
        header.splice(at % (header.length + 1), 0, 'Dedup Key');
        const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1)], grids: jobsGrid(header, [header.map((name) => (name === 'Dedup Key' ? 'linkedin:1' : 'x'))]), metadata: bound([['linkedin:1', 1]]) });
        header.forEach((name, position) => expect(tabs.Jobs.columnIndex[name]).toBe(position));
        expect(tabs.Jobs.headerWidth).toBe(header.length);
      }),
    );
  });

  it('locates every keyed row by its position in the key column, skipping blank rows and rows a human added with no key', () => {
    const grids = jobsGrid(HEADER, [['linkedin:1', 'a'], [], ['', 'hand-added lead', 'Applied'], ['linkedin:4', 'd']]);

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1)], grids, metadata: bound([['linkedin:1', 1], ['linkedin:4', 4]]) });

    expect(tabs.Jobs.rowIndexByKey).toEqual({ 'linkedin:1': 1, 'linkedin:4': 4 });
    expect(tabs.Jobs.rowsByKey['linkedin:4']).toMatchObject({ 'Dedup Key': 'linkedin:4', Job: 'd', Status: null });
    expect(tabs.Jobs).toMatchObject({ sheetId: 1, rowCount: 1000, columnCount: 26, headerWidth: 4 });
  });

  it('a keyed row with no metadata is reported unbound, in row order, and a bound row is not', () => {
    const grids = jobsGrid(HEADER, [['linkedin:1', 'a'], ['linkedin:2', 'b'], ['linkedin:3', 'c']]);

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1)], grids, metadata: bound([['linkedin:2', 2]]) });

    expect(tabs.Jobs.unboundKeys).toEqual(['linkedin:1', 'linkedin:3']);
  });

  it('@property when metadata agrees with the key column for every row, nothing refuses and nothing is unbound', () => {
    holds(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 8 }), (ids) => {
        const grids = jobsGrid(HEADER, ids.map((id) => [`linkedin:${id}`, 'x']));
        const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1)], grids, metadata: bound(ids.map((id, index) => [`linkedin:${id}`, index + 1])) });
        expect(tabs.Jobs.unboundKeys).toEqual([]);
        ids.forEach((id, index) => expect(tabs.Jobs.rowIndexByKey[`linkedin:${id}`]).toBe(index + 1));
      }),
    );
  });

  it('@error refuses sheets.duplicate-key, naming the key, when one key stands on two rows', () => {
    const grids = jobsGrid(HEADER, [['linkedin:1', 'a'], ['linkedin:2', 'b'], ['linkedin:2', 'copy']]);

    const refusal = refusalDetail(() => resolveTabs({ tabs: [tab('Jobs', 1)], grids, metadata: [] }));

    expect(refusal.code).toBe(SheetsRefusal.DUPLICATE_KEY);
    expect(refusal.message).toContain('linkedin:2');
  });

  it('@error refuses sheets.row-identity-conflict, naming the key, when its metadata sits on a different row', () => {
    const grids = jobsGrid(HEADER, [['linkedin:2', 'swapped by a person'], ['linkedin:1', 'swapped by a person']]);

    const refusal = refusalDetail(() => resolveTabs({ tabs: [tab('Jobs', 1)], grids, metadata: bound([['linkedin:1', 1], ['linkedin:2', 2]]) }));

    expect(refusal.code).toBe(SheetsRefusal.ROW_IDENTITY_CONFLICT);
    expect(refusal.message).toMatch(/linkedin:[12]/);
  });

  it('metadata for a key that no longer stands in the key column is ignored: there is nothing to write there', () => {
    const grids = jobsGrid(HEADER, [['linkedin:1', 'a']]);

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1)], grids, metadata: bound([['linkedin:1', 1], ['linkedin:9', 7]]) });

    expect(tabs.Jobs.rowIndexByKey).toEqual({ 'linkedin:1': 1 });
  });

  it('the same first key column on two tabs never mixes: metadata is read per tab', () => {
    const grids = { Jobs: [HEADER, ['linkedin:1', 'a']], Companies: [COMPANIES_COLUMNS, ['Acme'], ['Beta'], ['linkedin:1', 'recruiter']] };

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1), tab('Companies', 2)], grids, metadata: bound([['linkedin:1', 1, 1]]) });

    expect(tabs.Companies.rowIndexByKey['linkedin:1']).toBe(3);
    expect(tabs.Companies.unboundKeys).toContain('linkedin:1');
  });

  const MISSING_KEY = [
    ['Jobs without Dedup Key', 'Jobs', ['Job', 'Status'], [['a', 'b']]],
    ['Companies without Company', 'Companies', ['Source Type', 'Jobs Seen'], [['recruiter', 2]]],
    ['Sources without Search Term', 'Sources', ['Source', 'Sender'], [['LinkedIn', 'a@b.c']]],
    ['Sources without Source', 'Sources', ['Search Term', 'Sender'], [['coach', 'a@b.c']]],
  ];
  for (const [title, name, header, rows] of MISSING_KEY) {
    it(`@error refuses sheets.key-column-missing for ${title} that holds data rows, naming the tab`, () => {
      const others = name === 'Jobs' ? [] : [tab('Jobs', 1)];
      const grids = { ...(name === 'Jobs' ? {} : { Jobs: [HEADER, ['linkedin:1', 'a']] }), [name]: [header, ...rows] };

      const refusal = refusalDetail(() => resolveTabs({ tabs: [...others, tab(name, 2)], grids, metadata: [] }));

      expect(refusal.code).toBe(SheetsRefusal.KEY_COLUMN_MISSING);
      expect(refusal.message).toContain(name);
    });
  }

  it('@error refuses sheets.key-column-missing for a Jobs tab with no header, or a header without Dedup Key, even with no data rows (human-approved)', () => {
    for (const grid of [[], [['Job', 'Status']]]) {
      const refusal = refusalDetail(() => resolveTabs({ tabs: [tab('Jobs', 1)], grids: { Jobs: grid }, metadata: [] }));

      expect(refusal.code).toBe(SheetsRefusal.KEY_COLUMN_MISSING);
      expect(refusal.message).toContain('Jobs');
    }
  });

  it('a tab with no data rows resolves without its key column, and an empty tab with no header resolves as new', () => {
    const grids = { Jobs: [HEADER, ['linkedin:1', 'a']], Companies: [['Jobs Seen']], Sources: [] };

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1), tab('Companies', 2), tab('Sources', 3)], grids, metadata: bound([['linkedin:1', 1]]) });

    expect(tabs.Companies.rowIndexByKey).toEqual({});
    expect(tabs.Sources).toMatchObject({ columnIndex: {}, rowIndexByKey: {}, headerWidth: 0 });
  });

  it('@error refuses sheets.duplicate-header when a key column or a harvester-owned column is named twice', () => {
    for (const header of [['Dedup Key', 'Job', 'Dedup Key'], ['Dedup Key', 'Job', 'Job'], ['Dedup Key', 'Fit Score', 'Fit Score']]) {
      expect(refusalOf(() => resolveTabs({ tabs: [tab('Jobs', 1)], grids: jobsGrid(header, [['linkedin:1', 'a', 'b']]), metadata: [] }))).toBe(SheetsRefusal.DUPLICATE_HEADER);
    }
  });

  it('a human-owned or unknown column named twice is not ambiguous for the harvester, so it is left alone', () => {
    const header = ['Dedup Key', 'Status', 'Status', 'My Notes', 'My Notes'];

    expect(refusalOf(() => resolveTabs({ tabs: [tab('Jobs', 1)], grids: jobsGrid(header, [['linkedin:1', 'a', 'b', 'c', 'd']]), metadata: [] }))).toBeNull();
  });

  it('@error refuses sheets.tab-missing when there is no Jobs tab, but a missing Companies or Sources tab is simply absent from the result', () => {
    expect(refusalOf(() => resolveTabs({ tabs: [tab('Notes', 5)], grids: { Notes: [['x']] }, metadata: [] }))).toBe(SheetsRefusal.TAB_MISSING);

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1), tab('Notes', 5)], grids: { Jobs: [HEADER], Notes: [['anything']] }, metadata: [] });

    expect(Object.keys(tabs)).toEqual(['Jobs']);
  });

  it('the Sources composite key is located as an ordered JSON array, and a blank Search Term is never located', () => {
    const grids = {
      Jobs: [HEADER, ['linkedin:1', 'a']],
      Sources: [SOURCES_COLUMNS, ['LinkedIn', 'agile coach', 'a@b.c'], ['LinkedIn', 'scrum master', 'a@b.c'], ['LinkedIn', '', 'a@b.c']],
    };

    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1), tab('Sources', 3)], grids, metadata: [] });

    expect(tabs.Sources.rowIndexByKey).toEqual({ '["LinkedIn","agile coach"]': 1, '["LinkedIn","scrum master"]': 2 });
    expect(tabs.Sources.unboundKeys).toEqual(['["LinkedIn","agile coach"]', '["LinkedIn","scrum master"]']);
  });

  it('the Jobs header the harvester wrote itself resolves every one of its 26 columns', () => {
    const { tabs } = resolveTabs({ tabs: [tab('Jobs', 1)], grids: jobsGrid(JOBS_COLUMNS, []), metadata: [] });

    expect(Object.keys(tabs.Jobs.columnIndex)).toEqual(JOBS_COLUMNS);
  });
});
