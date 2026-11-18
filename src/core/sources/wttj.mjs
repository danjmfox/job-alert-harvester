// PURE. The Welcome to the Jungle source descriptor (DR-0006, DR-0023). Rows carry their own fuzzy dedup key.

import { extractWelcomeJobs } from '../parse-wttj.mjs';
import { isUnreadableMessage } from './refusal.mjs';

const SENDER = 'help@welcometothejungle.com';

// Reading the digest is the judgement: what the extractor can read is kept, what it refuses is set aside (DDD-16).
/** @returns {string|null} the extractor's refusal as a reason, or null when the digest reads to at least one card. */
const screenWelcomeDigest = (message) => {
  try {
    extractWelcomeJobs(message);
    return null;
  } catch (error) {
    if (!isUnreadableMessage(error)) throw error;
    return `wttj.unreadable: ${error.message}`;
  }
};

export const wttj = Object.freeze({
  id: 'wttj',
  label: 'Welcome to the Jungle',
  sender: SENDER,
  matches: (message) => message.sender === SENDER,
  extract: (message) => extractWelcomeJobs(message),
  screen: screenWelcomeDigest,
});
