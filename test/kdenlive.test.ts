import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProject } from '../src/kdenlive.ts';
import { detectDevice, type Clip } from '../src/discover.ts';

function clip(name: string, start: string, durationSec: number, hasAudio = true): Clip {
  return {
    path: `/staging/2026-10-10/${name}`,
    name,
    device: detectDevice(name),
    start: new Date(start),
    timeSource: 'metadata',
    durationSec,
    hasVideo: true,
    hasAudio,
    width: 3840,
    height: 2160,
    size: 1234,
    hash: 'abc',
  };
}

const clips = [
  clip('PXL_20261010_124722740.nut', '2026-10-10T12:47:22Z', 2),
  clip('GX012263.MP4', '2026-10-10T17:11:18Z', 3, false),
  clip('A_0001C771A261010_110349EJ_R5M2V.MP4', '2026-10-10T16:03:49Z', 10),
];

test('devices are recognised from filenames', () => {
  assert.equal(detectDevice('PXL_20261010_124722740.nut'), 'Pixel');
  assert.equal(detectDevice('A_0001C771A261010_110349EJ_R5M2V.MP4'), 'Canon R5');
  assert.equal(detectDevice('GX012263.MP4'), 'GoPro');
  assert.equal(detectDevice('VID_20261010_110542_00_001.mp4'), 'Insta360');
  assert.equal(detectDevice('DJI_20261010120000_0001_D.MP4'), 'DJI');
});

test('project places clips back to back on A1/V1 and groups A/V', () => {
  const xml = buildProject({ date: '2026-10-10', clips, root: '/out', titles: true });
  assert.match(xml, /<profile [^>]*frame_rate_num="60" height="2160"[^>]*width="3840"/);
  // V1 has one entry per clip in the given order.
  const v1 = /<playlist id="playlist6">([\s\S]*?)<\/playlist>/.exec(xml)![1];
  assert.deepEqual([...v1.matchAll(/out="(\d+)"/g)].map((m) => m[1]), ['119', '179', '599']);
  // A1 skips the silent GoPro clip with a blank of the same length.
  const a1 = /<playlist id="playlist4">([\s\S]*?)<\/playlist>/.exec(xml)![1];
  assert.match(a1, /<blank length="180"\/>/);
  assert.equal([...a1.matchAll(/<entry /g)].length, 2);
  // Groups reference V1 (3) and A1 (2) at the clip start positions.
  assert.match(xml, /&quot;data&quot;: &quot;3:0:-1&quot;/);
  assert.match(xml, /&quot;data&quot;: &quot;2:300:-1&quot;/);
  assert.doesNotMatch(xml, /&quot;2:120:-1&quot;/);
  // Titles: date at the start, Thanks! ending at the end (total 900 frames).
  const v2 = /<playlist id="playlist8">([\s\S]*?)<\/playlist>/.exec(xml)![1];
  assert.match(v2, /<blank length="180"\/>/);
  assert.match(xml, /2026-10-10<\/property>/);
});

test('clips with a loudness measurement get the normalize effect on A1 only', () => {
  const measured = [{ ...clips[2], loudness: { integrated: -29.1, range: 7.2, peak: 0.42 } }, clips[0]];
  const xml = buildProject({ date: '2026-10-10', clips: measured, root: '/out', titles: false, loudness: { target: -16, effectId: 'Normalize 2 pass -16' } });
  const a1 = /<playlist id="playlist4">([\s\S]*?)<\/playlist>/.exec(xml)![1];
  assert.equal([...a1.matchAll(/mlt_service">loudness</g)].length, 1);
  assert.match(a1, /<property name="program">-16<\/property>/);
  assert.match(a1, /<property name="kdenlive_id">Normalize 2 pass -16<\/property>/);
  assert.match(a1, /<property name="results">L: -29.100000\tR: 7.200000\tP 0.420000<\/property>/);
  assert.equal([...xml.matchAll(/mlt_service">loudness</g)].length, 1);
});

test('bin clips above the proxy size threshold are flagged for proxy creation on open', () => {
  const small = { ...clip('small.mp4', '2026-10-10T12:00:00Z', 1), width: 640, height: 360 };
  const xml = buildProject({ date: '2026-10-10', clips: [...clips, small], root: '/out', titles: false });
  const bin = [...xml.matchAll(/<chain id="(chain\d+)"[^>]*>([\s\S]*?)<\/chain>/g)].slice(-4);
  assert.deepEqual(
    bin.map(([, , body]) => body.includes('<property name="_replaceproxy">1</property>')),
    [true, true, true, false],
  );
  // Only bin clips carry the flag, not the timeline instances.
  assert.equal([...xml.matchAll(/_replaceproxy/g)].length, 3);
});

test('titles use a concrete font family so Kdenlive does not rewrite them on open', () => {
  const xml = buildProject({ date: '2026-10-10', clips, root: '/out', titles: true });
  assert.equal([...xml.matchAll(/font=&quot;Noto Sans&quot;/g)].length, 2);
  assert.doesNotMatch(xml, /Sans Serif/);
});

test('titles can be disabled', () => {
  const xml = buildProject({ date: '2026-10-10', clips, root: '/out', titles: false });
  assert.doesNotMatch(xml, /kdenlivetitle/);
});

test('special characters in paths are escaped', () => {
  const xml = buildProject({ date: '2026-10-10', clips: [clip('a&b <c>.mp4', '2026-10-10T12:00:00Z', 1)], root: '/out', titles: false });
  assert.match(xml, /a&amp;b &lt;c&gt;\.mp4/);
});
