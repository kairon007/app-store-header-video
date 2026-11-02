#!/usr/bin/env node
// verify-video.mjs — check a video against Apple's App Store creative-asset spec.
//
// Usage:
//   node scripts/verify-video.mjs <file> [--placement header|search|auto] [--json]
//
// Exits 0 when every hard check passes, 1 when a check fails, 2 on a setup error.
//
// Spec source:
//   https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const PLACEMENTS = {
  header: {
    label: 'product page header (21:9)',
    exact: { width: 3840, height: 1646 },
  },
  search: {
    label: 'search results (3:2)',
    min: { width: 1920, height: 1280 },
    max: { width: 3840, height: 2560 },
    ratio: 3 / 2,
    ratioTolerance: 0.01,
  },
};

const ACCEPTED_EXTENSIONS = ['.mov', '.m4v', '.mp4'];
const ALPHA_PIXEL_FORMATS = /^(yuva|rgba|argb|abgr|bgra|ya8|pal8)/;
const MAX_FILE_SIZE_BYTES = 524288000; // 500 MB, from Apple's asset reference data
const IMPERCEPTIBLE_MAX_DIFF = 12; // luma levels out of 255 — below this the wrap cannot be seen

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('Usage: node scripts/verify-video.mjs <file> [--placement header|search|auto] [--json]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { file: null, placement: 'auto', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--placement') {
      args.placement = argv[++i];
      if (!args.placement) usage('--placement needs a value');
    } else if (arg.startsWith('--placement=')) {
      args.placement = arg.slice('--placement='.length);
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('-')) {
      usage(`unknown option ${arg}`);
    } else if (!args.file) {
      args.file = arg;
    } else {
      usage('only one file may be given');
    }
  }
  if (!args.file) usage('a video file is required');
  if (!PLACEMENTS[args.placement] && args.placement !== 'auto') {
    usage(`unknown placement "${args.placement}"`);
  }
  return args;
}

function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function probe(file) {
  const raw = run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const parsed = JSON.parse(raw);
  const streams = parsed.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video) throw new Error('no video stream found in this file');
  return { video, audio, format: parsed.format || {} };
}

function parseRate(rate) {
  if (!rate) return null;
  const [num, den] = String(rate).split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function rationalText(rate) {
  return rate ? String(rate) : 'unknown';
}

// ffmpeg writes its summary to stderr, so this captures both streams and
// never throws on a non-zero exit.
function ff(cmdArgs) {
  const result = spawnSync('ffmpeg', cmdArgs, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

// Count the frames without decoding them.
function frameCount(file) {
  const out = run('ffprobe', [
    '-v', 'error', '-count_packets', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0',
    file,
  ]);
  const n = Number(String(out).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Compare the first and last frame with PSNR. A clean loop makes them nearly
// identical; a hard cut scores far lower.
//
// The absolute PSNR depends on how busy the footage is, so the verdict is
// relative: the wrap has to be no more disruptive than the video's own
// frame-to-frame motion. The baseline is the median of several adjacent frame
// pairs sampled across the clip, not the final pair — a loop that
// deliberately decelerates into its wrap has a near-zero final step, and
// judging against that would flag almost any wrap as broken.
function seamCheck(file, video) {
  const outDir = dirname(resolve(file));
  const stem = basename(file).replace(/\.[^.]+$/, '');
  const seamPath = join(outDir, `${stem}-seam.png`);
  const framePattern = join(outDir, `.${stem}-f-%03d.png`);
  let sampled = [];

  try {
    const total = frameCount(file);
    if (!total) throw new Error('could not count the frames');
    if (total < 8) throw new Error(`only ${total} frame(s) — too few to judge the loop`);

    // Sample the first frame, the last two, and five adjacent pairs spread
    // across the body of the clip.
    const pairIndices = [];
    const wanted = [0];
    for (const frac of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const n = Math.round(frac * (total - 1));
      pairIndices.push(n);
      wanted.push(n, n + 1);
    }
    wanted.push(total - 2, total - 1);
    const unique = [...new Set(wanted)].sort((a, b) => a - b);
    const pathFor = (n) =>
      framePattern.replace('%03d', String(unique.indexOf(n) + 1).padStart(3, '0'));

    const sel = unique.map((n) => `eq(n\\,${n})`).join('+');
    const grab = ff([
      '-v', 'error', '-y', '-i', file,
      '-vf', `select=${sel}`,
      '-fps_mode', 'vfr',
      framePattern,
    ]);
    if (grab.status !== 0) throw new Error(grab.stderr || 'frame extraction failed');
    sampled = unique.map((n) => pathFor(n));

    const psnr = (a, b) => {
      const result = ff([
        '-hide_banner', '-i', a, '-i', b,
        '-lavfi', 'psnr', '-f', 'null', '-',
      ]);
      const text = `${result.stderr || ''}${result.stdout || ''}`;
      const match = text.match(/average:([\d.]+|inf)/);
      return match ? (match[1] === 'inf' ? Infinity : Number(match[1])) : null;
    };

    // PSNR is a whole-frame average, so a small bright element jumping can
    // hide inside it. The brightest pixel in the difference image catches
    // exactly that case.
    const maxDiff = (a, b) => {
      const result = ff([
        '-hide_banner', '-i', a, '-i', b,
        '-filter_complex',
        '[0:v][1:v]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YMAX',
        '-f', 'null', '-',
      ]);
      const text = `${result.stderr || ''}${result.stdout || ''}`;
      const match = text.match(/YMAX=([\d.]+)/);
      return match ? Number(match[1]) : null;
    };

    const first = pathFor(0);
    const last = pathFor(total - 1);
    const prev = pathFor(total - 2);

    const seamPsnr = psnr(first, last);
    const endPsnr = psnr(prev, last);

    const samples = pairIndices
      .map((n) => psnr(pathFor(n), pathFor(n + 1)))
      .filter((v) => v !== null)
      .sort((a, b) => a - b);
    const motionPsnr = samples.length ? samples[Math.floor(samples.length / 2)] : null;

    const seamMax = maxDiff(first, last);
    const motionMax = maxDiff(prev, last);

    // The strip is a convenience for eyeballing; the numbers are the check.
    ff([
      '-v', 'error', '-y', '-i', first, '-i', last,
      '-filter_complex', '[0:v][1:v]hstack=inputs=2,scale=1600:-1',
      seamPath,
    ]);

    return { psnr: seamPsnr, motionPsnr, endPsnr, seamMax, motionMax, seamPath, frames: total };
  } catch (err) {
    return {
      psnr: null, motionPsnr: null, endPsnr: null,
      seamMax: null, motionMax: null, seamPath: null, error: err.message,
    };
  } finally {
    for (const p of sampled) {
      try { rmSync(p, { force: true }); } catch { /* best effort */ }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = resolve(args.file);

  if (!existsSync(file)) {
    console.error(`error: file not found: ${file}`);
    process.exit(2);
  }

  let info;
  try {
    info = probe(file);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('error: ffprobe not found. Install it with "brew install ffmpeg" (macOS) or "choco install ffmpeg" (Windows).');
      process.exit(2);
    }
    console.error(`error: could not probe ${file}: ${err.message}`);
    process.exit(2);
  }

  const { video, audio, format } = info;
  const width = Number(video.width);
  const height = Number(video.height);
  const duration = Number(format.duration || video.duration || 0);
  const rRate = parseRate(video.r_frame_rate);
  const aRate = parseRate(video.avg_frame_rate);
  const extension = `.${(basename(file).split('.').pop() || '').toLowerCase()}`;

  // Which placement is this file meant for?
  let placement = args.placement;
  if (placement === 'auto') {
    if (width === 3840 && height === 1646) placement = 'header';
    else if (Math.abs(width / height - 1.5) < 0.02) placement = 'search';
    else placement = 'header';
  }
  const spec = PLACEMENTS[placement];

  const checks = [];
  const add = (status, name, detail) => checks.push({ status, name, detail });

  // Container
  if (ACCEPTED_EXTENSIONS.includes(extension)) {
    add('PASS', 'container', `${extension} — Apple accepts .mov, .m4v, .mp4`);
  } else {
    add('FAIL', 'container', `${extension} — Apple accepts only .mov, .m4v, .mp4`);
  }

  // Resolution
  if (spec.exact) {
    if (width === spec.exact.width && height === spec.exact.height) {
      add('PASS', 'resolution', `${width}x${height} (exact)`);
    } else {
      add('FAIL', 'resolution', `${width}x${height} — must be exactly ${spec.exact.width}x${spec.exact.height}`);
    }
  } else {
    const ratio = width / height;
    const ratioOk = Math.abs(ratio - spec.ratio) <= spec.ratioTolerance;
    const inBounds =
      width >= spec.min.width && width <= spec.max.width &&
      height >= spec.min.height && height <= spec.max.height;
    if (ratioOk && inBounds) {
      add('PASS', 'resolution', `${width}x${height} (3:2, within ${spec.min.width}x${spec.min.height}–${spec.max.width}x${spec.max.height})`);
    } else if (!ratioOk) {
      add('FAIL', 'resolution', `${width}x${height} — aspect ${ratio.toFixed(3)} is not 3:2`);
    } else {
      add('FAIL', 'resolution', `${width}x${height} — outside the allowed ${spec.min.width}x${spec.min.height}–${spec.max.width}x${spec.max.height} range`);
    }
  }

  // Frame rate
  if (rRate === null) {
    add('FAIL', 'frame rate', 'could not read r_frame_rate');
  } else if (Math.abs(rRate - 30) < 0.001) {
    if (aRate !== null && Math.abs(aRate - 30) > 0.001) {
      add('FAIL', 'frame rate', `r_frame_rate 30 but avg_frame_rate ${aRate.toFixed(3)} — variable frame rate, re-encode with a constant fps`);
    } else {
      add('PASS', 'frame rate', '30 fps, constant');
    }
  } else if (Math.abs(rRate - 60) < 0.001) {
    if (aRate !== null && Math.abs(aRate - 60) > 0.001) {
      add('FAIL', 'frame rate', `r_frame_rate 60 but avg_frame_rate ${aRate.toFixed(3)} — variable frame rate, re-encode with a constant fps`);
    } else {
      add('PASS', 'frame rate', '60 fps, constant');
    }
  } else {
    const exact = Math.abs(rRate - 30) < 0.01 || Math.abs(rRate - 60) < 0.01;
    add('FAIL', 'frame rate', `${rRate.toFixed(3)} fps (${rationalText(video.r_frame_rate)}) — Apple accepts exactly 30 or 60${exact ? '' : '; 29.97 / 59.94 are not accepted'}`);
  }

  // Duration
  if (duration <= 0) {
    add('FAIL', 'duration', 'could not read the duration');
  } else if (duration < 5) {
    add('FAIL', 'duration', `${duration.toFixed(2)} s — Apple requires at least 5 s`);
  } else if (duration > 30) {
    add('FAIL', 'duration', `${duration.toFixed(2)} s — Apple allows at most 30 s`);
  } else {
    const nearEdge = duration < 5.2 || duration > 29.8;
    add(
      nearEdge ? 'WARN' : 'PASS',
      'duration',
      `${duration.toFixed(2)} s (Apple allows 5–30 s)${nearEdge ? ' — too close to the limit, pad it' : ''}`,
    );
  }

  // Codec
  const codec = String(video.codec_name || '').toLowerCase();
  if (codec === 'h264') {
    add('PASS', 'codec', 'h264');
  } else if (codec === 'hevc' || codec === 'h265' || codec === 'vp9') {
    add('WARN', 'codec', `${codec} — Apple does not publish a codec rule for creative assets, but H.264 is the safe choice`);
  } else {
    add('WARN', 'codec', `${codec || 'unknown'} — re-encode as H.264 to be safe`);
  }

  // Pixel format / alpha
  const pixFmt = String(video.pix_fmt || '');
  if (!pixFmt) {
    add('WARN', 'pixel format', 'could not read pix_fmt');
  } else if (ALPHA_PIXEL_FORMATS.test(pixFmt)) {
    add('FAIL', 'pixel format', `${pixFmt} — contains an alpha channel; use yuv420p`);
  } else if (pixFmt !== 'yuv420p') {
    add('WARN', 'pixel format', `${pixFmt} — yuv420p is the safest for App Store playback`);
  } else {
    add('PASS', 'pixel format', 'yuv420p (no alpha)');
  }

  // Audio
  if (audio) {
    const note = placement === 'search'
      ? 'search results videos can never be unmuted'
      : 'product page videos play muted by default but can be unmuted';
    add('WARN', 'audio', `1 audio stream present — the video plays muted anyway (${note}); strip it with conform-video.mjs --keep-audio off`);
  } else {
    add('PASS', 'audio', 'no audio track (video plays muted by design)');
  }

  // Loop seam
  const seam = seamCheck(file, video);
  if (seam.psnr === null) {
    add('WARN', 'loop seam', `could not compare the first and last frame${seam.error ? `: ${seam.error}` : ''}`);
  } else if (seam.psnr === Infinity) {
    add('PASS', 'loop seam', 'the first and last frame are identical');
  } else if (seam.motionPsnr === Infinity) {
    add('FAIL', 'loop seam', 'the clip barely changes from frame to frame, yet the wrap differs from the first frame — the restart will jump');
  } else if (seam.motionPsnr === null) {
    add('WARN', 'loop seam', `wrap is ${seam.psnr.toFixed(1)} dB — no motion baseline to compare against`);
  } else {
    // Both numbers are MSE-like; the ratio says whether the wrap is louder
    // than the clip's typical frame-to-frame motion.
    const ratio = Math.pow(10, -seam.psnr / 10) / Math.pow(10, -seam.motionPsnr / 10);
    const detail = `wrap ${seam.psnr.toFixed(1)} dB vs ${seam.motionPsnr.toFixed(1)} dB of typical frame-to-frame motion`;
    const peak = seam.seamMax === null
      ? ''
      : `, brightest pixel differs by ${seam.seamMax.toFixed(0)}/255`;
    if (seam.seamMax !== null && seam.seamMax <= IMPERCEPTIBLE_MAX_DIFF) {
      // The whole-frame average can flag a wrap that no eye can see. If even
      // the brightest pixel barely moved, the wrap is invisible.
      add('PASS', 'loop seam', `the wrap is imperceptible — ${peak}, ${detail}`);
    } else if (ratio <= 1.5) {
      add('PASS', 'loop seam', `the wrap is as smooth as the clip's own motion — ${detail}${peak}`);
    } else if (ratio <= 4) {
      add('WARN', 'loop seam', `the wrap is ${ratio.toFixed(1)}x the typical motion, so a soft jump may be visible — ${detail}${peak}`);
    } else {
      add('FAIL', 'loop seam', `the wrap is ${ratio.toFixed(1)}x the typical motion, so the last frame does not flow into the first — ${detail}${peak}. If this file came from a draft-quality render, the difference may be codec noise rather than geometry: re-encode at delivery quality and check again`);
    }
  }

  // File size — Apple caps creative assets at 500 MB.
  const sizeBytes = Number(format.size || 0);
  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    add('FAIL', 'file size', `${sizeMb.toFixed(1)} MB — Apple's limit is 500 MB`);
  } else if (sizeMb > 450) {
    add('WARN', 'file size', `${sizeMb.toFixed(1)} MB — close to Apple's 500 MB limit`);
  } else {
    add('PASS', 'file size', `${sizeMb.toFixed(1)} MB (Apple allows up to 500 MB)`);
  }

  // Informational
  const notes = [
    seam.seamPath ? `seam preview ${seam.seamPath}` : null,
  ].filter(Boolean);

  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const warned = checks.filter((c) => c.status === 'WARN').length;
  const passed = checks.filter((c) => c.status === 'PASS').length;

  if (args.json) {
    console.log(JSON.stringify({
      file,
      placement,
      placementLabel: spec.label,
      width,
      height,
      duration,
      rFrameRate: video.r_frame_rate,
      avgFrameRate: video.avg_frame_rate,
      codec: video.codec_name,
      pixFmt: video.pix_fmt,
      seamPsnr: seam.psnr === Infinity ? 'inf' : seam.psnr,
      motionPsnr: seam.motionPsnr === Infinity ? 'inf' : seam.motionPsnr,
      seamMaxDiff: seam.seamMax,
      motionMaxDiff: seam.motionMax,
      seamPreview: seam.seamPath,
      sizeMb: Number(sizeMb.toFixed(2)),
      passed,
      warned,
      failed,
      checks,
    }, null, 2));
  } else {
    console.log('Apple App Store creative-asset verification');
    console.log(`File:      ${file}`);
    console.log(`Placement: ${spec.label}`);
    console.log('');
    for (const c of checks) {
      console.log(`[${c.status}] ${c.name.padEnd(14)} ${c.detail}`);
    }
    console.log('');
    for (const n of notes) console.log(`[INFO] ${n}`);
    console.log('');
    console.log(`${passed} passed, ${warned} warning${warned === 1 ? '' : 's'}, ${failed} failed`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
