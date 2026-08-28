import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = process.argv.slice(2).find(value => value !== '--') ?? process.env.GITHUB_REF_NAME
if (tag === undefined || tag.trim() === '') {
  throw new Error('release tag is required as an argument or GITHUB_REF_NAME')
}

const expected = `v${manifest.version}`
if (tag !== expected) {
  throw new Error(`release tag ${JSON.stringify(tag)} must match package version ${JSON.stringify(expected)}`)
}

console.log(`release tag ${tag} matches package version ${manifest.version}`)
