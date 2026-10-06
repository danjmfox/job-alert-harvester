// Preloaded into a CLI subprocess (`node --import`): the process answers as the platform, user id and node binary named by
// FIXED_PLATFORM, FIXED_UID and FIXED_EXEC_PATH, so a scenario can run the real CLI "on another operating system" and with a
// node path it controls (a stable symlink, a versioned directory, a fake) without touching the host. A variable that is
// absent leaves the real answer. No platform seam exists in src/ (the DESIGN's Reuse analysis), so this sits beside
// search-yield-summary/support/fixed-clock.mjs, which it mirrors.
const platform = process.env.FIXED_PLATFORM;
if (platform) Object.defineProperty(process, 'platform', { value: platform, configurable: true });

const uid = Number(process.env.FIXED_UID);
if (process.env.FIXED_UID !== undefined && Number.isInteger(uid)) process.getuid = () => uid;

const execPath = process.env.FIXED_EXEC_PATH;
if (execPath) Object.defineProperty(process, 'execPath', { value: execPath, configurable: true, writable: true });
