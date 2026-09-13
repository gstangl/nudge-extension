import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { bridgeIdentity, compatibleIdentity, ensureBridge } from '../bridge/lifecycle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-lifecycle-'))
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const children = []
let listener
const start = (port, store = STORE) => {
  const child = spawn(process.execPath, ['bridge/bridge.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: store, NUDGE_PORT: String(port), NUDGE_NO_RELOAD: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.log = ''; child.stderr.on('data', data => { child.log += data })
  child.exited = new Promise(resolve => child.once('exit', code => resolve(code)))
  children.push(child); return child
}
async function stop(child, signal = 'SIGTERM') {
  child.ref() // lifecycle launchers unref their child; cleanup must await its exit
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  await child.exited
}
async function freePort(port) {
  const probe = net.createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise(resolve => probe.close(resolve))
}
async function healthy(port, store = STORE) {
  for (let i = 0; i < 40; i++) {
    try { const identity = await bridgeIdentity({ port }); if (compatibleIdentity(identity, { store })) return identity } catch {}
    await sleep(50)
  }
  throw new Error(`no healthy test bridge on ${port}`)
}
async function race() {
  const racers = Array.from({ length: 10 }, (_, index) => start(4822 + index % 2))
  let holders = racers
  for (let i = 0; i < 60 && holders.length > 1; i++) {
    await sleep(100)
    holders = racers.filter(child => child.exitCode === null && child.signalCode === null)
  }
  assert.equal(holders.length, 1, racers.map(child => child.log).join('\n'))
  const winner = holders[0]
  const holder = JSON.parse(fs.readFileSync(path.join(STORE, '.bridge-writer-lease.json'), 'utf8'))
  assert.equal(holder.pid, winner.pid); assert(holder.nonce)
  for (const loser of racers.filter(child => child !== winner)) assert.equal(await loser.exited, 2)
  const port = 4822 + racers.indexOf(winner) % 2
  await healthy(port)
  assert(!fs.readdirSync(STORE).some(name => name.endsWith('.tmp') || name.includes('recovery')))
  return { winner, port, nonce: holder.nonce }
}
try {
  await freePort(4822); await freePort(4823)
  const first = await race()
  console.log('PASS ten simultaneous starts across two ports have exactly one canonical store writer')
  await fetch(`http://127.0.0.1:${first.port}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'survives writer crash', url: 'http://localhost:5322' }) })
  const stored = fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')
  await stop(first.winner, 'SIGKILL')
  assert(fs.existsSync(path.join(STORE, '.bridge-writer-lease.json')))
  const recovered = await race()
  assert.notEqual(first.nonce, recovered.nonce)
  assert.equal(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8'), stored)
  console.log('PASS ten crash-recovery contenders preserve acknowledged data and install only one new owner')
  const otherPort = recovered.port === 4822 ? 4823 : 4822
  const loser = start(otherPort)
  assert.equal(await loser.exited, 2)
  assert.equal(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8'), stored)
  console.log('PASS second-port loser cannot recover, prune or mutate the active store')
  let spawned = false
  const running = await ensureBridge({ port: recovered.port, store: STORE, spawnImpl: () => { spawned = true } })
  assert.equal(running.state, 'running'); assert.equal(spawned, false)
  await stop(recovered.winner)
  assert(!fs.existsSync(path.join(STORE, '.bridge-writer-lease.json')))

  let mode = 'foreign'
  listener = http.createServer((req, res) => {
    if (mode === 'timeout') return
    if (mode === 'http-error') { res.writeHead(503); res.end('unhealthy'); return }
    res.end(mode === 'malformed' ? 'not-json' : JSON.stringify({ app: 'another-program' }))
  })
  await new Promise(resolve => listener.listen(4822, '127.0.0.1', resolve))
  for (mode of ['foreign', 'http-error', 'malformed', 'timeout']) {
    await assert.rejects(ensureBridge({ port: 4822, store: STORE, spawnImpl: () => { spawned = true } }))
    assert.equal(spawned, false)
  }
  mode = 'foreign'
  assert.equal((await fetch('http://127.0.0.1:4822/.identity')).status, 200)
  console.log('PASS unknown, HTTP-error, malformed and timed-out listeners are neither replaced nor terminated')

  const nativeHost = spawn(process.execPath, ['bridge/native-host.mjs'], { cwd: ROOT, env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: '4822' }, stdio: ['pipe', 'pipe', 'pipe'] })
  nativeHost.exited = new Promise(resolve => nativeHost.once('exit', resolve)); children.push(nativeHost)
  let nativeBytes = Buffer.alloc(0), nativeErrors = ''
  const nativeFrames = []
  nativeHost.stderr.on('data', chunk => { nativeErrors += chunk })
  nativeHost.stdout.on('data', chunk => {
    nativeBytes = Buffer.concat([nativeBytes, chunk])
    while (nativeBytes.length >= 4 && nativeBytes.length >= nativeBytes.readUInt32LE(0) + 4) {
      const length = nativeBytes.readUInt32LE(0)
      nativeFrames.push(JSON.parse(nativeBytes.subarray(4, 4 + length)))
      nativeBytes = nativeBytes.subarray(4 + length)
    }
  })
  for (let i = 0; i < 100 && nativeFrames.length < 1; i++) await sleep(20)
  assert.equal(nativeFrames[0]?.ok, false); assert.match(nativeFrames[0].error, /incompatible listener/)
  const frame = Buffer.from('{}'), header = Buffer.alloc(4); header.writeUInt32LE(frame.length)
  nativeHost.stdin.write(Buffer.concat([header, frame]))
  for (let i = 0; i < 100 && nativeFrames.length < 2; i++) await sleep(20)
  assert.equal(nativeFrames[1]?.ok, false); assert.equal(nativeErrors, '')
  nativeHost.stdin.end(); assert.equal(await nativeHost.exited, 0)
  console.log('PASS native-host protocol process frames startup and retry errors without an unhandled rejection (no installed native-app claim)')

  const refusedStore = path.join(STORE, 'bind-loser'); fs.mkdirSync(refusedStore)
  const corrupt = '{ preserve this corrupt store until a writer actually binds'
  fs.writeFileSync(path.join(refusedStore, 'store.json'), corrupt)
  const bindLoser = start(4822, refusedStore)
  assert.notEqual(await bindLoser.exited, 0)
  assert.equal(fs.readFileSync(path.join(refusedStore, 'store.json'), 'utf8'), corrupt)
  assert.deepEqual(fs.readdirSync(refusedStore), ['store.json'])
  console.log('PASS occupied-port loser performs no store recovery or other startup writes')
  listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null

  const ensuredStore = path.join(STORE, 'ensured')
  const result = await ensureBridge({ port: 4823, store: ensuredStore, bridge: path.join(ROOT, 'bridge/bridge.mjs'), env: { ...process.env, NUDGE_NO_RELOAD: '1' }, spawnImpl: (...args) => {
    const child = spawn(...args); child.exited = new Promise(resolve => child.once('exit', resolve)); children.push(child); return child
  } })
  assert.equal(result.state, 'started'); assert(compatibleIdentity(result.identity, { store: ensuredStore }))
  console.log('PASS absent listener starts a verified bridge with the explicit endpoint and store')
} finally {
  if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)) }
  for (const child of children) await stop(child)
  fs.rmSync(STORE, { recursive: true, force: true })
}
