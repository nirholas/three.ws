// @ts-check
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RESOURCES_DIR = path.join(__dirname, '..', 'resources')
const EMBED_DIR = path.join(RESOURCES_DIR, 'python-embed')

// python-build-standalone provides a full Python installation (includes venv + pip)
// Used for ALL platforms: consistent behavior, no stripped-down embed issues.
const PBS_VERSION = '3.11.9'
const PBS_RELEASE = '20240726'

// The target defaults to the host. Release builds pass --platform and --arch
// so one Linux machine can package the Windows installer with a Windows Python.
function parseTarget(argv) {
  const target = { platform: process.platform, arch: process.arch }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform') target.platform = argv[++i]
    else if (argv[i] === '--arch') target.arch = argv[++i]
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (!['win32', 'darwin', 'linux'].includes(target.platform)) throw new Error(`Unsupported platform: ${target.platform}`)
  if (!['x64', 'arm64'].includes(target.arch)) throw new Error(`Unsupported arch: ${target.arch}`)
  return target
}

function getPbsUrl({ platform, arch: nodeArch }) {
  const arch = nodeArch === 'arm64' ? 'aarch64' : 'x86_64'
  const triple = platform === 'win32'
    ? `${arch}-pc-windows-msvc`
    : platform === 'darwin'
      ? `${arch}-apple-darwin`
      : `${arch}-unknown-linux-gnu`
  return (
    `https://github.com/indygreg/python-build-standalone/releases/download/` +
    `${PBS_RELEASE}/cpython-${PBS_VERSION}+${PBS_RELEASE}-${triple}-install_only.tar.gz`
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} → ${dest}`)
    const file = fs.createWriteStream(dest)
    const request = (u) => {
      https.get(u, { headers: { 'User-Agent': 'forge-build' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          request(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          return
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        res.on('data', (chunk) => {
          received += chunk.length
          if (total > 0) {
            const pct = Math.round((received / total) * 100)
            process.stdout.write(`\r  ${pct}% (${Math.round(received / 1024 / 1024)} MB)`)
          }
        })
        res.pipe(file)
        res.on('end', () => {
          process.stdout.write('\n')
          file.close(() => resolve())
        })
      }).on('error', reject)
    }
    request(url)
    file.on('error', reject)
  })
}

function extractTar(tarPath, destDir) {
  console.log(`Extracting ${tarPath} → ${destDir}`)
  fs.mkdirSync(destDir, { recursive: true })
  // --strip-components=1 removes the top-level "python/" directory from the archive
  execSync(`tar -xzf "${tarPath}" --strip-components=1 -C "${destDir}"`, { stdio: 'inherit' })
  if (process.platform === 'darwin') {
    // Quarantine flags only exist on a Mac host; elsewhere there is nothing to clear.
    try { execSync(`xattr -cr "${destDir}"`) } catch { console.warn('xattr -cr failed; Gatekeeper may flag the bundled Python') }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const target = parseTarget(process.argv.slice(2))
  const targetKey = `${target.platform}-${target.arch}-${PBS_VERSION}+${PBS_RELEASE}`
  const markerPath = path.join(EMBED_DIR, '.target')
  fs.mkdirSync(RESOURCES_DIR, { recursive: true })

  const pythonExe = target.platform === 'win32'
    ? path.join(EMBED_DIR, 'python.exe')
    : path.join(EMBED_DIR, 'bin', 'python3')
  const presentKey = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : null

  if (fs.existsSync(pythonExe) && (presentKey === targetKey || presentKey === null && target.platform === process.platform && target.arch === process.arch)) {
    console.log(`python-embed for ${targetKey} already present, skipping.`)
    return
  }
  // A different platform's Python is in place (a Linux build ran before the
  // Windows one): replace it rather than ship the wrong interpreter.
  fs.rmSync(EMBED_DIR, { recursive: true, force: true })

  const tarUrl = getPbsUrl(target)
  const tarTmp = path.join(RESOURCES_DIR, 'python-embed.tar.gz')
  await download(tarUrl, tarTmp)
  extractTar(tarTmp, EMBED_DIR)
  fs.unlinkSync(tarTmp)
  fs.writeFileSync(markerPath, `${targetKey}\n`)
  console.log(`Done. Python standalone ${targetKey} extracted.`)
}

main().catch((err) => {
  console.error('ERROR:', err.message)
  process.exit(1)
})
