// Constants shared by the Sheets fake and the domain vocabulary; held apart so neither imports the other.
export { DRIVE_FILE_SCOPE } from '../../../../src/core/scope-profiles.mjs';

export const SPREADSHEET_ID = '1SHEETS-fake-tracker-4f2a';
export const NATIVE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Recognisable secrets: none may ever appear in output, refusal text, or any file but its own slot. */
export const SHEETS_SENTINEL = Object.freeze({
  accessToken: 'ya29.SENTINEL-sheets-access-token-8e1d',
  accessTokenRefreshed: 'ya29.SENTINEL-sheets-access-token-refreshed-3c7b',
  refreshToken: '1//SENTINEL-sheets-refresh-token-6a4f',
  refreshTokenRotated: '1//SENTINEL-sheets-refresh-token-rotated-2d9e',
});
