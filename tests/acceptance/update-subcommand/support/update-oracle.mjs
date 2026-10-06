// Calendar arithmetic for the update scenarios, restated here so the pure-layer properties share no code with src/.
// A day is `YYYY-MM-DD`; an instant is ISO 8601 UTC. Everything is whole UTC days.

const MS_PER_DAY = 86_400_000;

export const epochDayOf = (iso) => Math.floor(Date.parse(iso) / MS_PER_DAY);
export const isoDay = (epochDay) => new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
/** The UTC day an instant falls in. */
export const dayOf = (iso) => isoDay(epochDayOf(iso));
export const shiftDay = (day, days) => isoDay(epochDayOf(`${day}T00:00:00Z`) + days);
export const daysBetween = (from, to) => epochDayOf(`${to}T00:00:00Z`) - epochDayOf(`${from}T00:00:00Z`);
/** The last UTC day that has fully ended before the instant. */
export const lastSettledDay = (nowIso) => shiftDay(dayOf(nowIso), -1);
/** Every day from `from` to `to`, inclusive; empty when `to` precedes `from`. */
export const daysFrom = (from, to) => Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, offset) => shiftDay(from, offset));
/** Unix seconds at 00:00:00Z of a day, as Gmail's `after:` and `before:` carry them. */
export const secondsAtStartOf = (day) => epochDayOf(`${day}T00:00:00Z`) * 86_400;
