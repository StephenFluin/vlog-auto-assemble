import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** EBU R128 measurement, as stored by MLT's `loudness` filter in its `results` property. */
export interface Loudness {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** Loudness range, LU. */
  range: number;
  /** Sample peak, linear amplitude (1.0 = 0 dBFS). */
  peak: number;
}

/**
 * Runs the analysis pass of Kdenlive's "Normalize 2 pass" effect with ffmpeg's ebur128
 * filter instead (same EBU R128 algorithm as MLT's libebur128; verified to match the
 * results Kdenlive stored in past projects). Kdenlive analyses the timeline entry's
 * in/out range; the generated entries span the whole clip, so the whole file is measured.
 */
export async function measureLoudness(path: string, ffmpeg = 'ffmpeg'): Promise<Loudness | undefined> {
  const { stderr } = await run(
    ffmpeg,
    ['-nostats', '-hide_banner', '-i', path, '-vn', '-sn', '-dn', '-af', 'ebur128=peak=sample:framelog=quiet', '-f', 'null', '-'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return parseEbur128Summary(stderr);
}

export function parseEbur128Summary(output: string): Loudness | undefined {
  // The summary is printed last; earlier lines may contain per-frame logs.
  const summary = output.slice(output.lastIndexOf('Summary:'));
  const num = (re: RegExp) => {
    const m = re.exec(summary);
    if (!m) return undefined;
    return m[1] === '-inf' ? -Infinity : Number(m[1]);
  };
  const integrated = num(/I:\s+(-?[\d.]+|-inf) LUFS/);
  const range = num(/LRA:\s+(-?[\d.]+|-inf) LU\b/);
  const peakDb = num(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
  if (integrated === undefined || range === undefined || peakDb === undefined) return undefined;
  return { integrated, range, peak: peakDb === -Infinity ? 0 : 10 ** (peakDb / 20) };
}

/** ebur128 reports -70 LUFS (its gate) for silence; normalising that would apply absurd gain. */
export function isSilent(l: Loudness): boolean {
  return !Number.isFinite(l.integrated) || l.integrated <= -69.9;
}

/** MLT's `results` string: "L: <integrated>\tR: <range>\tP <peak>". */
export function mltResults(l: Loudness): string {
  return `L: ${l.integrated.toFixed(6)}\tR: ${l.range.toFixed(6)}\tP ${l.peak.toFixed(6)}`;
}
