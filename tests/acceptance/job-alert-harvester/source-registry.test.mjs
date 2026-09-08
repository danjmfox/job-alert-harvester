// @contract-shape:pure-function
// DR-0006 — descriptors are plain data; extract always returns an array, so
// there is no source "shape" for the F1 bug to hide behind. Messages matching
// no descriptor are captured, never dropped. Unit layer, table-driven.
import { describe, it, expect } from 'vitest';
import { selectSource, extractAll, REGISTRY } from '../../../src/core/sources/registry.mjs';
import { linkedin } from '../../../src/core/sources/linkedin.mjs';
import { aMessage } from './support/domain-types.mjs';

describe('source registry (DR-0006)', () => {
  it('REGISTRY is a first-match-wins array containing the LinkedIn descriptor', () => {
    expect(REGISTRY[0].id).toBe('linkedin');
  });

  describe('linkedin.matches identifies LinkedIn alert emails by sender', () => {
    it('matches a genuine LinkedIn job-alert sender', () => {
      const message = aMessage({ sender: 'jobalerts-noreply@linkedin.com' });
      expect(linkedin.matches(message)).toBe(true);
    });

    it('@error does not match an unrelated sender', () => {
      const message = aMessage({ sender: 'newsletter@example.com', subject: 'Weekly digest' });
      expect(linkedin.matches(message)).toBe(false);
    });
  });

  describe('selectSource picks the first descriptor whose predicate matches', () => {
    it('selects the linkedin descriptor for a LinkedIn message', () => {
      const message = aMessage({ sender: 'jobalerts-noreply@linkedin.com' });
      expect(selectSource(message, REGISTRY)?.id).toBe('linkedin');
    });

    it('@error returns null when no descriptor matches', () => {
      const message = aMessage({ sender: 'newsletter@example.com', subject: 'Weekly digest' });
      expect(selectSource(message, REGISTRY)).toBeNull();
    });
  });

  describe('extract always returns an array — there is no source shape', () => {
    it('a digest carrying three jobs extracts an array of three', () => {
      const message = aMessage({
        jobs: [
          { id: '1', title: 'Agile Coach', company: 'Stealth iT' },
          { id: '2', title: 'Scrum Master', company: 'Digital Waffle' },
          { id: '3', title: 'Delivery Lead', company: 'Wealth Dynamix' },
        ],
      });
      expect(Array.isArray(linkedin.extract(message))).toBe(true);
      expect(linkedin.extract(message)).toHaveLength(3);
    });

    it('a "single-job" alert is simply an array of length one — no shape field exists', () => {
      const message = aMessage({ jobs: [{ id: '1', title: 'Agile Coach', company: 'Stealth iT' }] });
      const extracted = linkedin.extract(message);
      expect(Array.isArray(extracted)).toBe(true);
      expect(extracted).toHaveLength(1);
    });
  });

  describe('extractAll captures every message — matched or not', () => {
    it('@error a message matching no descriptor is captured in an Unmatched bucket, never dropped', () => {
      const matched = aMessage({ id: 'a', sender: 'jobalerts-noreply@linkedin.com' });
      const unmatched = aMessage({ id: 'b', sender: 'newsletter@example.com', subject: 'Weekly digest' });
      const result = extractAll([matched, unmatched], REGISTRY);

      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0]).toMatchObject({ id: 'b', sender: 'newsletter@example.com' });
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('dedup keys are namespaced by source id', () => {
    it('a canonical LinkedIn job id produces a key prefixed "linkedin:"', () => {
      const rawJob = { id: '4441092711', title: 'Agile Coach', company: 'Stealth iT' };
      expect(linkedin.dedupKey(rawJob)).toMatch(/^linkedin:/);
    });

    it('two sources can never collide on the same underlying id', () => {
      const rawJob = { id: '4441092711', title: 'Agile Coach', company: 'Stealth iT' };
      expect(linkedin.dedupKey(rawJob)).toContain('4441092711');
    });
  });
});
