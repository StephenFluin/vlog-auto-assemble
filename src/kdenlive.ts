import { createHash, randomUUID } from 'node:crypto';
import type { Clip } from './discover.ts';
import { framesToClock, framesToTimecode } from './time.ts';
import { mltResults } from './loudness.ts';

/**
 * Generates a Kdenlive (26.08 / MLT 7.4x) project that mirrors the structure of the
 * daily vlog projects: 4K60, three audio + three video tracks, every clip on A1/V1
 * in chronological order (audio/video grouped), the date title at the start of V2
 * and the "Thanks!" outro ending at the end of the timeline. Camera clips get a
 * pre-analysed two-pass loudness normalisation effect on their audio.
 *
 * Only properties Kdenlive needs to load the document are written; Kdenlive probes
 * the media itself on open and fills in the rest (and generates/reuses proxies).
 */

export interface ProjectOptions {
  date: string;
  clips: Clip[];
  /** Directory the project will be saved in (MLT `root`). */
  root: string;
  titles: boolean;
  /** Normalisation effect for clips that carry a loudness measurement. */
  loudness?: { target: number; effectId: string } | null;
}

const FPS = 60;
const WIDTH = 3840;
const HEIGHT = 2160;

// Track order inside the sequence tractor (index 0 is the black background):
// A3, A2, A1, V1, V2, V3. Group data refers to tracks by index excluding the background.
const TRACK_A1 = 2;
const TRACK_V1 = 3;

// Matches the projects' kdenlive:docproperties.proxyminsize.
const PROXY_MIN_WIDTH = 1000;

export function needsProxy(c: Clip): boolean {
  return c.hasVideo && (c.width ?? 0) > PROXY_MIN_WIDTH;
}

const DATE_TITLE_FRAMES = 300; // 5s
const THANKS_TITLE_FRAMES = 420; // 7s

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uuid(): string {
  return `{${randomUUID()}}`;
}

type Props = Array<[string, string | number]>;

function props(p: Props, indent: string): string {
  return p.map(([k, v]) => `${indent}<property name="${esc(k)}">${esc(String(v))}</property>`).join('\n');
}

export function clipFrames(c: Clip): number {
  // Floor so the timeline never references a frame past the end of the media.
  return Math.max(1, Math.floor(c.durationSec * FPS));
}

interface BinClip {
  clip: Clip;
  kdenliveId: number;
  frames: number;
  controlUuid: string;
}

function chainXml(id: string, b: BinClip, extra: Props): string {
  const p: Props = [
    ['length', b.frames],
    ['eof', 'pause'],
    ['resource', b.clip.path],
    ['mlt_service', 'avformat-novalidate'],
    ['seekable', 1],
    ['kdenlive:id', b.kdenliveId],
    ['kdenlive:folderid', -1],
    ['kdenlive:control_uuid', b.controlUuid],
    ['kdenlive:clip_type', b.clip.hasAudio ? 0 : 2],
    ['kdenlive:file_size', b.clip.size],
    ['kdenlive:file_hash', b.clip.hash],
    ...extra,
  ];
  return ` <chain id="${id}" out="${b.frames - 1}">\n${props(p, '  ')}\n </chain>`;
}

function titleXmldata(text: string, frames: number, x: number, y: number, boxWidth: number): string {
  return `<kdenlivetitle LC_NUMERIC="C" duration="${frames}" height="${HEIGHT}" out="${frames - 1}" width="${WIDTH}">
  <item type="QGraphicsTextItem" z-index="0">
   <position x="${x}" y="${y}">
    <transform>1,0,0,0,1,0,0,0,1</transform>
   </position>
   <content alignment="1" box-height="409" box-width="${boxWidth}" font="Sans Serif" font-color="255,255,255,255" font-italic="0" font-outline="0" font-outline-color="0,0,0,255" font-pixel-size="300" font-underline="0" font-weight="400" letter-spacing="0" shadow="0;#64000000;3;3;3" tab-width="80" typewriter="0;2;1;0;0">${esc(text)}</content>
  </item>
 <startviewport rect="0,0,${WIDTH},${HEIGHT}"/>
 <endviewport rect="0,0,${WIDTH},${HEIGHT}"/>
 <background color="0,0,0,0"/>
</kdenlivetitle>
`;
}

interface Title {
  id: string;
  kdenliveId: number;
  name: string;
  frames: number;
  xmldata: string;
}

function titleProducerXml(t: Title): string {
  const uniqueId = uuid();
  const hash = createHash('md5').update(uniqueId + t.xmldata).digest('hex');
  const p: Props = [
    ['length', t.frames],
    ['eof', 'pause'],
    ['resource', ''],
    ['meta.media.progressive', 1],
    ['aspect_ratio', 1],
    ['seekable', 1],
    ['mlt_service', 'kdenlivetitle'],
    ['kdenlive:duration', framesToTimecode(t.frames, FPS)],
    ['kdenlive:clipname', t.name],
    ['xmldata', t.xmldata],
    ['kdenlive:folderid', -1],
    ['kdenlive:id', t.kdenliveId],
    ['kdenlive:control_uuid', uuid()],
    ['kdenlive:clip_type', 2],
    ['kdenlive:uniqueId', uniqueId],
    ['kdenlive:file_hash', hash],
    ['force_reload', 0],
    ['meta.media.width', WIDTH],
    ['meta.media.height', HEIGHT],
  ];
  return ` <producer id="${t.id}" in="0" out="${t.frames - 1}">\n${props(p, '  ')}\n </producer>`;
}

const AUDIO_TRACK_FILTERS = (ids: [string, string, string]) => `  <filter id="${ids[0]}">
   <property name="window">75</property>
   <property name="max_gain">20dB</property>
   <property name="channel_mask">-1</property>
   <property name="mlt_service">volume</property>
   <property name="internal_added">237</property>
   <property name="disable">1</property>
  </filter>
  <filter id="${ids[1]}">
   <property name="channel">-1</property>
   <property name="mlt_service">panner</property>
   <property name="internal_added">237</property>
   <property name="start">0.5</property>
   <property name="disable">1</property>
  </filter>
  <filter id="${ids[2]}">
   <property name="iec_scale">0</property>
   <property name="prefix">meta.media.audio_level.</property>
   <property name="mlt_service">audiolevel</property>
   <property name="internal_added">237</property>
   <property name="dbpeak">1</property>
   <property name="disable">1</property>
  </filter>`;

export function buildProject(opts: ProjectOptions): string {
  const docUuid = uuid();
  let filterN = 0;
  const nextFilter = () => `filter${filterN++}`;

  // kdenlive:id 2 is the "Sequences" bin folder, 3 the timeline sequence; media starts at 4.
  let nextKid = 4;
  const bin: BinClip[] = opts.clips.map((clip) => ({
    clip,
    kdenliveId: nextKid++,
    frames: clipFrames(clip),
    controlUuid: uuid(),
  }));
  const contentFrames = bin.reduce((n, b) => n + b.frames, 0);

  const titles: Title[] = [];
  if (opts.titles) {
    titles.push({
      id: 'producer1',
      kdenliveId: nextKid++,
      name: opts.date,
      frames: DATE_TITLE_FRAMES,
      xmldata: titleXmldata(opts.date, DATE_TITLE_FRAMES, 1137, 216, 1565.94),
    });
    titles.push({
      id: 'producer2',
      kdenliveId: nextKid++,
      name: 'Thanks!',
      frames: THANKS_TITLE_FRAMES,
      xmldata: titleXmldata('Thanks!', THANKS_TITLE_FRAMES, 757, 1628, 1090.44),
    });
  }
  const totalFrames = Math.max(contentFrames, titles.reduce((n, t) => n + t.frames, 0), 1);
  const out: string[] = [];
  out.push(`<?xml version='1.0' encoding='utf-8'?>`);
  out.push(`<mlt LC_NUMERIC="C" producer="main_bin" root="${esc(opts.root)}" version="7.43.0">`);
  out.push(
    ` <profile colorspace="709" description="4K UHD 2160p 60 fps" display_aspect_den="9" display_aspect_num="16" frame_rate_den="1" frame_rate_num="${FPS}" height="${HEIGHT}" progressive="1" sample_aspect_den="1" sample_aspect_num="1" width="${WIDTH}"/>`,
  );
  out.push(` <producer id="producer0" in="0" out="${totalFrames - 1}">
${props(
  [
    ['length', 2147483647],
    ['eof', 'continue'],
    ['resource', 'black'],
    ['aspect_ratio', 1],
    ['mlt_service', 'color'],
    ['kdenlive:playlistid', 'black_track'],
    ['mlt_image_format', 'rgba'],
    ['set.test_audio', 0],
  ],
  '  ',
)}
 </producer>`);

  let chainN = 0;
  const trackTractor = (n: number, audio: boolean, entries: string, setOut: boolean) => {
    const a = `playlist${n * 2}`;
    const b = `playlist${n * 2 + 1}`;
    const audioProp = audio ? '\n  <property name="kdenlive:audio_track">1</property>' : '';
    const hide = audio ? 'video' : 'audio';
    return ` <playlist id="${a}">${audioProp}${entries}
 </playlist>
 <playlist id="${b}">${audioProp}
 </playlist>
 <tractor id="tractor${n}" in="0"${setOut ? ` out="${totalFrames - 1}"` : ''}>${audioProp}
  <property name="kdenlive:trackheight">75</property>
  <property name="kdenlive:timeline_active">1</property>
  <property name="kdenlive:collapsed">0</property>
  <property name="kdenlive:thumbs_format"/>
  <property name="kdenlive:audio_rec"/>
  <track hide="${hide}" producer="${a}"/>
  <track hide="${hide}" producer="${b}"/>${audio ? '\n' + AUDIO_TRACK_FILTERS([nextFilter(), nextFilter(), nextFilter()]) : ''}
 </tractor>`;
  };

  // A3, A2: empty audio tracks.
  out.push(trackTractor(0, true, '', false));
  out.push(trackTractor(1, true, '', false));

  // A1: audio halves of every clip; blanks keep alignment for clips without audio.
  {
    const entries: string[] = [];
    for (const b of bin) {
      if (!b.clip.hasAudio) {
        entries.push(`\n  <blank length="${b.frames}"/>`);
        continue;
      }
      const id = `chain${chainN++}`;
      out.push(chainXml(id, b, [['set.test_audio', 0], ['set.test_image', 1]]));
      let effect = '';
      if (opts.loudness && b.clip.loudness) {
        // Kdenlive's "Normalize 2 pass" effect with its analysis pass already filled in.
        const p: Props = [
          ['program', opts.loudness.target],
          ['mlt_service', 'loudness'],
          ['kdenlive_id', opts.loudness.effectId],
          ['results', mltResults(b.clip.loudness)],
          ['filterjob', ''],
          ['kdenlive:collapsed', 0],
        ];
        effect = `\n   <property name="kdenlive:activeeffect">0</property>\n   <filter id="${nextFilter()}">\n${props(p, '    ')}\n   </filter>`;
      }
      entries.push(`\n  <entry in="0" out="${b.frames - 1}" producer="${id}">\n   <property name="kdenlive:id">${b.kdenliveId}</property>${effect}\n  </entry>`);
    }
    out.push(trackTractor(2, true, entries.join(''), true));
  }

  // V1: video halves.
  {
    const entries: string[] = [];
    for (const b of bin) {
      const id = `chain${chainN++}`;
      out.push(chainXml(id, b, [['set.test_audio', 1], ['set.test_image', 0]]));
      entries.push(`\n  <entry in="0" out="${b.frames - 1}" producer="${id}">\n   <property name="kdenlive:id">${b.kdenliveId}</property>\n  </entry>`);
    }
    out.push(trackTractor(3, false, entries.join(''), true));
  }

  // V2: date title (fades out) at the start, "Thanks!" (fades in) ending with the timeline.
  {
    const entries: string[] = [];
    if (titles.length) {
      const [dateTitle, thanks] = titles;
      for (const t of titles) out.push(titleProducerXml(t));
      entries.push(`
  <entry in="0" out="${dateTitle.frames - 1}" producer="${dateTitle.id}">
   <property name="kdenlive:id">${dateTitle.kdenliveId}</property>
   <property name="kdenlive:activeeffect">0</property>
   <filter id="${nextFilter()}" in="${dateTitle.frames - 31}" out="${dateTitle.frames - 1}">
    <property name="start">1</property>
    <property name="level">1</property>
    <property name="mlt_service">brightness</property>
    <property name="kdenlive_id">fade_to_black</property>
    <property name="alpha">0=1;-1=0</property>
   </filter>
  </entry>`);
      const gap = totalFrames - dateTitle.frames - thanks.frames;
      if (gap > 0) entries.push(`\n  <blank length="${gap}"/>`);
      entries.push(`
  <entry in="0" out="${thanks.frames - 1}" producer="${thanks.id}">
   <property name="kdenlive:id">${thanks.kdenliveId}</property>
   <property name="kdenlive:activeeffect">0</property>
   <filter id="${nextFilter()}" in="0" out="35">
    <property name="start">1</property>
    <property name="level">1</property>
    <property name="mlt_service">brightness</property>
    <property name="kdenlive_id">fade_from_black</property>
    <property name="alpha">0=0;-1=1</property>
   </filter>
  </entry>`);
    }
    out.push(trackTractor(4, false, entries.join(''), titles.length > 0));
  }

  // V3: empty.
  out.push(trackTractor(5, false, '', false));

  // Group each clip's audio + video halves so they move together.
  const groups: object[] = [];
  let pos = 0;
  for (const b of bin) {
    if (b.clip.hasAudio) {
      groups.push({
        children: [
          { data: `${TRACK_V1}:${pos}:-1`, leaf: 'clip', type: 'Leaf' },
          { data: `${TRACK_A1}:${pos}:-1`, leaf: 'clip', type: 'Leaf' },
        ],
        type: 'AVSplit',
      });
    }
    pos += b.frames;
  }

  const seqProps: Props = [
    ['kdenlive:uuid', docUuid],
    ['kdenlive:clipname', 'Sequence 1'],
    ['kdenlive:sequenceproperties.hasAudio', 1],
    ['kdenlive:sequenceproperties.hasVideo', 1],
    ['kdenlive:sequenceproperties.activeTrack', 3],
    ['kdenlive:sequenceproperties.tracksCount', 6],
    ['kdenlive:sequenceproperties.documentuuid', docUuid],
    ['kdenlive:control_uuid', docUuid],
    ['kdenlive:duration', framesToClock(totalFrames, FPS)],
    ['kdenlive:maxduration', totalFrames],
    ['kdenlive:producer_type', 17],
    ['kdenlive:id', 3],
    ['kdenlive:clip_type', 0],
    ['kdenlive:file_size', 0],
    ['kdenlive:folderid', 2],
    ['kdenlive:sequenceproperties.audioTarget', TRACK_A1],
    ['kdenlive:sequenceproperties.disablepreview', 0],
    ['kdenlive:sequenceproperties.position', 0],
    ['kdenlive:sequenceproperties.scrollPos', 0],
    ['kdenlive:sequenceproperties.tracks', 6],
    ['kdenlive:sequenceproperties.verticalzoom', 1],
    ['kdenlive:sequenceproperties.videoTarget', TRACK_V1],
    ['kdenlive:sequenceproperties.zonein', 0],
    ['kdenlive:sequenceproperties.zoneout', 75],
    ['kdenlive:sequenceproperties.zoom', 10],
    ['kdenlive:sequenceproperties.groups', JSON.stringify(groups, null, 4)],
    ['kdenlive:sequenceproperties.guides', '[\n]\n'],
  ];
  const transitions: string[] = [];
  for (let t = 1; t <= 6; t++) {
    const audio = t <= 3;
    const p: Props = audio
      ? [
          ['a_track', 0],
          ['b_track', t],
          ['duck_threshold', 0],
          ['duck_attenuation', -12],
          ['duck_level', 0],
          ['duck_fade_in', 1500],
          ['duck_fade_out', 250],
          ['mlt_service', 'mix'],
          ['kdenlive_id', 'mix'],
          ['internal_added', 237],
          ['always_active', 1],
          ['accepts_blanks', 1],
          ['sum', 1],
        ]
      : [
          ['a_track', 0],
          ['b_track', t],
          ['compositing', 0],
          ['distort', 0],
          ['rotate_center', 0],
          ['mlt_service', 'qtblend'],
          ['kdenlive_id', 'qtblend'],
          ['internal_added', 237],
          ['always_active', 1],
        ];
    transitions.push(`  <transition id="transition${t - 1}">\n${props(p, '   ')}\n  </transition>`);
  }
  out.push(` <tractor id="${docUuid}" in="0" out="${totalFrames - 1}">
${props(seqProps, '  ')}
  <track producer="producer0"/>
${[0, 1, 2, 3, 4, 5].map((n) => `  <track producer="tractor${n}"/>`).join('\n')}
${transitions.join('\n')}
 </tractor>`);

  // Bin copies of every clip.
  const binIds: string[] = [];
  for (const b of bin) {
    const id = `chain${chainN++}`;
    binIds.push(id);
    // Opening a project doesn't auto-proxy existing bin clips; this flag makes Kdenlive's
    // Bin::checkMissingProxies() queue them right after load (the same path its document
    // checker uses to recreate missing proxies). Existing cache files and GoPro .LRVs are reused.
    out.push(chainXml(id, b, needsProxy(b.clip) ? [['_replaceproxy', 1]] : []));
  }

  const docProps: Props = [
    ['kdenlive:folder.-1.2', 'Sequences'],
    ['kdenlive:sequenceFolder', 2],
    ['kdenlive:docproperties.audioChannels', 2],
    ['kdenlive:docproperties.binsort', 1],
    ['kdenlive:docproperties.documentid', Date.now()],
    ['kdenlive:docproperties.enableTimelineZone', 0],
    ['kdenlive:docproperties.enableexternalproxy', 1],
    ['kdenlive:docproperties.enableproxy', 1],
    ['kdenlive:docproperties.externalproxyparams', './;GL;.LRV;./;GX;.MP4;./;GP;.LRV;./;GP;.MP4;./;GOPR;.LRV;./;GOPR;.MP4;./;GL;.LRV;./;GH;.MP4'],
    ['kdenlive:docproperties.generateimageproxy', 0],
    ['kdenlive:docproperties.generateproxy', 1],
    ['kdenlive:docproperties.kdenliveversion', '26.08.2'],
    ['kdenlive:docproperties.patchversion', 1],
    ['kdenlive:docproperties.previewextension', ''],
    ['kdenlive:docproperties.previewparameters', ''],
    ['kdenlive:docproperties.profile', 'uhd_2160p_60'],
    ['kdenlive:docproperties.proxyextension', 'mkv'],
    ['kdenlive:docproperties.proxyimageminsize', 2000],
    ['kdenlive:docproperties.proxyimagesize', 800],
    ['kdenlive:docproperties.proxyminsize', PROXY_MIN_WIDTH],
    ['kdenlive:docproperties.proxyparams', '-fps_mode cfr -vf yadif,scale=%width:-2 -qscale 3 -c:v mjpeg -c:a pcm_s16le'],
    ['kdenlive:docproperties.proxyresize', 640],
    ['kdenlive:docproperties.seekOffset', 18000],
    ['kdenlive:docproperties.uuid', docUuid],
    ['kdenlive:docproperties.version', '1.1'],
    ['kdenlive:expandedFolders', ''],
    ['kdenlive:binZoom', 4],
    ['kdenlive:extraBins', 'project_bin:-1:0'],
    ['kdenlive:documentnotes', ''],
    ['kdenlive:documentnotesversion', 2],
    ['kdenlive:docproperties.opensequences', docUuid],
    ['kdenlive:docproperties.activetimeline', docUuid],
    ['xml_retain', 1],
  ];
  const binEntries = [
    `  <entry in="0" out="${totalFrames - 1}" producer="${docUuid}"/>`,
    ...bin.map((b, i) => `  <entry in="0" out="${b.frames - 1}" producer="${binIds[i]}"/>`),
    ...titles.map((t) => `  <entry in="0" out="${t.frames - 1}" producer="${t.id}"/>`),
  ];
  out.push(` <playlist id="main_bin">
${props(docProps, '  ')}
${binEntries.join('\n')}
 </playlist>`);
  out.push(` <tractor id="tractor6" in="0" out="${totalFrames - 1}">
  <property name="kdenlive:projectTractor">1</property>
  <track in="0" out="${totalFrames - 1}" producer="${docUuid}"/>
 </tractor>`);
  out.push('</mlt>');
  return out.join('\n') + '\n';
}
