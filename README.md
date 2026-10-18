# vlog-assemble

Builds a ready-to-edit Kdenlive project for one vlog day: every clip from
`/staging/<date>/` plus the day's Pixel clips from `/staging-phone/DCIM/Camera/`,
laid out on the timeline in true chronological order across all cameras.

```bash
vlog-assemble                  # oldest /staging day without a project yet
vlog-assemble 2026-10-12       # a specific day
vlog-assemble yesterday -n     # dry run: just print the clip order
vlog-assemble 2026-10-10 -o ./output --force
```

Output: `<projectsDir>/<date>.kdenlive` (refuses to overwrite without `--force`,
and refuses to write anywhere inside the source folders). Source footage is only
ever opened read-only.

## What goes in

- **`/staging/<date>/`**: every video file (`.MP4`, `.mov`, `.mp4`, `.nut`, ...).
  GoPro `.LRV`/`.THM`, Insta360 `.insv`/`.lrv` and photos are ignored. Insta360
  `.insv` files with no exported `.mp4` are reported.
- **Phone**: `PXL_*.nut` whose filename time falls in the day window
  `<date> 10:00 UTC` → `<date+1> 10:00 UTC` (about 4-5AM Central). Pixel `.mp4`s in the
  window that haven't been converted to `.nut` yet are reported.

## How clips are ordered

The projects place clips directly, so Kdenlive's bin sort (which uses file mtime)
doesn't matter, and the `touch` hack in `fix-pixel-date.py` is no longer needed for ordering.
Capture time comes from:

| Device | Source | Notes |
| --- | --- | --- |
| Pixel | `PXL_YYYYMMDD_HHMMSSmmm` filename | UTC start time. The `.nut` `creation_time` is the *end* time. |
| Canon R5, GoPro, Insta360 | container `creation_time` | True UTC start time on all of these. |
| anything else | `creation_time`, else file mtime | mtime is flagged `[mtime!]`. |

If a camera clock was wrong (e.g. GoPro not synced after a DST change), add a
correction in seconds to `~/.config/vlog-assemble/config.json`:

```json
{ "clockOffsets": { "GoPro": -3600 } }
```

Other config keys (with defaults): `stagingDir` (`/staging`), `phoneDir`,
`projectsDir` (`/super/video-projects/stephen/{year}/vlog`), `dayCutoffUtcHour` (10),
`titles` (true), `loudness`, `ffprobe`, `ffmpeg`.

## What comes out

Same layout as the hand-made daily projects: 4K UHD 60fps, A1-A3 / V1-V3,
all clips back to back on A1/V1 with audio and video grouped, a 5s date title with
fade-out at the start of V2 and a 7s "Thanks!" with fade-in ending at the end.
Every `.mp4` with audio (R5, GoPro, Insta360) gets your **Normalize 2 pass -16**
effect on its A1 audio, with the analysis pass already done: the tool measures each
clip with ffmpeg's EBU R128 `ebur128` filter (matches the values Kdenlive's own
analysis stored in past projects) and writes the `results`, so the gain to -16 LUFS
is applied as soon as the project opens. If you trim a clip heavily, click
"Analyse" on the effect to re-measure just the trimmed part. Phone `.nut` files are
skipped since `process-phone-videos.sh` already loudnorms them. Configure via
`loudness` (`target`, `extensions`, `effectId`; `null` disables).

Proxy settings match the existing projects; Kdenlive reuses cached proxies in
`~/.cache/kdenlive/proxy` (the tool computes the same file hash) and GoPro `.LRV`s,
and generates the rest on open.

## Install

Needs Node ≥ 23.6 (runs the TypeScript directly, no build step) and `ffmpeg`/`ffprobe`
(on macOS: `brew install ffmpeg`).

```bash
npm install                    # dev tools only (typescript, types)
ln -s "$PWD/bin/vlog-assemble" ~/bin/vlog-assemble
npm test && npm run typecheck
```
