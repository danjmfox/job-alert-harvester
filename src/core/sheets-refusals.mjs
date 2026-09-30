// PURE. Every named refusal of the Sheets target, the Drive provisioner, `import` and `build --target` (DR-0012).
// Values are the contract; the modules that raise them arrive in DELIVER.

export const SheetsRefusal = Object.freeze({
  CREDENTIAL_MISSING: 'sheets.credential-missing',
  CREDENTIAL_INVALID: 'sheets.credential-invalid',
  CREDENTIAL_PERMISSIONS: 'sheets.credential-permissions',
  NOT_IMPORTED: 'sheets.not-imported',
  TARGET_RECORD_INVALID: 'sheets.target-record-invalid',
  REAUTH_REQUIRED: 'sheets.reauth-required',
  TOKEN_ENDPOINT_ERROR: 'sheets.token-endpoint-error',
  SCOPE_MISMATCH: 'sheets.scope-mismatch',
  SPREADSHEET_UNREADABLE: 'sheets.spreadsheet-unreadable',
  ID_MISMATCH: 'sheets.id-mismatch',
  UNAUTHORIZED: 'sheets.unauthorized',
  QUOTA_EXHAUSTED: 'sheets.quota-exhausted',
  SERVER_ERROR: 'sheets.server-error',
  REQUEST_REJECTED: 'sheets.request-rejected',
  SPREADSHEET_TRASHED: 'sheets.spreadsheet-trashed',
  TAB_MISSING: 'sheets.tab-missing',
  KEY_COLUMN_MISSING: 'sheets.key-column-missing',
  DUPLICATE_HEADER: 'sheets.duplicate-header',
  HEADER_CHANGED: 'sheets.header-changed',
  DUPLICATE_KEY: 'sheets.duplicate-key',
  PLAN_TOO_LARGE: 'sheets.plan-too-large',
  APPLY_OUTCOME_UNKNOWN: 'sheets.apply-outcome-unknown',
  // Proposed by DISTILL: DESIGN names no code for these.
  RESPONSE_MALFORMED: 'sheets.response-malformed',
  WRITE_NOT_PERMITTED: 'sheets.write-not-permitted',
  REDIRECT_REFUSED: 'sheets.redirect-refused',
});

export const DriveRefusal = Object.freeze({
  QUOTA_EXHAUSTED: 'drive.quota-exhausted',
  SERVER_ERROR: 'drive.server-error',
  UNAUTHORIZED: 'drive.unauthorized',
  REQUEST_REJECTED: 'drive.request-rejected',
  // Proposed by DISTILL.
  STORAGE_FULL: 'drive.storage-full',
  RESPONSE_MALFORMED: 'drive.response-malformed',
  NOT_CREATED_HERE: 'drive.not-created-here',
});

export const ImportRefusal = Object.freeze({
  ALREADY_IMPORTED: 'import.already-imported',
  FILE_MISSING: 'import.file-missing',
  NOT_A_WORKBOOK: 'import.not-a-workbook',
  NO_DEDUP_KEY_COLUMN: 'import.no-dedup-key-column',
  KEY_COLUMN_MISSING: 'import.key-column-missing',
  UNRECOGNISED_HEADERS: 'import.unrecognised-headers',
  DUPLICATE_KEY: 'import.duplicate-key',
  CONVERSION_MISMATCH: 'import.conversion-mismatch',
  RECORD_FAILED: 'import.record-failed',
});

export const BuildRefusal = Object.freeze({
  OUT_EXISTS: 'build.out-exists',
  TARGET_CONFLICT: 'build.target-conflict',
  // Proposed by DISTILL: DESIGN names no code for an unrecognised --target value.
  UNKNOWN_TARGET: 'build.unknown-target',
});

// Proposed by DISTILL.
export const AuthTargetRefusal = Object.freeze({
  UNKNOWN_TARGET: 'auth.unknown-target',
});
