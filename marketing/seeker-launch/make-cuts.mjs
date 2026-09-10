#!/usr/bin/env node
// Cuts the raw phone footage of the Solana dApp Store listing into the four
// masters the launch needs: an X-native 16:9, a 9:16 vertical for TikTok /
// Reels / Shorts, a silent square loop for the site hero and Telegram, and a
// poster frame. Source stays untouched in marketing/seeker-launch/.raw/.
//
//   node marketing/seeker-launch/make-cuts.mjs --in=.raw/seeker-irl.mov \
//     --start=00:00:02.5 --end=00:00:34 --poster=00:00:06
//
// Every output is yuv420p H.264 + faststart so it plays inline everywhere,
// with audio normalised to the -14 LUFS every social platform targets.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, ...rest] = raw.replace(/^--/, '').split('=')
    return [key, rest.length ? rest.join('=') : 'true']
  })
)

function fail (message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function toolOrDie (name) {
  const probe = spawnSync(name, ['-version'], { encoding: 'utf8' })
  if (probe.error) fail(`${name} is not installed. Install ffmpeg, then run this again.`)
  return name
}

function resolveIn (value) {
  return isAbsolute(value) ? value : resolve(HERE, value)
}

function probeDuration (file) {
  const out = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file
  ], { encoding: 'utf8' })
  const seconds = Number.parseFloat(out.stdout)
  return Number.isFinite(seconds) ? seconds : 0
}

function hasAudio (file) {
  const out = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index',
    '-of', 'csv=p=0', file
  ], { encoding: 'utf8' })
  return out.stdout.trim().length > 0
}

function run (label, ffArgs) {
  process.stdout.write(`  ${label} ... `)
  const res = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...ffArgs], {
    encoding: 'utf8'
  })
  if (res.status !== 0) {
    process.stdout.write('failed\n')
    fail(`ffmpeg exited ${res.status} on ${label}:\n${res.stderr}`)
  }
  process.stdout.write('ok\n')
}

// Fit the source inside the target frame rather than cropping it. A phone shot
// vertically must never be centre-cropped into 16:9: the hand and the listing
// are the subject and a crop eats both. The blurred, darkened source fills the
// bars so the frame reads as composed instead of letterboxed.
function fitFilter (width, height) {
  const bg = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=luma_radius=40:luma_power=2,eq=brightness=-0.25[bg]`
  const fg = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`
  return `${bg};${fg};[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`
}

const VIDEO = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-preset', 'slow', '-crf', '20', '-movflags', '+faststart']

const inputArg = args.get('in')
if (!inputArg) fail('Pass the raw file: --in=.raw/seeker-irl.mov (paths are relative to marketing/seeker-launch/).')
const input = resolveIn(inputArg)
if (!existsSync(input)) fail(`No such file: ${input}`)

toolOrDie('ffmpeg')
toolOrDie('ffprobe')

const outDir = resolveIn(args.get('out') || 'cuts')
mkdirSync(outDir, { recursive: true })

const trim = []
if (args.has('start')) trim.push('-ss', args.get('start'))
if (args.has('end')) trim.push('-to', args.get('end'))

const audio = hasAudio(input)
if (!audio) console.log('  note: the source carries no audio track, so the cuts ship silent.')
const audioArgs = audio
  ? ['-af', LOUDNESS, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000']
  : ['-an']

const targets = [
  { name: 'seeker-irl-x-16x9.mp4', w: 1920, h: 1080, sound: audio, label: 'X / LinkedIn 16:9' },
  { name: 'seeker-irl-vertical-9x16.mp4', w: 1080, h: 1920, sound: audio, label: 'TikTok / Reels / Shorts 9:16' },
  { name: 'seeker-irl-loop-1x1.mp4', w: 1080, h: 1080, sound: false, label: 'silent square loop' }
]

console.log(`\n  source ${input} (${probeDuration(input).toFixed(1)}s)\n`)

for (const target of targets) {
  const out = resolve(outDir, target.name)
  run(target.label, [
    ...trim, '-i', input,
    '-filter_complex', fitFilter(target.w, target.h),
    '-map', '[v]',
    ...(target.sound ? ['-map', '0:a?', ...audioArgs] : ['-an']),
    ...VIDEO,
    '-r', '30',
    out
  ])
}

const posterAt = args.get('poster') || args.get('start') || '00:00:01'
const poster = resolve(outDir, 'seeker-irl-poster.jpg')
run('poster frame', ['-ss', posterAt, '-i', input, '-frames:v', '1', '-q:v', '2', poster])

console.log('')
for (const name of [...targets.map((t) => t.name), 'seeker-irl-poster.jpg']) {
  const file = resolve(outDir, name)
  const mb = (statSync(file).size / 1024 / 1024).toFixed(1)
  console.log(`  ${name.padEnd(32)} ${mb.padStart(6)} MB`)
}
console.log(`\n  written to ${outDir}\n`)
