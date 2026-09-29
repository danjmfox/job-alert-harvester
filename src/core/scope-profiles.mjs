// PURE. The two OAuth scope profiles: a scope and the refusal-code namespace that goes with it (DR-0011, DR-0012).
// Constants only; oauth.mjs takes a profile and defaults to GMAIL.
import { GMAIL_READONLY_SCOPE } from './oauth.mjs';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const GMAIL = Object.freeze({ scope: GMAIL_READONLY_SCOPE, namespace: 'gmail' });
export const SHEETS = Object.freeze({ scope: DRIVE_FILE_SCOPE, namespace: 'sheets' });
