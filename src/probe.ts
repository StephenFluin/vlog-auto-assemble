import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ProbeResult {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  /** Raw creation_time tag (container first, then first stream that has one). */
  creationTime?: string;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  format?: { duration?: string; tags?: Record<string, string> };
  streams?: FfprobeStream[];
}

export async function probe(path: string, ffprobe = 'ffprobe'): Promise<ProbeResult> {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseProbe(JSON.parse(stdout) as FfprobeOutput);
}

export function parseProbe(data: FfprobeOutput): ProbeResult {
  const streams = data.streams ?? [];
  // Cover art / thumbnails show up as video streams with attached_pic; ignore them.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');
  const tag = (tags?: Record<string, string>) => tags?.creation_time ?? tags?.CREATION_TIME;
  return {
    durationSec: Number(data.format?.duration ?? 0) || 0,
    hasVideo: !!video,
    hasAudio: !!audio,
    width: video?.width,
    height: video?.height,
    fps: video?.avg_frame_rate ? parseRate(video.avg_frame_rate) : undefined,
    creationTime: tag(data.format?.tags) ?? streams.map((s) => tag(s.tags)).find(Boolean),
  };
}

function parseRate(r: string): number | undefined {
  const [n, d] = r.split('/').map(Number);
  if (!n || !d) return undefined;
  return n / d;
}
