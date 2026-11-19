import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  getSettingsRecovery,
  getUiPreferences,
  getWebDavConfigView,
  initSettings,
  saveUiPreferences,
  saveWebDavConfig,
} from '../electron/settings.js'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thinread-settings-'))
}

test('settings survive a restart, including WebDAV config and timestamps', () => {
  const dir = tempDir()
  initSettings(dir)
  saveWebDavConfig({
    url: 'https://dav.example.com/remote.php/dav/files/me',
    username: 'me',
    remotePath: 'Books',
    autoPushDaily: true,
    checkOnStartup: false,
  })
  saveUiPreferences({ dailyGoal: 45 })

  initSettings(dir)
  const webdav = getWebDavConfigView()
  assert.equal(webdav.url, 'https://dav.example.com/remote.php/dav/files/me')
  assert.equal(webdav.username, 'me')
  assert.equal(webdav.remotePath, 'Books')
  assert.equal(webdav.autoPushDaily, true)
  assert.equal(webdav.checkOnStartup, false)
  assert.equal(getUiPreferences().dailyGoal, 45)

  const mode = fs.statSync(path.join(dir, 'settings.json')).mode & 0o777
  assert.equal(mode, 0o600)
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.includes('.tmp-')),
    [],
  )
})

test('a corrupt settings file is backed up instead of silently discarded', () => {
  const dir = tempDir()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, '{ not valid json', 'utf8')

  initSettings(dir)
  const recovery = getSettingsRecovery()
  assert.ok(recovery.corruptBackupPath)
  assert.equal(fs.readFileSync(recovery.corruptBackupPath, 'utf8'), '{ not valid json')
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not valid json')
  assert.equal(getUiPreferences().configured, false)
})
