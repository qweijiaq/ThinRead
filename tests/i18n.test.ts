import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { countUnit, getLocale, hasTranslation, setLocale } from '../src/lib/i18n.js'

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.tsx?$/.test(entry.name) && !full.endsWith(`${path.sep}lib${path.sep}i18n.ts`)) files.push(full)
  }
  return files
}

test('every literal passed to t() has an English translation', () => {
  const missing = new Set<string>()
  for (const file of walk(path.join(process.cwd(), 'src'))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
      const key = match[2]!
      if (!key || !hasTranslation(key)) missing.add(`${key} (${path.relative(process.cwd(), file)})`)
    }
  }
  assert.deepEqual([...missing].sort(), [], `缺少英文翻译：\n${[...missing].sort().join('\n')}`)
})

test('countUnit uses singular forms in English and a single form in Chinese', () => {
  const previous = getLocale()
  try {
    setLocale('en')
    assert.equal(countUnit(1, 'books', 'book'), 'book')
    assert.equal(countUnit(2, 'books', 'book'), 'books')
    setLocale('zh')
    assert.equal(countUnit(1, '本书', 'book'), '本书')
  } finally {
    setLocale(previous)
  }
})
