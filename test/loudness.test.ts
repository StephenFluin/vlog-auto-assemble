import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEbur128Summary, mltResults, isSilent } from '../src/loudness.ts';

const SUMMARY = `[Parsed_ebur128_0 @ 0x570da0cb3940] Summary:

  Integrated loudness:
    I:         -33.9 LUFS
    Threshold: -44.5 LUFS

  Loudness range:
    LRA:         3.1 LU
    Threshold: -53.7 LUFS
    LRA low:   -35.4 LUFS
    LRA high:  -32.3 LUFS

  Sample peak:
    Peak:      -15.2 dBFS
`;

test('parses the ebur128 summary into MLT loudness results', () => {
  const l = parseEbur128Summary('noise before\n' + SUMMARY)!;
  assert.equal(l.integrated, -33.9);
  assert.equal(l.range, 3.1);
  // Kdenlive stored P 0.174730 for this same segment of 2026-10-07.mp4.
  assert.ok(Math.abs(l.peak - 0.17473) < 0.001);
  assert.equal(mltResults(l), 'L: -33.900000\tR: 3.100000\tP 0.173780');
  assert.ok(!isSilent(l));
});

test('silence and missing summaries are handled', () => {
  const silent = parseEbur128Summary(SUMMARY.replace('-33.9 LUFS', '-70.0 LUFS').replace('-15.2 dBFS', '-inf dBFS'))!;
  assert.ok(isSilent(silent));
  assert.equal(silent.peak, 0);
  assert.equal(parseEbur128Summary('no summary here'), undefined);
});
