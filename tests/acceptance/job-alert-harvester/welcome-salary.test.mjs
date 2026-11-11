// @contract-shape:bounded-change
// welcome-to-the-jungle-source, slice 05 (US-05, DDD-14, OQ-03): a stated sterling salary fills the annual salary
// columns of the Jobs tab; every other form (another currency, `Salary above your minimum`, nothing) leaves them
// blank and the row still exists. Salary text never changes Job, Company or the dedup key, and the location is
// kept whether or not a salary is stated. Subprocess acceptance layer for the scenarios (example-only, Mandate 9);
// the figures are generalised as properties on the pure driving port, harvest().
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { harvest } from '../../../src/core/harvest.mjs';
import { holds } from '../gmail-api-source/support/property.mjs';
import { UK_REMOTE, WELCOME_LABEL, WelcomeAlert, aFolderHolding, cleanUpFolders, rebuild, welcomeAlertRecord } from './support/wttj-fixtures.mjs';

afterEach(cleanUpFolders);

const MIN_ANNUAL = 'Min Salary (annual)';
const MAX_ANNUAL = 'Max Salary (annual)';
const PAY_CELLS = [MIN_ANNUAL, MAX_ANNUAL, 'Min Salary (hourly)', 'Day Rate'];
const payOf = (row) => Object.fromEntries(PAY_CELLS.map((column) => [column, row[column]]));
const NO_PAY = Object.freeze({ [MIN_ANNUAL]: null, [MAX_ANNUAL]: null, 'Min Salary (hourly)': null, 'Day Rate': null });
const annual = (min, max) => ({ ...NO_PAY, [MIN_ANNUAL]: min, [MAX_ANNUAL]: max });

const rowsOfAlerts = (...alerts) => {
  const built = rebuild(aFolderHolding({ alerts }));
  expect(built.status, built.stderr).toBe(0);
  return built.tabs.Jobs;
};

describe('@driving_port a stated sterling salary fills the annual columns (US-05, AC-1)', () => {
  it.skip('reads a single figure, £118K, as 118000 in both annual cells', () => {
    // Given a card stating £118K
    // When Dan builds a workbook from the folder holding it
    const [row, ...others] = rowsOfAlerts(WelcomeAlert.SALARY_STERLING_SINGLE);

    // Then both annual cells read 118000, and nothing else about pay is filled in
    expect(others).toEqual([]);
    expect(payOf(row)).toEqual(annual(118000, 118000));
  });

  it.skip('reads a range, £90-110K, as 90000 and 110000', () => {
    // Given a card stating £90-110K
    // When Dan builds a workbook from the folder holding it
    const [row, ...others] = rowsOfAlerts(WelcomeAlert.SALARY_STERLING_RANGE);

    // Then the annual cells read 90000 and 110000
    expect(others).toEqual([]);
    expect(payOf(row)).toEqual(annual(90000, 110000));
  });
});

describe('@driving_port any other form leaves the annual cells blank and keeps the row (US-05, AC-2)', () => {
  it.skip('@error does not guess another currency: $229-258K and €100-110K give two rows with blank annual cells', () => {
    // Given cards stating $229-258K and €100-110K
    // When Dan builds a workbook from the folder holding both
    const rows = rowsOfAlerts(WelcomeAlert.SALARY_DOLLAR_RANGE, WelcomeAlert.SALARY_EURO_RANGE);

    // Then both rows exist and every pay cell is blank
    expect(rows.map((row) => row.Company).sort()).toEqual(['Lucerne Robotics', 'Tailspin Mobility']);
    expect(rows.map(payOf)).toEqual([NO_PAY, NO_PAY]);
  });

  it.skip('@error leaves the annual cells blank for a card stating nothing and for one stating "Salary above your minimum"', () => {
    // Given a card stating no salary and a card stating "Salary above your minimum"
    // When Dan builds a workbook from the folder holding both
    const rows = rowsOfAlerts(WelcomeAlert.NO_SALARY, WelcomeAlert.SALARY_ABOVE_MINIMUM);

    // Then both rows exist and every pay cell is blank
    expect(rows.map((row) => row.Company).sort()).toEqual(['Proseware Systems', 'Wingtip Software']);
    expect(rows.map(payOf)).toEqual([NO_PAY, NO_PAY]);
  });

  it.skip('@error does not read a number in a title as a salary', () => {
    // Given a card titled "Head of Delivery 2" that states no salary
    // When Dan builds a workbook from the folder holding it
    const [row, ...others] = rowsOfAlerts(WelcomeAlert.TITLE_WITH_NUMBER);

    // Then the title is whole and every pay cell is blank
    expect(others).toEqual([]);
    expect(row.Job).toBe('Head of Delivery 2');
    expect(payOf(row)).toEqual(NO_PAY);
  });
});

describe('@driving_port the salary line is not the location and changes nothing else about the row (US-05, AC-3, AC-4)', () => {
  it.skip('keeps Remote (within the UK) as the location whether or not a salary is stated', () => {
    // Given one card stating £118K and Remote (within the UK), and one card stating only Remote (within the UK)
    // When Dan builds a workbook from the folder holding both
    const rows = rowsOfAlerts(WelcomeAlert.SALARY_STERLING_SINGLE, WelcomeAlert.NO_SALARY);

    // Then both rows show Remote (within the UK) in Location
    expect(rows.map((row) => row.Location)).toEqual([UK_REMOTE, UK_REMOTE]);
  });

  it.skip('gives the same job the same Job, Company and Dedup Key whatever salary a later alert states', () => {
    // Given the Litware Platforms card stating £118K in one alert and £125K in a later one
    const first = rowsOfAlerts(WelcomeAlert.SALARY_STERLING_SINGLE);
    const later = rowsOfAlerts(WelcomeAlert.SALARY_STERLING_SINGLE_LATER);

    // When Dan builds a workbook from the folder holding both alerts
    const together = rowsOfAlerts(WelcomeAlert.SALARY_STERLING_SINGLE, WelcomeAlert.SALARY_STERLING_SINGLE_LATER);

    // Then each alone gives the same Job, Company and key, and together they are one job seen twice
    const identity = ({ Job, Company, 'Dedup Key': key }) => ({ Job, Company, key });
    expect(identity(later[0])).toEqual(identity(first[0]));
    expect(together).toHaveLength(1);
    expect(identity(together[0])).toEqual(identity(first[0]));
    expect(together[0]['Times Seen']).toBe(2);
  });
});

describe('@property sterling figures are read exactly and no other pay text is read as a figure (US-05, DDD-14)', () => {
  const sterlingSingle = welcomeAlertRecord(WelcomeAlert.SALARY_STERLING_SINGLE);
  const sterlingRange = welcomeAlertRecord(WelcomeAlert.SALARY_STERLING_RANGE);
  const dollarRange = welcomeAlertRecord(WelcomeAlert.SALARY_DOLLAR_RANGE);
  const thousands = fc.integer({ min: 1, max: 999 });
  const orderedPair = fc.tuple(thousands, thousands).map(([a, b]) => (a <= b ? [a, b] : [b, a]));

  const withSalaryText = (record, current, replacement) => {
    expect(record.htmlBody.split(current), `${current} appears once in the alert`).toHaveLength(2);
    return { ...record, htmlBody: record.htmlBody.replace(current, () => replacement) };
  };
  const onlyRowOf = (record) => {
    const { rows } = harvest([record]).jobs;
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  it.skip('@property any single sterling figure of whole thousands fills both annual cells with it', () => {
    holds(
      fc.property(thousands, (amount) => {
        // Given the single-figure card rewritten to state any £NNNK
        // When the build model is derived
        const row = onlyRowOf(withSalaryText(sterlingSingle, '£118K', `£${amount}K`));

        // Then both annual cells read that figure and the location is still read
        expect(payOf(row)).toEqual(annual(amount * 1000, amount * 1000));
        expect(row.Location).toBe(UK_REMOTE);
      }),
    );
  });

  it.skip('@property any sterling range of whole thousands fills the annual cells with its ends', () => {
    holds(
      fc.property(orderedPair, ([low, high]) => {
        // Given the range card rewritten to state any £NNN-NNNK
        // When the build model is derived
        const row = onlyRowOf(withSalaryText(sterlingRange, '£90-110K', `£${low}-${high}K`));

        // Then the annual cells read its two ends and the location is still read
        expect(payOf(row)).toEqual(annual(low * 1000, high * 1000));
        expect(row.Location).toBe(UK_REMOTE);
      }),
    );
  });

  it.skip('@property @error any dollar or euro range leaves every pay cell blank and the row, its title and its location intact', () => {
    holds(
      fc.property(fc.constantFrom('$', '€'), orderedPair, (currency, [low, high]) => {
        // Given the dollar card rewritten to state any dollar or euro range
        // When the build model is derived
        const row = onlyRowOf(withSalaryText(dollarRange, '$229-258K', `${currency}${low}-${high}K`));

        // Then the row exists with its title and location, and every pay cell is blank
        expect(payOf(row)).toEqual(NO_PAY);
        expect(row).toMatchObject({ Company: 'Lucerne Robotics', Job: 'Head of Engineering', Location: UK_REMOTE, Source: WELCOME_LABEL });
      }),
    );
  });
});
