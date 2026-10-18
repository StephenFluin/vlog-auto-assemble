#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { loadConfig, configPath, type Config } from './config.ts';
import { discover, nextUnassembledDate } from './discover.ts';
import { buildProject, clipFrames } from './kdenlive.ts';
import { addDays, isIsoDate, localDate, framesToClock } from './time.ts';

const HELP = `Usage: vlog-assemble [date] [options]

Builds <date>.kdenlive with every clip from the day, in true chronological order.

  date                 YYYY-MM-DD, "today", "yesterday". Default: the oldest
                       /staging/<date> folder that doesn't have a project yet.

Options:
  -o, --out-dir DIR    Where to write the project (default: projects dir from config)
  -n, --dry-run        Print the clip list without writing anything
  -f, --force          Overwrite an existing project file
      --no-titles      Skip the date title and "Thanks!" outro
  -h, --help           Show this help

Config: ${configPath()}
`;

function resolveDate(arg: string | undefined): string | undefined {
  if (!arg) return undefined;
  if (arg === 'today') return localDate();
  if (arg === 'yesterday') return addDays(localDate(), -1);
  if (!isIsoDate(arg)) throw new Error(`Invalid date "${arg}", expected YYYY-MM-DD`);
  return arg;
}

function projectsDirFor(config: Config, date: string): string {
  return config.projectsDir.replace('{year}', date.slice(0, 4));
}

/** Never write into the source footage folders. */
function assertSafeOutput(path: string, config: Config) {
  const abs = resolve(path);
  for (const src of [config.stagingDir, config.phoneDir]) {
    const root = resolve(src);
    if (abs === root || abs.startsWith(root + sep)) throw new Error(`Refusing to write inside source folder ${root}`);
  }
}

function fmtLocal(t: Date): string {
  return t.toLocaleString('sv-SE', { hour12: false });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'out-dir': { type: 'string', short: 'o' },
      'dry-run': { type: 'boolean', short: 'n' },
      force: { type: 'boolean', short: 'f' },
      'no-titles': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  const config = loadConfig();
  if (values['no-titles']) config.titles = false;

  const outDirFor = (date: string) => values['out-dir'] ?? projectsDirFor(config, date);
  const projectPathFor = (date: string) => join(outDirFor(date), `${date}.kdenlive`);

  let date = resolveDate(positionals[0]);
  if (!date) {
    // Judge "already assembled" by the real projects folder, even when --out-dir redirects output.
    date = await nextUnassembledDate(config, (d) => join(projectsDirFor(config, d), `${d}.kdenlive`));
    if (!date) throw new Error(`Every day in ${config.stagingDir} already has a project; pass a date explicitly.`);
    console.log(`No date given; using the oldest staging day without a project: ${date}`);
  }

  const outDir = outDirFor(date);
  const outPath = projectPathFor(date);
  assertSafeOutput(outPath, config);

  const { window, clips, warnings } = await discover(date, config);
  console.log(`Vlog day ${date}: ${window.start.toISOString()} -> ${window.end.toISOString()} (UTC)\n`);

  let pos = 0;
  for (const c of clips) {
    const frames = clipFrames(c);
    const src = c.timeSource === 'mtime' ? '  [mtime!]' : '';
    console.log(
      `  ${framesToClock(pos, 60).slice(0, 8)}  ${fmtLocal(c.start)}  ${c.device.padEnd(9)} ${c.name.padEnd(40)} ${c.durationSec.toFixed(1).padStart(6)}s${c.hasAudio ? '' : '  (no audio)'}${c.loudness ? `  ${c.loudness.integrated.toFixed(1)} LUFS -> ${config.loudness?.target}` : ''}${src}`,
    );
    pos += frames;
  }
  const byDevice = Map.groupBy(clips, (c) => c.device);
  console.log(`\n${clips.length} clips, ${framesToClock(pos, 60)} total: ${[...byDevice].map(([d, cs]) => `${cs.length} ${d}`).join(', ')}`);
  for (const w of warnings) console.warn(`warning: ${w}`);

  if (values['dry-run']) return;
  if (clips.length === 0) throw new Error('No clips found; not writing a project.');
  if (existsSync(outPath) && !values.force) throw new Error(`${outPath} already exists (use --force to overwrite)`);

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, buildProject({ date, clips, root: resolve(outDir), titles: config.titles, loudness: config.loudness }));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
