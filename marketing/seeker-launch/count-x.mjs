#!/usr/bin/env node
// Counts every copy block in this directory the way X counts it: a URL is 23
// characters however long it is, a newline is one. Run it after editing the
// copy so the counts table in video-launch.md stays true.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const URL_PATTERN = /(https?:\/\/)?[\w.-]+\.(ws|fun|com|app|xyz|io)(\/\S*)?/g
const X_LIMIT = 280

function blocks (markdown) {
  const found = []
  let heading = ''
  let label = ''
  let inFence = false
  let lang = ''
  let buf = []
  for (const line of markdown.split('\n')) {
    if (line.startsWith('### ')) { heading = line.slice(4); label = heading }
    else if (/^Option [A-Z],/.test(line)) label = `${heading} ${line.split(',')[0]}`
    if (line.startsWith('```')) {
      if (!inFence) { inFence = true; lang = line.slice(3).trim(); buf = [] }
      else { inFence = false; if (lang !== 'bash') found.push({ label, text: buf.join('\n') }) }
      continue
    }
    if (inFence) buf.push(line)
  }
  return found
}

const weight = (text) => text.replace(URL_PATTERN, 'y'.repeat(23)).length

let over = 0
for (const file of readdirSync(HERE).filter((f) => f.endsWith('.md')).sort()) {
  const found = blocks(readFileSync(join(HERE, file), 'utf8'))
  if (!found.length) continue
  console.log(`\n${file}`)
  for (const { label, text } of found) {
    const count = weight(text)
    const isX = /^X[,:]/.test(label)
    const flag = isX && count > X_LIMIT ? `  OVER by ${count - X_LIMIT}` : ''
    if (flag) over += 1
    console.log(`  ${String(count).padStart(4)}  ${(label || 'unlabelled').padEnd(46)}${flag}`)
  }
}
console.log(over ? `\n  ${over} X block(s) over ${X_LIMIT}.\n` : `\n  every X block fits ${X_LIMIT}.\n`)
process.exit(over ? 1 : 0)
