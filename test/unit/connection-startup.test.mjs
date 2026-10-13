import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

const content = fs.readFileSync(new URL('../../extension/content.js', import.meta.url), 'utf8')
const block = content.slice(content.indexOf('  let sock, retryTimer'), content.indexOf('  // ---------- global listeners ----------'))
function fixture() {
  vi.useFakeTimers()
  const sockets = []
  class Socket {
    constructor(url) { this.url=url; this.readyState=0; this.sent=[]; this.closed=0; sockets.push(this) }
    send(data) { if (this.readyState!==1) throw new Error('socket not open'); this.sent.push(JSON.parse(data)) }
    close() { this.closed++; this.readyState=3; this.onclose?.() }
    open() { this.readyState=1; this.onopen?.() }
  }
  const menu = { classList: { contains: () => false } }
  const environment = { WebSocket: Socket, WS: 'ws://localhost:4821', location: { href: 'http://task-a.app.localhost:1355/fixture' },
    browserSource: { browser:'chromium',session:'test_session',tab:'test_tab',document:'test_document' },
    document: { hidden:false, addEventListener() {} }, window: { addEventListener() {} },
    wsOk:false, agentLive:true, agentLabel:'Owner A', agentWake:'pull', agents:[], bridgeCapabilities:{}, allPins:[],
    NUDGE_PLATFORM:{developmentReload:false}, statusMenu:menu, whoMenu:menu,
    notify:vi.fn(), updatePill:vi.fn(), flushQueue:vi.fn(), acceptPins:vi.fn(), renderWhoMenu:vi.fn(), renderStatusMenu:vi.fn(),
    captureAfter:vi.fn(), splitLabel:name=>({name}), chrome:{runtime:{sendMessage:vi.fn()}}, setTimeout,clearTimeout,
  }
  const api=vm.runInNewContext(`${block}\n;({connect,onVisibility,ready:()=>{endpointReady=true},state:()=>({wsOk,agentLive}),stop:()=>{dead=true}})`,environment)
  return { ...api, sockets, environment }
}
afterEach(()=>vi.useRealTimers())
describe('single-owner connection startup and recovery',()=>{
  it('waits for endpoint configuration and coalesces focus events while opening',()=>{
    const f=fixture()
    f.onVisibility(); f.connect()
    expect(f.sockets).toHaveLength(0)
    f.ready(); f.connect(); f.onVisibility(); f.connect()
    expect(f.sockets).toHaveLength(1)
    f.sockets[0].open()
    expect(f.sockets[0].sent).toEqual([{type:'hello',url:f.environment.location.href,browserSource:f.environment.browserSource}])
  })
  it('ignores all callbacks from a retired socket without closing its replacement',()=>{
    const f=fixture(); f.ready(); f.connect()
    const old=f.sockets[0]
    old.readyState=3; f.connect()
    const current=f.sockets[1]; current.open()
    old.onopen(); old.onmessage({data:JSON.stringify({type:'pins',agentLive:false,pins:[]})}); old.onclose(); old.onerror()
    expect(f.state()).toEqual({wsOk:true,agentLive:true})
    expect(current.closed).toBe(0)
    expect(current.sent).toHaveLength(1)
    expect(f.environment.acceptPins).not.toHaveBeenCalled()
    expect(f.environment.chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })
  it('recovers the current connection once and never reconnects an orphaned script',async()=>{
    const f=fixture(); f.ready(); f.connect(); f.sockets[0].open(); f.sockets[0].close()
    expect(f.state().wsOk).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.sockets).toHaveLength(2)
    f.stop(); f.sockets[1].close()
    await vi.advanceTimersByTimeAsync(10000)
    expect(f.sockets).toHaveLength(2)
  })
})
