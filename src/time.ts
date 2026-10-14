/** A vlog "day" is a UTC window from the cutoff hour on `date` to the cutoff hour the next day. */
export interface DayWindow {
  date: string; // YYYY-MM-DD
  start: Date;
  end: Date; // exclusive
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s;
}

export function dayWindow(date: string, cutoffUtcHour: number): DayWindow {
  if (!isIsoDate(date)) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, cutoffUtcHour));
  const end = new Date(Date.UTC(y, m - 1, d + 1, cutoffUtcHour));
  return { date, start, end };
}

export function inWindow(t: Date, w: DayWindow): boolean {
  return t >= w.start && t < w.end;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Local calendar date (YYYY-MM-DD) of `t` in the machine's time zone. */
export function localDate(t: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

const PIXEL_RE = /^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(\d{3})/;

/**
 * Pixel filenames encode the recording *start* time in UTC, to the millisecond:
 * PXL_20261010_124722740 -> 2026-10-10T12:47:22.740Z. This is the most reliable
 * timestamp we have for phone clips (the .nut container's creation_time is the end time).
 */
export function parsePixelFilename(name: string): Date | undefined {
  const m = PIXEL_RE.exec(name);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, ms] = m.map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  return Number.isNaN(t.getTime()) ? undefined : t;
}

/** Parse ffprobe's creation_time (e.g. 2026-10-10T16:03:49.000000Z). */
export function parseCreationTime(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  // Trim sub-millisecond digits, which Date.parse does not reliably accept.
  const norm = s.trim().replace(/(\.\d{3})\d+/, '$1');
  const t = new Date(norm);
  if (Number.isNaN(t.getTime())) return undefined;
  // Cameras with an unset clock report the epoch or 1904/1970-ish dates.
  if (t.getUTCFullYear() < 2000) return undefined;
  return t;
}

/** Frames -> MLT clock string, e.g. 299 @ 60fps -> "00:00:04.983". */
export function framesToClock(frames: number, fps: number): string {
  const totalMs = Math.round((frames / fps) * 1000);
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(totalS / 3600))}:${pad(Math.floor(totalS / 60) % 60)}:${pad(totalS % 60)}.${pad(ms, 3)}`;
}

/** Frames -> Kdenlive's HH:MM:SS:FF duration string, e.g. 300 @ 60fps -> "00:00:05:00". */
export function framesToTimecode(frames: number, fps: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const totalS = Math.floor(frames / fps);
  return `${pad(Math.floor(totalS / 3600))}:${pad(Math.floor(totalS / 60) % 60)}:${pad(totalS % 60)}:${pad(frames % fps)}`;
}
