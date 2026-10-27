// Execute the actual connection transition code; replace only socket/UI/time boundaries.
import {test,expect} from 'vitest'
import vm from 'node:vm'
import fs from 'node:fs'
const source=fs.readFileSync(new URL('../../extension/content.js',import.meta.url),'utf8')
const start=source.indexOf('  let sock, retryTimer, retryDelay = 3000')
const end=source.indexOf('  const onVisibility =',start)
if(start<0||end<0)throw new Error('connection boundary not found')
function fixture(){
 const effects={flush:0,pins:[],notifications:[],native:0};const sockets=[];const timers=[]
 class Socket{constructor(){this.closed=0;this.sent=[];sockets.push(this)}send(v){this.sent.push(JSON.parse(v))}close(){this.closed++;this.onclose?.()}}
 const c=vm.createContext({WebSocket:Socket,WS:'ws://localhost:5322',location:{href:'http://localhost:5322/'},browserSource:{document:'current_document'},JSON,
  notify:(...v)=>effects.notifications.push(v),flushQueue:()=>effects.flush++,updatePill:()=>{},acceptPins:p=>effects.pins.push(p),renderWhoMenu:()=>{},renderStatusMenu:()=>{},captureAfter:()=>{},splitLabel:name=>({name}),
  chrome:{runtime:{sendMessage:()=>effects.native++}},NUDGE_PLATFORM:{developmentReload:false},
  whoMenu:{classList:{contains:()=>false}},statusMenu:{classList:{contains:()=>false}},
  wsOk:false,agentLive:false,agentLabel:null,agentWake:null,bridgeCapabilities:{},agents:[],allPins:[],
  setTimeout:(fn,ms)=>{const t={fn,ms,cancelled:false};timers.push(t);return t},clearTimeout:t=>{if(t)t.cancelled=true},
 })
 vm.runInContext(source.slice(start,end)+'\nglobalThis.driver={connect,retire:()=>{dead=true},state:()=>({wsOk,agentLive,agentLabel})}',c)
 c.driver.connect();const old=sockets[0];c.driver.connect();const current=sockets[1];current.onopen()
 current.onmessage({data:JSON.stringify({type:'pins',agentLive:true,agentLabel:'Expected current owner',agentWake:'pull',pins:['current_pin']})})
 return{c,old,current,sockets,effects,timers}
}
test('U16 retired close cannot clear current readiness or request native restart',()=>{const f=fixture();const count=f.effects.native;f.old.onclose();expect(f.c.driver.state()).toMatchObject({wsOk:true,agentLive:true});expect(f.effects.native).toBe(count)})
test('U16 retired error cannot close the replacement socket',()=>{const f=fixture();f.old.onerror();expect(f.current.closed).toBe(0);expect(f.c.driver.state().wsOk).toBe(true)})
test('U16 retired message cannot replace current pins/owner',()=>{const f=fixture();f.old.onmessage({data:JSON.stringify({type:'pins',agentLive:false,agentLabel:'Foreign stale owner',pins:['foreign_pin']})});expect(f.effects.pins).toEqual([['current_pin']]);expect(f.c.driver.state().agentLabel).toBe('Expected current owner')})
test('U15/U16 retired open cannot send through or reflush the current connection',()=>{const f=fixture();const count=f.effects.flush;f.old.onopen();expect(f.effects.flush).toBe(count);expect(f.current.sent).toHaveLength(1);expect(f.old.closed).toBe(1)})
test('U15 orphaned generation cannot reconnect or deliver a late snapshot',()=>{const f=fixture();f.c.driver.retire();f.current.onmessage({data:JSON.stringify({type:'pins',pins:['late']})});f.current.onclose();f.c.driver.connect();expect(f.sockets).toHaveLength(2);expect(f.effects.pins).toEqual([['current_pin']])})
