// Driven adapter: creates one native Sheet from a workbook through Drive, and deletes only a file id it created in
// this instance. It has no update operation. Every request is sent once through the write capability: never replayed.
import { DriveRefusal } from '../core/sheets-refusals.mjs';

const NATIVE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STORAGE_FULL_REASONS = ['storageQuotaExceeded'];
const QUOTA_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'];
const TOO_MANY_REQUESTS = 429;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const SERVER_ERROR_FLOOR = 500;
const NO_CONTENT = 204;

// Messages carry the refusal code only: no credential value may reach an error.
const refuse = (code) => {
  throw Object.assign(new Error(code), { code });
};

const reasonOf = (body) => body?.error?.errors?.[0]?.reason ?? null;

const refusalForFailure = ({ status, body }) => {
  if (status === TOO_MANY_REQUESTS) return DriveRefusal.QUOTA_EXHAUSTED;
  if (status === FORBIDDEN && STORAGE_FULL_REASONS.includes(reasonOf(body))) return DriveRefusal.STORAGE_FULL;
  if (status === FORBIDDEN && QUOTA_REASONS.includes(reasonOf(body))) return DriveRefusal.QUOTA_EXHAUSTED;
  if (status === FORBIDDEN || status === UNAUTHORIZED) return DriveRefusal.UNAUTHORIZED;
  if (status === 0 || status >= SERVER_ERROR_FLOOR) return DriveRefusal.SERVER_ERROR;
  return DriveRefusal.REQUEST_REJECTED;
};

const isNativeSheetFile = (body) => typeof body?.id === 'string' && body.id !== '' && body.mimeType === NATIVE_SHEET_MIME;

const latin1 = new TextDecoder('latin1');
const utf8 = new TextEncoder();

const boundaryAbsentFrom = (bytes) => {
  const text = latin1.decode(bytes);
  for (let attempt = 0; ; attempt += 1) {
    const boundary = `harvester-upload-${attempt}`;
    if (!text.includes(boundary)) return boundary;
  }
};

const concatenated = (chunks) => {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  chunks.reduce((offset, chunk) => (joined.set(chunk, offset), offset + chunk.length), 0);
  return joined;
};

/** @returns {{ contentType: string, body: Uint8Array }} a multipart/related body: Drive metadata then the workbook bytes. */
const multipartUpload = ({ name, workbookBytes }) => {
  const bytes = new Uint8Array(workbookBytes);
  const boundary = boundaryAbsentFrom(bytes);
  const metadata = JSON.stringify({ name, mimeType: NATIVE_SHEET_MIME });
  const head = utf8.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`,
  );
  return { contentType: `multipart/related; boundary=${boundary}`, body: concatenated([head, bytes, utf8.encode(`\r\n--${boundary}--`)]) };
};

/**
 * @param {{ transport: { write: { request: Function } }, endpoints: { driveBase: string, driveUploadBase: string }, tokenSource: { probe: Function, accessToken: Function } }} options
 * @returns {{ create: Function, delete: Function, probe: Function }}
 *   create({ name, workbookBytes }) resolves { spreadsheetId }; delete(id) resolves for an id this instance created.
 */
export function createSheetProvisioner({ transport, endpoints, tokenSource }) {
  const createdHere = new Set();

  const create = async ({ name, workbookBytes }) => {
    const { contentType, body } = multipartUpload({ name, workbookBytes });
    const query = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,mimeType' });
    const response = await transport.write.request(`${endpoints.driveUploadBase}/files?${query}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    if (response.status !== 200) return refuse(refusalForFailure(response));
    if (!isNativeSheetFile(response.body)) return refuse(DriveRefusal.RESPONSE_MALFORMED);
    createdHere.add(response.body.id);
    return { spreadsheetId: response.body.id };
  };

  const remove = async (id) => {
    if (!createdHere.has(id)) return refuse(DriveRefusal.NOT_CREATED_HERE);
    const response = await transport.write.request(`${endpoints.driveBase}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.status !== NO_CONTENT) return refuse(refusalForFailure(response));
    createdHere.delete(id);
    return undefined;
  };

  const probe = async () => {
    tokenSource.probe();
    await tokenSource.accessToken();
  };

  return { create, delete: remove, probe };
}
