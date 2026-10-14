import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

const CHUNK = 1_000_000;

/**
 * Reproduces Kdenlive's ProjectClip::calculateHash: md5 of the first and last 1MB
 * (or the whole file when <= 2MB). Kdenlive names cached proxies `<hash>.mkv`, so
 * matching it lets existing proxies in ~/.cache/kdenlive/proxy be reused.
 * Opens the file read-only.
 */
export async function kdenliveFileHash(path: string): Promise<{ hash: string; size: number }> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const md5 = createHash('md5');
    if (size > 2 * CHUNK) {
      md5.update(await readAt(fh, 0, CHUNK));
      md5.update(await readAt(fh, size - CHUNK, CHUNK));
    } else {
      md5.update(await readAt(fh, 0, size));
    }
    return { hash: md5.digest('hex'), size };
  } finally {
    await fh.close();
  }
}

async function readAt(fh: import('node:fs/promises').FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let off = 0;
  while (off < length) {
    const { bytesRead } = await fh.read(buf, off, length - off, position + off);
    if (bytesRead === 0) break;
    off += bytesRead;
  }
  return buf.subarray(0, off);
}
