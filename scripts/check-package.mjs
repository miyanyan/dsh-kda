import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const input = process.argv.slice(2).find(value => value !== '--')
if (input === undefined) {
  throw new Error('usage: node scripts/check-package.mjs <package.tgz|directory>')
}

function archivePath(value) {
  const path = resolve(value)
  if (!existsSync(path)) throw new Error(`package path does not exist: ${path}`)
  if (!statSync(path).isDirectory()) return path
  const archives = readdirSync(path)
    .filter(name => name.endsWith('.tgz'))
    .map(name => join(path, name))
  if (archives.length !== 1) {
    throw new Error(`expected exactly one .tgz in ${path}, found ${archives.length}`)
  }
  return archives[0]
}

function tarEntries(archive) {
  const tar = gunzipSync(readFileSync(archive))
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const readString = (start, length) => header.subarray(start, start + length)
      .toString('utf8')
      .replace(/\0.*$/s, '')
    const name = readString(0, 100)
    const prefix = readString(345, 155)
    const path = prefix === '' ? name : `${prefix}/${name}`
    const sizeText = readString(124, 12).trim()
    const size = sizeText === '' ? 0 : Number.parseInt(sizeText, 8)
    if (!Number.isFinite(size)) throw new Error(`invalid tar entry size for ${path}`)
    const contentStart = offset + 512
    const contentEnd = contentStart + size
    if (contentEnd > tar.length) throw new Error(`truncated tar entry: ${path}`)
    entries.set(path, tar.subarray(contentStart, contentEnd))
    offset = contentStart + Math.ceil(size / 512) * 512
  }
  return entries
}

function exportedPaths(value, paths = []) {
  if (typeof value === 'string' && value.startsWith('./')) {
    paths.push(`package/${value.slice(2)}`)
    return paths
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) exportedPaths(child, paths)
  }
  return paths
}

const archive = archivePath(input)
const entries = tarEntries(archive)
const required = [
  'package/package.json',
  'package/lib/index.js',
  'package/lib/index.d.ts',
  'package/lib/client.js',
  'package/lib/types/client/index.d.ts',
  'package/skills/kda/SKILL.md',
  'package/skills/ncu-report-skill/SKILL.md',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/LICENSE',
]

for (const path of required) {
  if (!entries.has(path)) throw new Error(`package is missing required file: ${path}`)
}

for (const path of entries.keys()) {
  if (/^package\/(src|tests|node_modules)(\/|$)/.test(path)) {
    throw new Error(`package contains development-only path: ${path}`)
  }
}

const manifest = JSON.parse(entries.get('package/package.json').toString('utf8'))
const declaredPaths = [manifest.main, manifest.types, ...exportedPaths(manifest.exports)]
  .filter(value => typeof value === 'string' && value.startsWith('./'))
  .map(value => `package/${value.slice(2)}`)

for (const path of new Set(declaredPaths)) {
  if (!entries.has(path)) throw new Error(`package export does not exist: ${path}`)
}

const expectedName = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
if (basename(archive) !== expectedName) {
  throw new Error(`archive name ${basename(archive)} does not match ${expectedName}`)
}

console.log(`validated ${basename(archive)} (${entries.size} files)`)
