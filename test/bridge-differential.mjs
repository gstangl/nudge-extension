// Differential file/wire compatibility (BR-05, BR-06, BR-09, BR-10). The
// reviewed JavaScript bridge's direct-reader files and browser projection are
// the existing contract: an alternative candidate must produce the same inbox
// mirror, withdrawal marker, WS pin projection, roster labels, host scoping and
// discovery for identical inputs. Only the times each bridge stamps itself are
// normalized; every other byte is compared.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import assert from 'node:assert/strict'
import {candidate,root,binding,delay,until} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`differential-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2))
const reference=[process.execPath,path.join(root,'bridge/bridge.mjs')]
const subject=process.env.NUDGE_CANDIDATE?JSON.parse(process.env.NUDGE_CANDIDATE):[path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')]
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
const png=v=>{const h=Buffer.alloc(13);h.writeUInt32BE(1,0);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.from([0,v,v,v,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64')}
const at=()=>new Date().toISOString()
const times=text=>text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g,'<time>').replace(/\(\d\d:\d\d\)/g,'(<hh:mm>)')
const plain=value=>JSON.parse(times(JSON.stringify(value)))
const post=(b,route,body)=>b.request(route,body)
function socket(b,url){const ws=new WebSocket(`ws://127.0.0.1:${b.port}/`),messages=[];ws.onmessage=e=>messages.push(JSON.parse(e.data));return new Promise((resolve,reject)=>{ws.onopen=()=>{ws.send(JSON.stringify({type:'hello',url}));resolve({ws,messages})};ws.onerror=reject})}
const inbox=(b,name)=>{try{return times(fs.readFileSync(path.join(b.store,'inbox',name),'utf8'))}catch{return null}}
const scenarios={
 async mirror(b){
  const r={},url='http://localhost:5345/x'
  const ws=await socket(b,url);await delay(150)
  const a=(await post(b,'/comments',{submissionId:'diff_mirror_1',submissionCreatedAt:at(),text:'',author:'reviewer',url,
   target:{selector:'#a',source:'src/App.tsx:10',innerText:'  Hello world that is a fairly long label for a mark  '},targets:[{selector:'#a',source:'s1',outerHTML:'<a>'},{selector:'#b'}],
   console:['err1','err2'],screenshot:png(1),annotations:[{type:'lasso',points:[[1,2]],color:'red'}],
   browserSource:{tab:'tab_1',document:'doc_1',session:'browser_session_1',browser:'chrome'},selectionGeneration:'gen_1'})).body
  r.created=inbox(b,`${a.id}.md`)
  assert.equal((await post(b,`/comments/${a.id}/amend`,{text:'more',author:'reviewer'})).status,200)
  r.amended=inbox(b,`${a.id}.md`)
  await delay(200)
  const pin=ws.messages.filter(m=>m.type==='pins').at(-1)?.pins.find(p=>p.id===a.id)
  r.projection=plain(pin)
  r.annotations=b.read().pins.find(p=>p.id===a.id).annotations
  assert.equal((await b.request(`/comments/${a.id}/resolve`,{})).status,200)
  r.resolved=inbox(b,`${a.id}.md`)
  const bare=(await post(b,'/comments',{submissionId:'diff_mirror_2',submissionCreatedAt:at(),text:'',url,target:{selector:'',innerText:'   '}})).body
  r.bare=inbox(b,`${bare.id}.md`)
  ws.ws.close();return r
 },
 async withdrawal(b){
  await post(b,'/agent/heartbeat',{label:'Owner',pid:92001,since:1,session:'diff_owner',hosts:['localhost:5346']})
  const a=(await post(b,'/comments',{submissionId:'diff_withdraw',submissionCreatedAt:at(),text:'Withdraw me',url:'http://localhost:5346/'})).body
  assert.equal((await b.request(`/comments/${a.id}`,undefined,'DELETE')).status,200)
  return {marker:inbox(b,`${a.id}.withdrawn.md`)}
 },
 async roster(b){
  await post(b,'/agent/heartbeat',{pid:92101,since:1,session:'diff_unlabelled'})
  const identity=(await b.request('/.identity')).body
  await post(b,'/agent/heartbeat',{label:'Hosts',pid:92102,since:2,session:'diff_hosts',hosts:['127.0.0.1:5347','localhost:5347']})
  const hosts=(await b.request('/.identity?host=localhost:5347')).body.agents.find(a=>a.session==='diff_hosts')?.hosts
  await post(b,'/comments',{submissionId:'diff_roster',submissionCreatedAt:at(),text:'Scoped',url:'http://127.0.0.1:5347/'})
  return {agentLabel:identity.agentLabel,labels:identity.agents.map(a=>a.label),hosts,owner:b.read().pins[0].owner}
 },
 async discovery(b){
  // The heartbeat names no hosts, so the bridge discovers them from the
  // watcher's process via the existing preview discovery helper.
  await post(b,'/agent/heartbeat',{label:'Discovered',pid:process.pid,since:1,session:'diff_discovered'})
  let hosts
  try{hosts=await until(async()=>{const h=(await b.request('/.identity')).body.agents[0]?.hosts;return h?.length?h:null},6000,'discovered hosts')}catch{hosts=(await b.request('/.identity')).body.agents[0]?.hosts}
  await post(b,'/comments',{submissionId:'diff_discovery',submissionCreatedAt:at(),text:'Foreign host',url:'http://localhost:5348/'})
  return {hosts,ownerOfForeignHost:b.read().pins[0].owner}
 },
 async selection(b){
  const url='http://localhost:5349/'
  assert.equal((await post(b,'/selection',{url,target:{selector:'#one'},screenshot:png(1)})).status,200)
  const before=fs.readFileSync(path.join(b.store,'shots/selection.png'))
  const failed=await post(b,'/selection',{url,target:{selector:'#two'},screenshot:png(2),screenshotFull:'data:image/png;base64,bm90cG5n'})
  return {status:failed.status,error:failed.body.error,cropUnchanged:fs.readFileSync(path.join(b.store,'shots/selection.png')).equals(before)}
 },
}
// Discovery reads the watcher's Portless routes from HOME; give every
// candidate the same throwaway HOME naming this test process as the route PID.
const home=fs.mkdtempSync(path.join(os.tmpdir(),'nudge-differential-home-'));fs.mkdirSync(path.join(home,'.portless'))
fs.writeFileSync(path.join(home,'.portless/routes.json'),JSON.stringify([{hostname:'diff.localhost',port:5390,pid:process.pid}]))
fs.writeFileSync(path.join(home,'.portless/proxy.port'),'1355\n')
const realHome=process.env.HOME;process.env.HOME=home
const results=[]
try{
 for(const [name,run]of Object.entries(scenarios)){
  const observed={}
  try{
   for(const [role,argv]of [['reference',reference],['subject',subject]]){const b=await candidate({argv});try{await b.start();observed[role]=await run(b)}finally{await b.close();fs.rmSync(b.home,{recursive:true,force:true})}}
   assert.deepEqual(observed.subject,observed.reference,`${name}: subject differs from the reviewed reference`)
   results.push({name,verdict:'passed',observed})
  }catch(error){results.push({name,verdict:'failed',error:error.message.slice(0,4000),observed});process.exitCode=1}
 }
 assert.equal(binding().sha256,source.sha256)
}finally{process.env.HOME=realHome;fs.rmSync(home,{recursive:true,force:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,reference,subject,results},null,2));console.log(JSON.stringify({out,results:results.map(r=>({name:r.name,verdict:r.verdict}))},null,2))}
