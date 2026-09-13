// PURE. The LinkedIn source descriptor (DR-0006). Plain data: a match predicate,
// an extractor that always returns an array, and a dedup key strategy.
// Wraps parse-linkedin.mjs with no change to its logic.

import { extractJobs } from '../parse-linkedin.mjs';
import { canonicalKey } from '../dedup.mjs';

const SENDER = 'jobalerts-noreply@linkedin.com';

export const linkedin = Object.freeze({
  id: 'linkedin',
  label: 'LinkedIn',
  matches: (message) => message.sender === SENDER,
  extract: (message) => extractJobs(message),
  dedupKey: (rawJob) => canonicalKey('linkedin', rawJob.id),
});
