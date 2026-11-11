import assert from 'node:assert/strict'
import test from 'node:test'

import { citationExtension, citationFilename, formatCitation } from '../src/lib/citation.js'

const meta = {
  title: '深度工作',
  author: 'Cal Newport',
  year: '2016',
  publisher: 'Grand Central',
  url: 'https://example.com/book',
  doi: '10.1000/example',
}

test('formats APA citations', () => {
  const result = formatCitation('apa', meta)
  assert.match(result, /Cal Newport\./)
  assert.match(result, /\(2016\)\./)
  assert.match(result, /深度工作\./)
  assert.match(result, /Grand Central\./)
  assert.match(result, /https:\/\/doi\.org\/10\.1000\/example/)
})

test('formats BibTeX citations with escaped braces', () => {
  const result = formatCitation('bibtex', { ...meta, title: 'Deep {Work}' })
  assert.match(result, /^@book\{/)
  assert.match(result, /title = \{Deep \\\{Work\\\}\}/)
  assert.match(result, /author = \{Cal Newport\}/)
  assert.match(result, /year = \{2016\}/)
})

test('formats RIS citations and chooses the right extension', () => {
  const result = formatCitation('ris', meta)
  assert.match(result, /^TY  - BOOK/m)
  assert.match(result, /^AU  - Cal Newport/m)
  assert.match(result, /^ER  - /m)
  assert.equal(citationExtension('bibtex'), 'bib')
  assert.equal(citationExtension('ris'), 'ris')
  assert.equal(citationFilename('ris', meta), '深度工作.ris')
})
