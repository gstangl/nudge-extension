// Suite D — Bridge Brutal. Adversarial battery against the bridge: the process
// must survive EVERYTHING a hostile/buggy local client or a mangled disk can
// throw at it, and the agent-identity surface (/.identity + WS snapshots) must
// NEVER lie to the toolbar. Own side port + /tmp store — never the live bridge.
// Every leg re-asserts liveness: a bridge that "survives" by dying is a FAIL.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from '../bridge/node_modules/ws/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE = path.join(HERE, '../bridge/bridge.mjs')
const WATCHER = path.join(HERE, '../bridge/watch-nudges.mjs')
const STORE = '/tmp/nudge-brutal-store'
const PORT = 4798 // brutal side port (hardening uses 4799)
const B = `http://127.0.0.1:${PORT}`
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const pass = (m) => console.log('PASS', m)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let bridge = null
function startBridge(extraEnv = {}) {
  bridge = spawn('node', [BRIDGE], {
    env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_MAX_BODY: '5000000', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let err = ''
  bridge.stderr.on('data', c => { err += c })
  bridge.errText = () => err
  return bridge
}
async function up(timeoutMs = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const idn = await (await fetch(`${B}/.identity`, { signal: AbortSignal.timeout(500) })).json()
      if (idn.store === STORE) return idn
    } catch { /* not yet */ }
    await sleep(120)
  }
  return null
}
// liveness probe between attacks — the ONE assertion every leg shares
async function assertAlive(leg) {
  if (bridge.exitCode !== null) fail(`${leg}: bridge process DIED (exit ${bridge.exitCode})\n${bridge.errText().slice(-500)}`)
  const idn = await up(3000)
  if (!idn) fail(`${leg}: bridge stopped answering`)
  return idn
}
const post = (p, body, hdrs = {}) => fetch(`${B}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...hdrs },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  signal: AbortSignal.timeout(8000),
})
const hb = (who) => post('/agent/heartbeat', who)

// ---------- D1: store shape fuzz — wrong-shape JSON must recover, not crash ----------
{
  const shapes = ['null', '[]', '"a string"', '{"pins":"notarray","seq":1}', '{"seq":"x","pins":{}}', '42']
  for (const shape of shapes) {
    fs.rmSync(STORE, { recursive: true, force: true })
    fs.mkdirSync(path.join(STORE, 'inbox'), { recursive: true })
    fs.writeFileSync(path.join(STORE, 'inbox', 'nudge_9.md'), '# nudge_9 - open\n')
    fs.writeFileSync(path.join(STORE, 'store.json'), shape)
    startBridge()
    const idn = await up()
    if (!idn) fail(`D1: bridge never served with shape ${shape} (exit ${bridge.exitCode})\n${bridge.errText().slice(-300)}`)
    const list = await (await fetch(`${B}/comments`)).json()
    if (!Array.isArray(list) || list.length !== 0) fail(`D1: shape ${shape} should serve [], got ${JSON.stringify(list).slice(0, 80)}`)
    const { id } = await (await post('/comments', { text: 'after shape fuzz', url: `${B}/x`, target: { selector: '#x' } })).json()
    if (Number(id.replace('nudge_', '')) <= 9) fail(`D1: id reuse after shape recovery (${id})`)
    if (!fs.readdirSync(STORE).some(f => f.startsWith('store.json.corrupt-'))) fail(`D1: no backup for shape ${shape}`)
    bridge.kill(); await sleep(150)
  }
  pass(`D1 store shape fuzz (${shapes.length} wrong shapes -> recover + backup + seq floor)`)
}

// fresh store for the rest of the battery
fs.rmSync(STORE, { recursive: true, force: true })
startBridge()
if (!await up()) fail('bridge did not start for the battery')

try {
  // ---------- D2: path traversal + URL abuse ----------
  {
    fs.mkdirSync(path.join(STORE, 'shots'), { recursive: true })
    fs.writeFileSync(path.join(STORE, 'shots', 'real.png'), 'PNGDATA')
    const attempts = [
      '/shots/../store.json', '/shots/..%2Fstore.json', '/shots/....%2F%2Fstore.json',
      '/shots/%2e%2e/store.json', '/shots/..png', '/shots/.%2e/store.json.png',
      '//etc/passwd', '/comments/nudge_1%00/resolve', '/demo/../store.mjs',
      '/shots/real.png%00.jpg', '/.identity/../../etc/hosts',
    ]
    for (const p of attempts) {
      const r = await fetch(`${B}${p}`, { signal: AbortSignal.timeout(3000) })
      const body = await r.text()
      if (r.status === 200 && (body.includes('"pins"') || body.includes('root:') || body.includes('import'))) fail(`D2: ${p} leaked content!`)
    }
    for (const method of ['PUT', 'PATCH', 'HEAD', 'TRACE']) {
      const r = await fetch(`${B}/comments`, { method, signal: AbortSignal.timeout(3000) }).catch(() => ({ status: 'ERR' }))
      if (r.status === 201) fail(`D2: ${method} /comments must not create`)
    }
    const ok = await fetch(`${B}/shots/real.png`)
    if (ok.status !== 200) fail('D2: legitimate shot no longer served')
    await assertAlive('D2')
    pass('D2 path traversal + method abuse (11 attempts blocked, legit shot still served)')
  }

  // ---------- D3: payload fuzz on /comments — capped, never crash ----------
  {
    const cases = [
      { name: '__proto__', body: { text: 'p', __proto__: { polluted: 1 }, constructor: { prototype: { x: 1 } }, target: { selector: '#a' } } },
      { name: 'deep nesting', body: '['.repeat(60000) + ']'.repeat(60000) },
      { name: 'text as object', body: { text: { nested: true }, url: 'http://localhost/x' } },
      { name: 'target as string', body: { text: 't', target: 'not-an-object' } },
      { name: 'targets 5000', body: { text: 't', targets: Array.from({ length: 5000 }, (_, i) => ({ selector: `#e${i}`, outerHTML: 'x'.repeat(5000) })) } },
      { name: 'console flood', body: { text: 't', console: Array.from({ length: 5000 }, () => 'line'.repeat(500)) } },
      { name: '1MB url', body: { text: 't', url: 'http://localhost/' + 'a'.repeat(1_000_000) } },
      { name: 'huge single target', body: { text: 't', target: { selector: '#x', outerHTML: 'y'.repeat(2_000_000), innerText: 'z'.repeat(500_000), styles: { a: 'b'.repeat(400_000) } } } },
      { name: 'screenshot garbage', body: { text: 't', screenshot: 'data:text/html;base64,PHNjcmlwdD4=' } },
      { name: 'annotations bomb', body: { text: 't', annotations: { stroke: Array.from({ length: 200_000 }, (_, i) => [i, i]) } } },
      { name: 'null everything', body: { text: null, url: null, target: null, targets: null, viewport: null, console: null } },
      { name: 'viewport strings', body: { text: 't', viewport: { w: 'wide', h: {}, dpr: 'retina' } } },
    ]
    for (const c of cases) {
      const r = await post('/comments', c.body).catch(e => ({ status: `ERR ${e.message}` }))
      if (![201, 400, 413].includes(r.status)) fail(`D3 ${c.name}: unexpected ${r.status}`)
    }
    await assertAlive('D3')
    const size = fs.statSync(path.join(STORE, 'store.json')).size
    if (size > 400_000) fail(`D3: store bloated to ${size} bytes — caps not holding`)
    const pins = JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')).pins
    for (const p of pins) {
      if ((p.url || '').length > 2000 || (p.target?.outerHTML || '').length > 4000 || (p.targets || []).length > 12)
        fail(`D3: cap violated on ${p.id}`)
    }
    if (({}).polluted || Object.prototype.polluted) fail('D3: prototype polluted (suite side)')
    // cleanup for later legs: keep the store lean
    for (const p of pins) await fetch(`${B}/comments/${p.id}`, { method: 'DELETE' })
    pass(`D3 payload fuzz (${cases.length} hostile bodies -> capped store ${size}B, no crash)`)
  }

  // ---------- D4: heartbeat fuzz — typed identity or 400, roster stays clean ----------
  {
    const bad = [
      ['no body', ''],
      ['non-json', '{{{'],
      ['no since', { label: 'x', pid: 1 }],
      ['string pid', { label: 'x', pid: 'one', since: 1 }],
      ['string since', { label: 'x', pid: 1, since: 'now' }],
      ['infinity since', '{"label":"x","pid":1,"since":1e999}'],
      ['null pid', { label: 'x', pid: null, since: 1 }],
    ]
    for (const [name, body] of bad) {
      const r = await hb(body)
      if (r.status !== 400) fail(`D4 ${name}: expected 400, got ${r.status}`)
    }
    // huge fields register but arrive CAPPED
    await hb({ label: 'L'.repeat(10_000), pid: 77, since: 1000, session: 'S'.repeat(100_000), project: 'P'.repeat(9000), branch: 'B'.repeat(9000), host: 'H'.repeat(9000), firstMsg: 'M'.repeat(50_000) })
    const idn = await (await fetch(`${B}/.identity`)).json()
    const a = idn.agents.find(x => x.pid === 77)
    if (!a) fail('D4: capped agent did not register')
    if (a.label.length > 60 || (a.session || '').length > 32 || (a.project || '').length > 60 || (a.firstMsg || '').length > 90 || (a.host || '').length > 20)
      fail(`D4: roster fields not capped: ${JSON.stringify(a).slice(0, 200)}`)
    // oversize heartbeat body -> 413, not memory blow
    const big = await hb('{"pad":"' + 'x'.repeat(6_000_000) + '"}').catch(() => ({ status: 413 }))
    if (big.status !== 413) fail(`D4: oversize heartbeat should 413, got ${big.status}`)
    await assertAlive('D4')
    pass('D4 heartbeat fuzz (7 bad identities -> 400; huge fields capped; oversize -> 413)')
  }

  // ---------- D5: IDENTITY TRUTH — the toolbar must never lie about WHO is connected ----------
  // This is the core Gerald contract: the extension UI shows the owning agent,
  // pushed on every change, stale entries vanish on a bounded clock.
  {
    // restart clean so D4's fuzz agents don't linger
    bridge.kill(); await sleep(200); startBridge(); if (!await up()) fail('D5: restart failed')
    const frames = []
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    ws.on('message', m => { try { const j = JSON.parse(m); if (j.type === 'pins') frames.push(j) } catch { /* ignore */ } })
    await new Promise(r => ws.on('open', r))

    const beat = { A: () => hb({ label: 'agent-A', pid: 101, since: 1000, session: 'sessA' }), B: () => hb({ label: 'agent-B', pid: 202, since: 2000, session: 'sessB' }) }
    await beat.A()
    await sleep(150)
    let idn = await (await fetch(`${B}/.identity`)).json()
    if (idn.agentLabel !== 'agent-A') fail(`D5: after A's beat, agentLabel=${idn.agentLabel}`)
    if (idn.agents.filter(x => x.owner).length !== 1) fail('D5: not exactly one owner')

    await beat.B() // newer session -> takes over, MUST be pushed
    await sleep(250)
    const last = frames.at(-1)
    if (!last || last.agentLabel !== 'agent-B') fail(`D5: owner change not pushed (last frame label: ${last?.agentLabel})`)
    if (last.agents.filter(x => x.owner).length !== 1) fail('D5: pushed frame lacks exactly-one-owner')

    // manual choice pins A — sticky, pushed
    await post('/agent/owner', { pid: 101 })
    await sleep(250)
    if (frames.at(-1)?.agentLabel !== 'agent-A') fail('D5: manual choice not pushed')
    await beat.A(); await beat.B() // fresh beats — B newer but A stays chosen
    await sleep(200)
    idn = await (await fetch(`${B}/.identity`)).json()
    if (idn.agentLabel !== 'agent-A') fail('D5: sticky choice lost against newer session')

    // chosen owner DIES (stops beating) -> fallback to B, pushed WITHOUT any request;
    // A must leave the agents list on the freshness clock (12 s + 5 s sweep)
    const tDeath = Date.now()
    const keepB = setInterval(() => beat.B().catch(() => {}), 2000)
    let fell = null
    while (Date.now() - tDeath < 25_000) {
      await sleep(500)
      const f = frames.at(-1)
      if (f?.agentLabel === 'agent-B') { fell = Date.now() - tDeath; break }
    }
    if (!fell) fail('D5: dead owner never fell over to B')
    idn = await (await fetch(`${B}/.identity`)).json()
    if (idn.agents.some(x => x.label === 'agent-A')) fail('D5: dead agent-A still listed after fallback')

    // ALL agents die -> agentLive false + label null, pushed
    clearInterval(keepB)
    const tSilence = Date.now()
    let dark = null
    while (Date.now() - tSilence < 25_000) {
      await sleep(500)
      const f = frames.at(-1)
      if (f && f.agentLive === false && f.agentLabel === null) { dark = Date.now() - tSilence; break }
    }
    if (!dark) fail('D5: silence never pushed agentLive=false/label=null')
    for (const f of frames) if (f.agents && f.agents.filter(x => x.owner).length > 1) fail('D5: a frame carried >1 owner')
    ws.close()
    pass(`D5 identity truth (takeover pushed, sticky choice, dead owner -> fallback in ${(fell / 1000).toFixed(1)}s, silence -> dark in ${(dark / 1000).toFixed(1)}s, always <=1 owner)`)
  }

  // ---------- D6: WS abuse — garbage frames, many clients, huge hello ----------
  {
    const clients = []
    for (let i = 0; i < 30; i++) {
      const c = new WebSocket(`ws://127.0.0.1:${PORT}`)
      clients.push(c)
    }
    await Promise.all(clients.map(c => new Promise(r => c.on('open', r))))
    clients[0].send('not json at all')
    clients[1].send(Buffer.from([0xde, 0xad, 0xbe, 0xef]))
    clients[2].send(JSON.stringify({ type: 'hello', url: 'x'.repeat(200_000) }))
    clients[3].send(JSON.stringify({ type: 'hello', role: 'agent' }))
    clients[4].send(JSON.stringify({ type: 'evil', nested: { deep: true } }))
    await sleep(300)
    const idn = await assertAlive('D6')
    const tab2 = idn.tabs.find(t => t.url?.startsWith('xxx'))
    if (tab2 && tab2.url.length > 120) fail('D6: hello url not capped')
    if (idn.tabs.length > 29) fail(`D6: agent hello must not count as tab (${idn.tabs.length})`)
    // a change still reaches every surviving client
    const got = Promise.all(clients.slice(5, 10).map(c => new Promise(r => c.on('message', m => { if (JSON.parse(m).type === 'pins') r(true) }))))
    await post('/comments', { text: 'ws-broadcast-probe', url: `${B}/x`, target: { selector: '#w' } })
    const timeout = new Promise(r => setTimeout(() => r(false), 3000))
    if (!(await Promise.race([got.then(() => true), timeout]))) fail('D6: broadcast did not reach clients after garbage frames')
    for (const c of clients) c.close()
    pass('D6 WS abuse (30 clients, garbage/binary/huge frames -> broadcast still delivered)')
  }

  // ---------- D7: concurrency storm — parallel posts, resolve/delete races ----------
  {
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) =>
      post('/comments', { text: `storm ${i}`, url: `${B}/storm`, target: { selector: `#s${i}` } }).then(r => r.json())))
    const ids = results.map(r => Number(r.id.replace('nudge_', '')))
    if (new Set(ids).size !== 100) fail(`D7: duplicate ids under parallel load (${100 - new Set(ids).size} dupes)`)
    JSON.parse(fs.readFileSync(path.join(STORE, 'store.json'), 'utf8')) // parses = intact
    // resolve/delete race on the same pins — must answer 200/404, never crash
    for (const id of results.slice(0, 10).map(r => r.id)) {
      const [a, b] = await Promise.all([
        fetch(`${B}/comments/${id}/resolve`, { method: 'POST' }),
        fetch(`${B}/comments/${id}`, { method: 'DELETE' }),
      ])
      if (![200, 404].includes(a.status) || ![200, 404].includes(b.status)) fail(`D7: race on ${id} answered ${a.status}/${b.status}`)
    }
    await Promise.all(Array.from({ length: 50 }, (_, i) => post('/selection', { url: `${B}/sel`, target: { selector: `#sel${i}` } })))
    JSON.parse(fs.readFileSync(path.join(STORE, 'selection.json'), 'utf8'))
    await assertAlive('D7')
    pass('D7 concurrency storm (100 parallel posts -> 100 unique ids; resolve/delete races clean; 50 selection floods)')
  }

  // ---------- D8: restart-storm durability — every acked pin survives SIGKILL ----------
  {
    const acked = []
    for (let round = 0; round < 5; round++) {
      const { id } = await (await post('/comments', { text: `durable ${round}`, url: `${B}/d`, target: { selector: '#d' } })).json()
      acked.push(id)
      bridge.kill('SIGKILL')
      await sleep(120)
      startBridge()
      if (!await up()) fail(`D8: bridge did not return after SIGKILL round ${round}`)
    }
    const list = await (await fetch(`${B}/comments`)).json()
    for (const id of acked) if (!list.some(p => p.id === id)) fail(`D8: acked ${id} LOST after SIGKILL`)
    if (fs.existsSync(path.join(STORE, 'store.json.tmp'))) fail('D8: tmp residue after kill storm')
    pass('D8 restart-storm durability (5x SIGKILL mid-traffic -> all acked pins survive, no residue)')
  }

  // ---------- D9: hostile sockets — half-open request, raw garbage bytes ----------
  {
    // half-open POST: headers claim a big body, send 10 bytes, keep the socket open
    const hang = net.createConnection(PORT, '127.0.0.1')
    hang.write(`POST /comments HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 500000\r\n\r\n{"text":"`)
    await sleep(300)
    // while it hangs, everyone else is served
    const during = await (await fetch(`${B}/.identity`, { signal: AbortSignal.timeout(2000) })).json()
    if (during.app !== 'roots-nudge') fail('D9: bridge blocked by half-open socket')
    hang.destroy()
    // raw garbage on the port
    for (const bytes of ['GARBAGE\r\n\r\n', 'GET / HTTP/9.9\r\n\r\n', '\x00\x01\x02\x03\xff\xfe']) {
      const s = net.createConnection(PORT, '127.0.0.1')
      s.on('error', () => {}) // resets are fine — crashing is not
      s.write(bytes)
      await sleep(100)
      s.destroy()
    }
    await assertAlive('D9')
    pass('D9 hostile sockets (half-open POST does not block; raw garbage bytes shrugged off)')
  }

  // ---------- D10: oversize + lying Content-Length ----------
  {
    const r = await post('/comments', '{"text":"' + 'x'.repeat(6_000_000) + '"}').catch(() => ({ status: 413 }))
    if (r.status !== 413) fail(`D10: 6MB body should 413, got ${r.status}`)
    // Content-Length lies small, body bigger — node enforces the declared length; must not crash
    const liar = net.createConnection(PORT, '127.0.0.1')
    liar.on('error', () => {})
    liar.write(`POST /comments HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{"text":"this is way more than ten bytes"}`)
    await sleep(300)
    liar.destroy()
    await assertAlive('D10')
    pass('D10 oversize artillery (6MB -> 413; lying Content-Length survived)')
  }

  // ---------- D11: owner endpoint abuse ----------
  {
    await hb({ label: 'real-agent', pid: 900, since: 5000 })
    const cases = [
      ['string pid', { pid: '900' }, 404], // strict typing: "900" is not a live pid
      ['unknown pid', { pid: 424242 }, 404],
      ['no body', '', 400],
      ['non-json', 'pid=900', 400],
      ['valid', { pid: 900 }, 200],
    ]
    for (const [name, body, want] of cases) {
      const r = await post('/agent/owner', body)
      if (r.status !== want) fail(`D11 ${name}: expected ${want}, got ${r.status}`)
    }
    await assertAlive('D11')
    pass('D11 owner endpoint abuse (typed pid, unknown -> 404, garbage -> 400, valid -> 200)')
  }

  // ---------- D12: snapshot diet under heavy history ----------
  {
    const ids = []
    for (let i = 0; i < 60; i++) {
      const { id } = await (await post('/comments', { text: `hist ${i}`, url: `${B}/h`, target: { selector: '#h' } })).json()
      ids.push(id)
    }
    for (const id of ids.slice(0, 50)) await fetch(`${B}/comments/${id}/resolve`, { method: 'POST' })
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const snap = await new Promise((r, j) => {
      ws.on('message', m => { const x = JSON.parse(m); if (x.type === 'pins') r(x) })
      setTimeout(() => j(new Error('no snapshot')), 3000)
    }).catch(e => fail(`D12: ${e.message}`))
    ws.close()
    const done = snap.pins.filter(p => p.status !== 'open').length
    if (done > 40) fail(`D12: snapshot ships ${done} resolved pins (diet is 40)`)
    const all = await (await fetch(`${B}/comments`)).json()
    if (all.length < 60) fail(`D12: GET /comments must still return full history (${all.length})`)
    pass(`D12 snapshot diet (60 pins, 50 resolved -> snapshot carries ${done} done, HTTP full)`)
  }

  // ---------- D13: bind surface — localhost only ----------
  {
    let lanIp = null
    try { lanIp = (await new Promise((r, j) => { import('node:child_process').then(cp => cp.exec('ipconfig getifaddr en0', (e, out) => e ? j(e) : r(out.trim()))) })) } catch { /* offline */ }
    if (lanIp) {
      const refused = await fetch(`http://${lanIp}:${PORT}/.identity`, { signal: AbortSignal.timeout(1500) }).then(() => false).catch(() => true)
      if (!refused) fail(`D13: bridge answers on LAN ip ${lanIp} — must bind 127.0.0.1 only`)
      pass(`D13 bind surface (LAN ${lanIp}:${PORT} refused, 127.0.0.1 only)`)
    } else pass('D13 bind surface (SKIPPED: no LAN ip — offline)')
  }

  // ---------- D14: watcher resilience — armed before the bridge exists ----------
  {
    bridge.kill(); await sleep(200)
    const w = spawn('node', [WATCHER], {
      env: { ...process.env, NUDGE_STORE: STORE, NUDGE_PORT: String(PORT), NUDGE_AGENT_LABEL: 'early-bird' },
      stdio: 'ignore',
    })
    await sleep(2500) // watcher beats into the void
    startBridge()
    if (!await up()) fail('D14: bridge restart failed')
    let seen = false
    for (let i = 0; i < 20 && !seen; i++) {
      await sleep(400)
      const idn = await (await fetch(`${B}/.identity`)).json()
      seen = idn.agents.some(a => a.label === 'early-bird')
    }
    w.kill()
    if (!seen) fail('D14: watcher armed before bridge never registered')
    pass('D14 watcher resilience (armed into the void -> registers once the bridge exists)')
  }

  console.log('\nSuite D — Bridge Brutal: ALL PASS')
} finally {
  bridge.kill()
}
