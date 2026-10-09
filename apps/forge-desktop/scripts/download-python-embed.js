// @ts-check
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RESOURCES_DIR = path.join(__dirname, '..', 'resources')
const EMBED_DIR = path.join(RESOURCES_DIR, 'python-embed')

// python-build-standalone provides a full Python installation (includes venv + pip)
// Used for ALL platforms — consistent behavior, no stripped-down embed issues.
const PBS_VERSION = '3.11.9'
const PBS_RELEASE = '20240726'

function getPbsUrl() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  const triple = process.platform === 'win32'
    ? `${arch}-pc-windows-msvc`
    : process.platform === 'darwin'
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
      https.get(u, { headers: { 'User-Agent': 'modly-build' } }, (res) => {
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
    try { execSync(`xattr -cr "${destDir}"`) } catch {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(RESOURCES_DIR, { recursive: true })

  const pythonExe = process.platform === 'win32'
    ? path.join(EMBED_DIR, 'python.exe')
    : path.join(EMBED_DIR, 'bin', 'python3')

  if (fs.existsSync(pythonExe)) {
    console.log('python-embed already present, skipping.')
    return
  }

  const tarUrl = getPbsUrl()
  const tarTmp = path.join(RESOURCES_DIR, 'python-embed.tar.gz')
  await download(tarUrl, tarTmp)
  extractTar(tarTmp, EMBED_DIR)
  fs.unlinkSync(tarTmp)
  console.log('Done. Python standalone extracted.')
}

main().catch((err) => {
  console.error('ERROR:', err.message)
  process.exit(1)
})
