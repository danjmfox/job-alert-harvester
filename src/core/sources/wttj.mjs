// PURE. The Welcome to the Jungle source descriptor (DR-0006, DR-0023). Rows carry their own fuzzy dedup key.

import { extractWelcomeJobs } from '../parse-wttj.mjs';

const SENDER = 'help@welcometothejungle.com';

export const wttj = Object.freeze({
  id: 'wttj',
  label: 'Welcome to the Jungle',
  sender: SENDER,
  matches: (message) => message.sender === SENDER,
  extract: (message) => extractWelcomeJobs(message),
});
