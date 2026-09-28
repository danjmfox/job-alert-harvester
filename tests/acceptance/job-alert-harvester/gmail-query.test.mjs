// @contract-shape:pure-function
// The window-to-query mapping the Gmail adapter needs, and which the interim
// skill currently has the agent compute in shell per window. Epoch seconds at
// UTC midnight, never local YYYY/MM/DD: Gmail's date operators are interpreted
// in the account's timezone, while the cache windows by the UTC day of each
// message (DR-0002), so a local-date query silently shifts the boundary.
import { describe, it, expect } from 'vitest';
import { gmailWindowQuery } from '../../../src/core/gmail-query.mjs';

const SENDER = 'jobalerts-noreply@linkedin.com';

describe('gmailWindowQuery — a UTC day window as a Gmail query', () => {
  it('bounds a single-day window at UTC midnight either side', () => {
    // Verified against the live connector: this window returned exactly the
    // two messages dated 2026-09-14 and nothing from the adjacent days.
    expect(gmailWindowQuery({ from: '2026-09-14', to: '2026-09-14' }, { sender: SENDER })).toBe(
      `from:${SENDER} after:1789344000 before:1789430400`,
    );
  });

  it('ends a multi-day window at midnight of the day after `to`, so `to` is included', () => {
    const query = gmailWindowQuery({ from: '2026-09-14', to: '2026-09-16' }, { sender: SENDER });
    expect(query).toBe(`from:${SENDER} after:1789344000 before:1789603200`);
  });

  it('crosses a month boundary', () => {
    const query = gmailWindowQuery({ from: '2026-09-30', to: '2026-09-30' }, { sender: SENDER });
    expect(query).toBe(`from:${SENDER} after:1790726400 before:1790812800`);
  });

  it('crosses a year boundary', () => {
    const query = gmailWindowQuery({ from: '2026-12-31', to: '2026-12-31' }, { sender: SENDER });
    expect(query).toBe(`from:${SENDER} after:1798675200 before:1798761600`);
  });

  it('is pure — the same window yields the identical query every time', () => {
    const window = { from: '2026-09-14', to: '2026-09-14' };
    expect(gmailWindowQuery(window, { sender: SENDER })).toBe(gmailWindowQuery(window, { sender: SENDER }));
  });

  it('@error refuses a window whose dates are not ISO calendar days', () => {
    expect(() => gmailWindowQuery({ from: '2026/09/14', to: '2026-09-14' }, { sender: SENDER })).toThrowError(
      /2026\/09\/14/,
    );
  });

  it('@error refuses a window whose `to` precedes its `from`', () => {
    expect(() => gmailWindowQuery({ from: '2026-09-16', to: '2026-09-14' }, { sender: SENDER })).toThrowError(
      /2026-09-16/,
    );
  });

  it('@error refuses without a sender, rather than querying the whole mailbox', () => {
    expect(() => gmailWindowQuery({ from: '2026-09-14', to: '2026-09-14' }, {})).toThrowError(/sender/);
  });
});
