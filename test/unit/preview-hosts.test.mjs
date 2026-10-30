import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverPreviews, previewHost, listeningProcesses, listeningPorts, processDirectories } from '../../agent/preview-hosts.mjs'

const homes = []
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }) })
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-preview-unit-')))
  homes.push(home)
  const project = path.join(home, 'task-a'), sibling = path.join(home, 'task-ab'), state = path.join(home, '.portless')
  fs.mkdirSync(project); fs.mkdirSync(sibling); fs.mkdirSync(state)
  fs.mkdirSync(path.join(project, 'apps', 'other'), { recursive: true })
  fs.writeFileSync(path.join(state, 'proxy.port'), '1355')
  const routes = [
    { hostname: 'task-a.app.localhost', port: 4321, pid: 1001 },
    { hostname: 'task-a.other.localhost', port: 4322, pid: 1002 },
    { hostname: 'task-ab.app.localhost', port: 4323, pid: 1003 },
    { hostname: 'task-a.forged.localhost', port: 4324, pid: 1004 },
  ]
  const lookup = new Map([[1001, project], [1002, path.join(project, 'apps', 'other')], [1003, sibling], [1004, null]])
  const write = () => fs.writeFileSync(path.join(state, 'routes.json'), JSON.stringify(routes))
  write()
  return { home, project, sibling, state, routes, lookup, write, run: (extra = {}) => discoverPreviews({ home, cwd: project, env: {}, lookupCwd: pid => lookup.get(pid), lookupListeners: () => [], ...extra }) }
}
describe('process-backed Portless worktree discovery', () => {
  it('binds only running servers within the exact project, including app subdirectories', () => {
    const f = fixture(), result = f.run()
    expect(result.previews.map(p => p.host)).toEqual(['task-a.app.localhost:1355', 'task-a.other.localhost:1355'])
    expect(result.previews.map(p => p.serverPort)).toEqual([4321, 4322])
  })
  it('discovers HTTPS URLs when the proxy TLS marker exists', () => {
    const f = fixture()
    fs.writeFileSync(path.join(f.state, 'proxy.tls'), '1')
    expect(f.run().previews.map(p => p.url)).toEqual(['https://task-a.app.localhost:1355', 'https://task-a.other.localhost:1355'])
  })
  it('uses the listener cwd even when route.pid belongs to the shared proxy', () => {
    const f = fixture()
    f.routes.splice(1); f.routes[0].pid = 9000; f.write()
    f.lookup.set(9000, f.sibling)
    f.lookup.set(2001, path.join(f.project, 'apps', 'other'))
    const result = f.run({ lookupListeners: port => port === 4321 ? [2001] : [] })
    expect(result.previews).toHaveLength(1)
    expect(result.previews[0].pid).toBe(2001)
  })
  it('does not fall back to route.pid when a listener belongs to a sibling or is unreadable', () => {
    const f = fixture()
    f.routes.splice(1); f.write()
    f.lookup.set(2001, f.sibling)
    expect(f.run({ lookupListeners: () => [2001] }).previews).toEqual([])
    expect(f.run({ lookupListeners: () => [9999] }).previews).toEqual([])
    expect(f.run({ lookupListeners: () => [1001, 2001] }).previews).toEqual([])
  })
  it('falls back to route.pid only without a listener and excludes the shared proxy port', () => {
    const f = fixture()
    f.routes.splice(1); f.write()
    expect(f.run().previews[0].pid).toBe(1001)
    f.routes[0].port = 1355; f.write()
    expect(f.run().previews).toEqual([])
  })
  it('never treats the proxy process as an app owner, including PID fallback', () => {
    const f = fixture()
    f.routes.splice(1); f.write()
    fs.writeFileSync(path.join(f.state, 'proxy.pid'), '1001')
    expect(f.run().previews).toEqual([])
    expect(f.run({ lookupListeners: () => [1001] }).previews).toEqual([])
  })
  it.each([[80, false, 'http://task-a.app.localhost:80'], [443, true, 'https://task-a.app.localhost:443']])('accepts the default proxy port %s', (port, tls, url) => {
    const f = fixture()
    f.routes.splice(1); f.write()
    fs.writeFileSync(path.join(f.state, 'proxy.port'), String(port))
    if (tls) fs.writeFileSync(path.join(f.state, 'proxy.tls'), '1')
    expect(f.run().previews[0].url).toBe(url)
  })
  it('resolves serving cwd symlinks before testing worktree containment', () => {
    const f = fixture()
    f.routes.splice(1); f.write()
    const alias = path.join(f.home, 'alias')
    fs.symlinkSync(f.sibling, alias)
    f.lookup.set(1001, alias)
    expect(f.run().previews).toEqual([])
    fs.unlinkSync(alias); fs.symlinkSync(f.project, alias)
    expect(f.run().previews).toHaveLength(1)
  })
  it('re-reads routes so later starts and server port changes do not retain stale claims', () => {
    const f = fixture()
    f.routes.splice(0, 1); f.write()
    expect(f.run().previews).toHaveLength(1)
    f.routes[0].port = 4499; f.write()
    expect(f.run().previews[0].serverPort).toBe(4499)
  })
  it('refuses foreign names and malformed state', () => {
    const f = fixture()
    f.routes[0].hostname = 'task-a.app.localhost.evil'; f.write()
    expect(f.run().previews).toHaveLength(1)
    fs.writeFileSync(path.join(f.state, 'routes.json'), '{')
    expect(f.run().previews).toEqual([])
  })
  it.each(['blob:https://localhost:1355/document', 'ftp://app.localhost', 'https://foreign.example', 'https://user:pass@app.localhost', 'https://app.localhost:0', 'http://foreign.example', 'http://app.localhost.evil', 'http://user@app.localhost', 'http://localhost:0'])('rejects unsupported explicit preview: %s', url => {
    expect(() => previewHost(url)).toThrow()
  })
  it.each(['https://localhost:1355', 'https://127.0.0.1:1355', 'https://a.b.localhost:1355'])('accepts HTTPS local previews with scheme-independent identity: %s', url => {
    expect(previewHost(url)).toBe(previewHost(url.replace('https:', 'http:')))
  })
  it('normalizes the direct IPv4 alias but retains complete named host identity', () => {
    expect(previewHost('http://127.0.0.1:4321/path')).toBe('localhost:4321')
    expect(previewHost('http://task-a.app.localhost:1355/path')).toBe('task-a.app.localhost:1355')
  })
})

describe('TCP listener process inspection', () => {
  it('uses lsof LISTEN results on macOS, deduplicating IPv4/IPv6', () => {
    const calls = []
    const run = (...args) => { calls.push(args); return 'p2001\nf1\nn127.0.0.1:4321\nf2\nn[::1]:4321\np2002\nf1\nn*:4321\n' }
    expect(listeningProcesses(4321, { platform: 'darwin', run })).toEqual([2001, 2002])
    expect(calls[0].slice(0, 2)).toEqual(['lsof', ['-nP', '-a', '-iTCP:4321', '-sTCP:LISTEN', '-Fpn']])
    expect(listeningProcesses(4321, { platform: 'darwin', run: () => { throw new Error('no listener') } })).toEqual([])
  })
  it('inspects several routes with one bounded lsof call', () => {
    let calls = 0
    const result = listeningPorts([4321, 4322, 0], { platform: 'darwin', run: () => {
      calls++
      return 'p2001\nn127.0.0.1:4321\np2002\nn[::1]:4322\n'
    } })
    expect(calls).toBe(1)
    expect([...result.get(4321)]).toEqual([2001])
    expect([...result.get(4322)]).toEqual([2002])
  })
  it('retains successful lsof records when another route has no listener', () => {
    const result = listeningPorts([4321, 4322], { platform: 'darwin', run: () => {
      throw Object.assign(new Error('one route is stopped'), { status: 1, stdout: 'p2001\nn127.0.0.1:4321\n' })
    } })
    expect([...result.get(4321)]).toEqual([2001])
    expect([...result.get(4322)]).toEqual([])
  })
  it('maps Linux TCP and TCP6 LISTEN socket inodes to processes, excluding established sockets', () => {
    const f = fixture(), procRoot = path.join(f.home, 'proc')
    fs.mkdirSync(path.join(procRoot, 'net'), { recursive: true })
    const row = (port, state, inode) => `  0: 0100007F:${port.toString(16).toUpperCase()} 00000000:0000 ${state} 0:0 00:0 0 1000 0 ${inode} 1`
    fs.writeFileSync(path.join(procRoot, 'net/tcp'), row(4321, '0A', '123') + '\n' + row(4321, '01', '456'))
    fs.writeFileSync(path.join(procRoot, 'net/tcp6'), row(4321, '0A', '789'))
    for (const [pid, inode] of [[2001, 123], [2002, 456], [2003, 789]]) {
      fs.mkdirSync(path.join(procRoot, String(pid), 'fd'), { recursive: true })
      fs.symlinkSync(`socket:[${inode}]`, path.join(procRoot, String(pid), 'fd/1'))
    }
    expect(listeningProcesses(4321, { platform: 'linux', procRoot }).sort()).toEqual([2001, 2003])
    expect(listeningProcesses(4322, { platform: 'linux', procRoot })).toEqual([])
  })
})

describe('serving process directories', () => {
  it('resolves all macOS process directories with one scan and fresh realpaths', () => {
    const f = fixture(), alias = path.join(f.home, 'cwd-alias')
    fs.symlinkSync(f.project, alias)
    let calls = 0
    const run = (command, args) => {
      calls++
      expect([command, args]).toEqual(['lsof', ['-a', '-p', '2001,2002', '-d', 'cwd', '-Fpn']])
      return `p2001\nfcwd\nn${alias}\np2002\nfcwd\nn${f.sibling}\n`
    }
    expect([...processDirectories([2001, 2002, 2001, 0], { platform: 'darwin', run })]).toEqual([[2001, f.project], [2002, f.sibling]])
    expect(calls).toBe(1)
  })
  it('reads Linux process cwd links and excludes vanished or unreadable processes', () => {
    const f = fixture(), procRoot = path.join(f.home, 'proc')
    fs.mkdirSync(path.join(procRoot, '2001'), { recursive: true })
    fs.symlinkSync(f.project, path.join(procRoot, '2001/cwd'))
    expect([...processDirectories([2001, 2002], { platform: 'linux', procRoot })]).toEqual([[2001, f.project]])
  })
})
