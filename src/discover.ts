import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import type { Config } from './config.ts';
import { dayWindow, inWindow, parsePixelFilename, parseCreationTime, type DayWindow } from './time.ts';
import { probe } from './probe.ts';
import { kdenliveFileHash } from './hash.ts';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.nut', '.mts', '.m2ts', '.avi', '.webm']);

export type TimeSource = 'filename' | 'metadata' | 'mtime';

export interface Clip {
  path: string;
  name: string;
  device: string;
  /** Best estimate of when recording started (true UTC instant). */
  start: Date;
  timeSource: TimeSource;
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  size: number;
  hash: string;
}

export interface Discovery {
  window: DayWindow;
  clips: Clip[];
  warnings: string[];
}

export function detectDevice(name: string): string {
  if (/^PXL_/i.test(name)) return 'Pixel';
  if (/^A_\d{4}C\d{3}/i.test(name)) return /_R5/i.test(name) ? 'Canon R5' : 'Canon';
  if (/^(G[XHL]\d{6}|GOPR\d+|GP\d{6})/i.test(name)) return 'GoPro';
  if (/^(VID|LRV)_\d{8}_\d{6}_\d{2}_\d{3}/i.test(name)) return 'Insta360';
  if (/^DJI_/i.test(name)) return 'DJI';
  return 'Other';
}

function isVideo(name: string): boolean {
  return !name.startsWith('.') && VIDEO_EXTS.has(extname(name).toLowerCase());
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Files from /staging/<date>: everything that is a video, regardless of timestamp. */
export async function stagingCandidates(dir: string, warnings: string[]): Promise<string[]> {
  const names = await listDir(dir);
  if (names.length === 0) warnings.push(`No staging folder (or it is empty): ${dir}`);
  const present = new Set(names);
  for (const n of names) {
    // Insta360 raw .insv needs exporting to .mp4 in Insta360 Studio before it can be edited.
    const m = /^(VID_\d{8}_\d{6})_\d{2}_(\d{3})\.insv$/i.exec(n);
    if (m && ![...present].some((p) => p.startsWith(m[1]) && p.endsWith(`_${m[2]}.mp4`))) {
      warnings.push(`Insta360 clip not exported yet (no .mp4 for ${n}) - skipped`);
    }
  }
  return names.filter(isVideo).map((n) => join(dir, n));
}

/** Pixel .nut files whose filename timestamp falls inside the day window. */
export async function phoneCandidates(dir: string, window: DayWindow, warnings: string[]): Promise<string[]> {
  const names = await listDir(dir);
  const out: string[] = [];
  const stems = new Set<string>();
  for (const n of names) {
    const t = parsePixelFilename(n);
    if (!t || !inWindow(t, window) || !isVideo(n)) continue;
    if (extname(n).toLowerCase() === '.nut') {
      out.push(join(dir, n));
      stems.add(n.slice(0, -4));
    }
  }
  for (const n of names) {
    const t = parsePixelFilename(n);
    if (!t || !inWindow(t, window) || !isVideo(n) || extname(n).toLowerCase() === '.nut') continue;
    const stem = n.slice(0, -extname(n).length);
    if (!stems.has(stem)) warnings.push(`Phone clip not converted yet (no .nut for ${n}; run process-phone-videos.sh) - skipped`);
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function inspectClip(path: string, config: Config, warnings: string[]): Promise<Clip | undefined> {
  const name = basename(path);
  const device = detectDevice(name);
  let info;
  try {
    info = await probe(path, config.ffprobe);
  } catch (e) {
    warnings.push(`ffprobe failed for ${path} - skipped (${(e as Error).message.split('\n')[0]})`);
    return undefined;
  }
  if (!info.hasVideo) {
    warnings.push(`No video stream in ${name} - skipped`);
    return undefined;
  }

  // Pixel: filename is the UTC start time (the .nut creation_time is the *end* time).
  // Cameras (R5, GoPro, Insta360): container creation_time is the UTC start time.
  // Last resort: mtime, which is unreliable (FAT cards store local time as if UTC).
  let start = device === 'Pixel' ? parsePixelFilename(name) : undefined;
  let timeSource: TimeSource = 'filename';
  if (!start) {
    start = parseCreationTime(info.creationTime);
    timeSource = 'metadata';
  }
  if (!start) {
    start = (await stat(path)).mtime;
    timeSource = 'mtime';
    warnings.push(`No capture time metadata in ${name}; using file mtime (ordering may be off)`);
  }
  const offset = config.clockOffsets[device];
  if (offset) start = new Date(start.getTime() + offset * 1000);

  const { hash, size } = await kdenliveFileHash(path);
  return {
    path,
    name,
    device,
    start,
    timeSource,
    durationSec: info.durationSec,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
    width: info.width,
    height: info.height,
    fps: info.fps,
    size,
    hash,
  };
}

export async function discover(date: string, config: Config): Promise<Discovery> {
  const window = dayWindow(date, config.dayCutoffUtcHour);
  const warnings: string[] = [];
  const stagingDir = join(config.stagingDir, date);
  const paths = [
    ...(await stagingCandidates(stagingDir, warnings)),
    ...(await phoneCandidates(config.phoneDir, window, warnings)),
  ];
  const clips = (await mapLimit(paths, 8, (p) => inspectClip(p, config, warnings))).filter((c): c is Clip => !!c);
  for (const c of clips) {
    if (c.device !== 'Pixel' && !inWindow(c.start, window)) {
      warnings.push(`${c.name} was recorded ${c.start.toISOString()}, outside the ${date} window - included anyway, check camera clock`);
    }
  }
  clips.sort((a, b) => a.start.getTime() - b.start.getTime() || a.name.localeCompare(b.name));
  return { window, clips, warnings };
}

/** Oldest staging day that doesn't have a project yet - "what should I edit next?" */
export async function nextUnassembledDate(config: Config, projectPathFor: (date: string) => string): Promise<string | undefined> {
  const days = (await listDir(config.stagingDir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.find((d) => !existsSync(projectPathFor(d)));
}
