import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridgeIdentity, compatibleIdentity } from '../bridge/lifecycle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-lifecycle-'))
const first = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: '4822', NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
try {
  let identity
  for (let i = 0; i < 30; i++) { try { identity = await bridgeIdentity({ port: 4822 }); break } catch {} await sleep(100) }
  assert(compatibleIdentity(identity, { store: STORE }))
  const second = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: '4823', NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'inherit'] })
  const code = await new Promise(resolve => second.once('exit', resolve))
  assert.equal(code, 2, 'a second port must not become a second writer for one store')
  console.log('PASS identity includes required capabilities and store lease rejects a second writer')
} finally {
  first.kill('SIGTERM')
  await new Promise(resolve => first.once('exit', resolve))
  fs.rmSync(STORE, { recursive: true, force: true })
}
