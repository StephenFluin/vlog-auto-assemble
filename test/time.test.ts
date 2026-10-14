import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayWindow, inWindow, parsePixelFilename, parseCreationTime, framesToClock, framesToTimecode, addDays } from '../src/time.ts';

test('pixel filenames are UTC start times with milliseconds', () => {
  assert.equal(parsePixelFilename('PXL_20261010_124722740.nut')?.toISOString(), '2026-10-10T12:47:22.740Z');
  assert.equal(parsePixelFilename('PXL_20261012_045132262.TS.nut')?.toISOString(), '2026-10-12T04:51:32.262Z');
  assert.equal(parsePixelFilename('GX012263.MP4'), undefined);
});

test('day window splits at the cutoff hour (UTC)', () => {
  const w = dayWindow('2026-10-10', 10);
  // First and last clips of 2026-10-10 per the user's own projects.
  assert.ok(inWindow(parsePixelFilename('PXL_20261010_124722740.nut')!, w));
  assert.ok(inWindow(parsePixelFilename('PXL_20261011_045847370.nut')!, w));
  // Belongs to 2026-10-09 (late evening local time).
  assert.ok(!inWindow(parsePixelFilename('PXL_20261010_044748469.nut')!, w));
  assert.ok(!inWindow(parsePixelFilename('PXL_20261011_100000000.nut')!, w));
  assert.ok(inWindow(parsePixelFilename('PXL_20261010_100000000.nut')!, w));
});

test('dayWindow rejects bad dates', () => {
  assert.throws(() => dayWindow('2026-02-30', 10));
  assert.throws(() => dayWindow('20261010', 10));
});

test('addDays crosses month boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('creation_time parsing handles microseconds and rejects unset clocks', () => {
  assert.equal(parseCreationTime('2026-10-10T16:03:49.000000Z')?.toISOString(), '2026-10-10T16:03:49.000Z');
  assert.equal(parseCreationTime('1970-01-01T00:00:00.000000Z'), undefined);
  assert.equal(parseCreationTime(undefined), undefined);
  assert.equal(parseCreationTime('garbage'), undefined);
});

test('frame formatting matches Kdenlive', () => {
  assert.equal(framesToClock(299, 60), '00:00:04.983');
  assert.equal(framesToClock(20092, 60), '00:05:34.867');
  assert.equal(framesToTimecode(300, 60), '00:00:05:00');
  assert.equal(framesToTimecode(419, 60), '00:00:06:59');
});
