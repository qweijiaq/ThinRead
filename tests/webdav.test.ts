import assert from 'node:assert/strict'
import test from 'node:test'

import { webDavRoot } from '../electron/webdav.js'

test('builds a WebDAV URL with a nested remote folder', () => {
  assert.equal(
    webDavRoot({ url: 'https://dav.example.com/remote.php/dav/files/me', username: '', remotePath: 'ThinRead', password: '' }),
    'https://dav.example.com/remote.php/dav/files/me/ThinRead',
  )
  assert.equal(
    webDavRoot({ url: 'https://dav.example.com/remote.php/dav/files/me/', username: '', remotePath: '/Books/ThinRead/', password: '' }),
    'https://dav.example.com/remote.php/dav/files/me/Books/ThinRead',
  )
})
