#!/usr/bin/env node
// Counts every copy block in this directory the way X counts it: a URL is 23
// characters however long it is, a newline is one. Run it after editing the
// copy so the counts table in video-launch.md stays true.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGES = resolve(HERE, '../../data/pages.json')
const URL_PATTERN = /(https?:\/\/)?[\w.-]+\.(ws|fun|com|app|xyz|io)(\/\S*)?/g
const X_LIMIT = 280
// A block headed "long form" is a Premium post and is allowed the long-post
// ceiling instead. Everything else has to survive on a free account.
const X_PREMIUM_LIMIT = 25000

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

// Copy that links a page which no longer exists is worse than copy with a typo:
// it sends a launch audience to a 404. Every three.ws path in the copy is
// checked against the route table the sitemap is built from.
function knownPaths () {
  const data = JSON.parse(readFileSync(PAGES, 'utf8'))
  const paths = new Set()
  for (const section of data.sections || []) {
    for (const page of section.pages || []) paths.add(page.path)
  }
  return paths
}

function deadLinks (text, paths) {
  const found = text.match(/three\.ws(\/[\w\-./]*)?/g) || []
  return found
    .map((hit) => hit.slice('three.ws'.length).replace(/[.]$/, ''))
    .filter((path) => path && path !== '/')
    .filter((path) => !paths.has(path))
}

const paths = knownPaths()
let over = 0
let dead = 0
for (const file of readdirSync(HERE).filter((f) => f.endsWith('.md')).sort()) {
  const found = blocks(readFileSync(join(HERE, file), 'utf8'))
  if (!found.length) continue
  console.log(`\n${file}`)
  for (const { label, text } of found) {
    const count = weight(text)
    const isX = /^X[,:]/.test(label)
    const limit = /long form/i.test(label) ? X_PREMIUM_LIMIT : X_LIMIT
    const flag = isX && count > limit ? `  OVER by ${count - limit}` : ''
    if (flag) over += 1
    console.log(`  ${String(count).padStart(4)}  ${(label || 'unlabelled').padEnd(46)}${flag}`)
    for (const path of deadLinks(text, paths)) {
      dead += 1
      console.log(`        no such page: three.ws${path}`)
    }
  }
}
console.log(over ? `\n  ${over} X block(s) over the limit.` : `\n  every X block fits its limit (${X_LIMIT}, or ${X_PREMIUM_LIMIT} for a long-form post).`)
console.log(dead ? `  ${dead} link(s) point at a page that does not exist.\n` : '  every three.ws link resolves to a page in data/pages.json.\n')
process.exit(over + dead ? 1 : 0)
