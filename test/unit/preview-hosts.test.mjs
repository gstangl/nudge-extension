import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverPreviews, previewHost } from '../../agent/preview-hosts.mjs'

const homes = []
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }) })
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-preview-unit-')))
  homes.push(home)
  const project = path.join(home, 'task-a'), sibling = path.join(home, 'task-ab'), state = path.join(home, '.portless')
  fs.mkdirSync(project); fs.mkdirSync(sibling); fs.mkdirSync(state)
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
  return { home, project, state, routes, write, run: () => discoverPreviews({ home, cwd: project, env: {}, lookupCwd: pid => lookup.get(pid) }) }
}
describe('process-backed Portless worktree discovery', () => {
  it('binds only running servers within the exact project, including app subdirectories', () => {
    const f = fixture(), result = f.run()
    expect(result.previews.map(p => p.host)).toEqual(['task-a.app.localhost:1355', 'task-a.other.localhost:1355'])
    expect(result.previews.map(p => p.serverPort)).toEqual([4321, 4322])
  })
  it('re-reads routes so later starts and server port changes do not retain stale claims', () => {
    const f = fixture()
    f.routes.splice(0, 1); f.write()
    expect(f.run().previews).toHaveLength(1)
    f.routes[0].port = 4499; f.write()
    expect(f.run().previews[0].serverPort).toBe(4499)
  })
  it('refuses foreign names, malformed state and unsupported TLS discovery', () => {
    const f = fixture()
    f.routes[0].hostname = 'task-a.app.localhost.evil'; f.write()
    expect(f.run().previews).toHaveLength(1)
    fs.writeFileSync(path.join(f.state, 'proxy.tls'), '')
    expect(f.run().previews).toEqual([])
    fs.unlinkSync(path.join(f.state, 'proxy.tls'))
    fs.writeFileSync(path.join(f.state, 'routes.json'), '{')
    expect(f.run().previews).toEqual([])
  })
  it.each(['https://app.localhost', 'http://foreign.example', 'http://app.localhost.evil', 'http://user@app.localhost', 'http://localhost:0'])('rejects unsupported explicit preview: %s', url => {
    expect(() => previewHost(url)).toThrow()
  })
  it('normalizes the direct IPv4 alias but retains complete named host identity', () => {
    expect(previewHost('http://127.0.0.1:4321/path')).toBe('localhost:4321')
    expect(previewHost('http://task-a.app.localhost:1355/path')).toBe('task-a.app.localhost:1355')
  })
})
