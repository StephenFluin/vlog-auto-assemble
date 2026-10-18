import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  /** Folder of per-day camera dumps; each day lives in `<stagingDir>/<YYYY-MM-DD>/`. */
  stagingDir: string;
  /** Pixel camera folder holding PXL_*.nut files (converted by process-phone-videos.sh). */
  phoneDir: string;
  /** Where projects are written. `{year}` is replaced with the vlog date's year. */
  projectsDir: string;
  /**
   * Hour (UTC) at which one vlog day ends and the next begins. Matches the filename
   * convention of Pixel clips: PXL_<date>_100000 is the first clip of <date>.
   */
  dayCutoffUtcHour: number;
  /**
   * Per-device clock corrections in seconds, added to the detected capture time.
   * Keys are device labels as printed in the report (e.g. "GoPro", "Canon R5").
   * Use this when a camera's clock was set wrong for a trip.
   */
  clockOffsets: Record<string, number>;
  /** Whether to add the daily date title and "Thanks!" outro on V2. */
  titles: boolean;
  /**
   * Two-pass EBU R128 normalisation applied to the audio of matching clips, like
   * Kdenlive's "Normalize 2 pass" effect with the analysis already done. `null` disables it.
   * Phone .nut files are already loudnorm'd to -16 LUFS by process-phone-videos.sh.
   */
  loudness: {
    /** Target program loudness, LUFS. */
    target: number;
    /** File extensions (lowercase) to normalise. */
    extensions: string[];
    /** Kdenlive effect id; a custom effect from ~/.local/share/kdenlive/effects, or "loudness" for the built-in. */
    effectId: string;
  } | null;
  /** ffprobe executable. */
  ffprobe: string;
  /** ffmpeg executable (used for loudness analysis). */
  ffmpeg: string;
}

export const DEFAULT_CONFIG: Config = {
  stagingDir: '/staging',
  phoneDir: '/staging-phone/DCIM/Camera',
  projectsDir: '/super/video-projects/stephen/{year}/vlog',
  dayCutoffUtcHour: 10,
  clockOffsets: {},
  titles: true,
  loudness: { target: -16, extensions: ['.mp4'], effectId: 'Normalize 2 pass -16' },
  ffprobe: 'ffprobe',
  ffmpeg: 'ffmpeg',
};

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'vlog-assemble', 'config.json');
}

/** Defaults overlaid with ~/.config/vlog-assemble/config.json, if present. */
export function loadConfig(path = configPath()): Config {
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  const user = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  return { ...DEFAULT_CONFIG, ...user };
}
