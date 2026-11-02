#!/usr/bin/env node
// conform-video.mjs — conform any clip to Apple's App Store creative-asset spec.
//
// Usage:
//   node scripts/conform-video.mjs --in <src> --out <dst> [options]
//
// Options:
//   --placement header|search   target canvas (default: header)
//   --size WxH                  explicit target size (overrides the placement)
//   --fps 30|60                 output frame rate (default: 30)
//   --duration <sec>            target length (default: the source length, capped at 30)
//   --loop-fill                 repeat the source with -stream_loop when it is shorter than the target
//   --seam-crossfade <sec>      make a non-looping clip loop by dissolving its tail into its head
//   --keep-audio                keep the audio track (default: strip it)
//   --format mp4|mov|m4v        container (default: taken from the output extension)
//
// The conformed file is still verified separately — run verify-video.mjs on it.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

const PLACEMENTS = {
  header: { label: 'product page header (21:9)', width: 3840, height: 1646, exact: true },
  search: { label: 'search results (3:2)', width: 3840, height: 2560, exact: false },
};

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error('Usage: node scripts/conform-video.mjs --in <src> --out <dst> [--placement header|search] [--size WxH] [--fps 30|60] [--duration <sec>] [--loop-fill] [--seam-crossfade <sec>] [--keep-audio]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    in: null, out: null, placement: 'header', size: null,
    fps: 30, duration: null, loopFill: false, seamCrossfade: null,
    keepAudio: false, format: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = () => {
      const value = argv[++i];
      if (value === undefined) usage(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '--in': args.in = takeValue(); break;
      case '--out': args.out = takeValue(); break;
      case '--placement': args.placement = takeValue(); break;
      case '--size': args.size = takeValue(); break;
      case '--fps': args.fps = Number(takeValue()); break;
      case '--duration': args.duration = Number(takeValue()); break;
      case '--seam-crossfade': args.seamCrossfade = Number(takeValue()); break;
      case '--loop-fill': args.loopFill = true; break;
      case '--keep-audio': args.keepAudio = true; break;
      case '--format': args.format = takeValue(); break;
      default:
        if (arg.startsWith('--in=')) args.in = arg.slice(5);
        else if (arg.startsWith('--out=')) args.out = arg.slice(6);
        else if (arg.startsWith('--placement=')) args.placement = arg.slice(13);
        else if (arg.startsWith('--size=')) args.size = arg.slice(7);
        else if (arg.startsWith('--fps=')) args.fps = Number(arg.slice(6));
        else if (arg.startsWith('--duration=')) args.duration = Number(arg.slice(11));
        else if (arg.startsWith('--seam-crossfade=')) args.seamCrossfade = Number(arg.slice(17));
        else if (arg.startsWith('--format=')) args.format = arg.slice(9);
        else usage(`unknown option ${arg}`);
    }
  }
  if (!args.in) usage('--in is required');
  if (!args.out) usage('--out is required');
  if (!PLACEMENTS[args.placement]) usage(`unknown placement "${args.placement}"`);
  if (![30, 60].includes(args.fps)) usage('--fps must be 30 or 60');
  if (args.duration !== null && (!Number.isFinite(args.duration) || args.duration <= 0)) {
    usage('--duration must be a positive number of seconds');
  }
  if (args.seamCrossfade !== null && (!Number.isFinite(args.seamCrossfade) || args.seamCrossfade <= 0)) {
    usage('--seam-crossfade must be a positive number of seconds');
  }
  return args;
}

function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function probe(file) {
  const raw = run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const parsed = JSON.parse(raw);
  const video = (parsed.streams || []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error('no video stream found in this file');
  return {
    width: Number(video.width),
    height: Number(video.height),
    duration: Number(parsed.format?.duration || video.duration || 0),
    fps: video.r_frame_rate,
  };
}

function parseSize(size, placement) {
  if (!size) {
    const spec = PLACEMENTS[placement];
    return { width: spec.width, height: spec.height };
  }
  const match = String(size).match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) usage(`--size must look like 3840x1646 (got "${size}")`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 2 !== 0 || height % 2 !== 0) {
    usage(`--size must have even dimensions for H.264 (got ${width}x${height})`);
  }
  return { width, height };
}

function validateTarget(placement, width, height) {
  if (placement === 'header') {
    if (width !== 3840 || height !== 1646) {
      console.error(`error: the product page header must be exactly 3840x1646 (got ${width}x${height}).`);
      process.exit(2);
    }
    return;
  }
  const ratio = width / height;
  if (Math.abs(ratio - 1.5) > 0.01) {
    console.error(`error: the search results asset must be 3:2 (got ${width}x${height}, ratio ${ratio.toFixed(3)}).`);
    process.exit(2);
  }
  if (width < 1920 || width > 3840 || height < 1280 || height > 2560) {
    console.error(`error: the search results asset must be between 1920x1280 and 3840x2560 (got ${width}x${height}).`);
    process.exit(2);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = resolve(args.in);
  const output = resolve(args.out);

  if (!existsSync(source)) {
    console.error(`error: source file not found: ${source}`);
    process.exit(2);
  }

  let sourceInfo;
  try {
    sourceInfo = probe(source);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('error: ffprobe not found. Install it with "brew install ffmpeg" (macOS) or "choco install ffmpeg" (Windows).');
      process.exit(2);
    }
    console.error(`error: could not probe ${source}: ${err.message}`);
    process.exit(2);
  }

  const target = parseSize(args.size, args.placement);
  validateTarget(args.placement, target.width, target.height);
  const spec = PLACEMENTS[args.placement];

  // Duration
  let duration = args.duration ?? Math.min(sourceInfo.duration, 30);
  duration = Math.min(duration, 30);
  if (sourceInfo.duration < duration && !args.loopFill) {
    console.error(
      `error: the source is ${sourceInfo.duration.toFixed(2)} s but the target is ${duration.toFixed(2)} s.\n` +
      'Pass --loop-fill to repeat the source, or lower --duration.',
    );
    process.exit(2);
  }
  if (args.loopFill && sourceInfo.duration > 0) {
    duration = Math.min(duration, 30);
  }

  // Seam crossfade validation
  const crossfade = args.seamCrossfade;
  if (crossfade !== null) {
    if (crossfade >= duration / 2) {
      console.error(`error: --seam-crossfade must be less than half the target duration (${(duration / 2).toFixed(2)} s).`);
      process.exit(2);
    }
    if (duration - crossfade < 5) {
      console.error(`error: crossfading ${crossfade} s leaves ${(duration - crossfade).toFixed(2)} s, below Apple's 5 s minimum.`);
      process.exit(2);
    }
    if (sourceInfo.duration < crossfade * 2) {
      console.error(`error: --seam-crossfade ${crossfade} s needs a source at least ${(crossfade * 2).toFixed(2)} s long (source is ${sourceInfo.duration.toFixed(2)} s).`);
      process.exit(2);
    }
  }

  // Upscale warning
  const scaleFactor = Math.max(target.width / sourceInfo.width, target.height / sourceInfo.height);
  const upscaling = scaleFactor > 1.001;

  const inputArgs = [];
  if (args.loopFill) inputArgs.push('-stream_loop', '-1');
  inputArgs.push('-i', source);

  const base = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase`,
    `crop=${target.width}:${target.height}`,
    `fps=${args.fps}`,
    'format=yuv420p',
    'setsar=1',
  ];

  let filterComplex;
  let outputDuration = duration;
  if (crossfade !== null) {
    filterComplex = [
      `[0:v]${base.join(',')},trim=duration=${duration}[base]`,
      '[base]split[ma][mb]',
      `[ma]trim=duration=${duration - crossfade},setpts=PTS-STARTPTS[main]`,
      `[mb]trim=start=${duration - crossfade},setpts=PTS-STARTPTS[tail]`,
      `[tail][main]xfade=transition=fade:duration=${crossfade}:offset=0[v]`,
    ].join(';');
    outputDuration = duration - crossfade;
  } else {
    filterComplex = `[0:v]${base.join(',')}[v]`;
  }

  const outputExtension = output.split('.').pop().toLowerCase();
  const container = args.format || (outputExtension === 'mov' ? 'mov' : 'mp4');

  const ffmpegArgs = [
    '-v', 'error', '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'slow',
  ];
  if (container === 'mp4') ffmpegArgs.push('-movflags', '+faststart');
  if (args.keepAudio) ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k');
  else ffmpegArgs.push('-an');
  ffmpegArgs.push('-t', String(outputDuration), output);

  try {
    run('ffmpeg', ffmpegArgs);
  } catch (err) {
    console.error(`error: ffmpeg failed:\n${err.stderr || err.message}`);
    process.exit(1);
  }

  const result = probe(output);

  console.log(`Conformed ${source}`);
  console.log(`  placement    ${spec.label}`);
  console.log(`  source       ${sourceInfo.width}x${sourceInfo.height}, ${sourceInfo.duration.toFixed(2)} s`);
  console.log(`  output       ${result.width}x${result.height}, ${result.duration.toFixed(2)} s, ${args.fps} fps, ${container}`);
  console.log(`  file         ${output}`);
  if (upscaling) {
    console.log(`  note         the source was upscaled ${scaleFactor.toFixed(2)}x — text will be softer than a native render`);
  }
  if (crossfade !== null) {
    console.log(`  note         ${crossfade} s of the tail was dissolved into the head, so the clip is ${outputDuration.toFixed(2)} s`);
  }
  if (outputDuration < 5) {
    console.log(`  note         ${outputDuration.toFixed(2)} s is below Apple's 5 s minimum, so this will fail verification — use --loop-fill to repeat a short source`);
  }
  console.log('');
  console.log(`Next: node ${join(SELF_DIR, 'verify-video.mjs')} ${output} --placement ${args.placement}`);
}

main();
