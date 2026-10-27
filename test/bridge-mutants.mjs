// Seed real wrong candidates; reject by ledger assertions, not setup failures.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { candidate, root } from './support/bridge-candidate.mjs'
import { DeliveryLedger } from './support/delivery-ledger.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`mutants-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const controls=[
  ['drop','s.pins.push(pin)','/* seeded lost effect */',/stored effect count/],
  ['duplicate','s.pins.push(pin)','s.pins.push(pin, { ...pin, id: "nudge_999999" })',/stored effect count/],
  ['misroute','owner: sanitizeOwner(owner),','owner: { label: "foreign", session: "session_beta" },',/wrong owner/],
]
const results=[]
for(const [name,from,to,expected] of controls){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nudge-mutant-'))
 for(const part of ['bridge','agent'])fs.cpSync(path.join(root,part),path.join(dir,part),{recursive:true,filter:file=>!file.includes('node_modules')&&!file.endsWith('native-host-wrapper.sh')})
 fs.symlinkSync(path.join(root,'bridge/node_modules'),path.join(dir,'bridge/node_modules'),'dir')
 const file=path.join(dir,'bridge/store.mjs');const source=fs.readFileSync(file,'utf8');assert.equal(source.split(from).length,2,'mutant anchor must be unique');fs.writeFileSync(file,source.replace(from,to))
 const bridge=await candidate({argv:[process.execPath,path.join(dir,'bridge/bridge.mjs')]})
 try{
  await bridge.start()
  await bridge.request('/agent/heartbeat',{session:'session_alpha',label:'reference',pid:101,since:1,hosts:['alpha.localhost:5322']})
  const input={submissionId:'mutant_reference_0001',submissionCreatedAt:new Date().toISOString(),text:'Expected work',url:'http://alpha.localhost:5322/'}
  const ledger=new DeliveryLedger();ledger.attempt({...input,owner:'session_alpha',t0:performance.now()}).status='passed'
  const reply=await bridge.request('/comments',input);assert.equal(reply.status,201,'mutant must reach false acceptance')
  let rejected
  try{ledger.reconcile(bridge.read().pins,{requireWatcher:false})}catch(error){assert.match(error.message,expected,'must fail intended assertion');rejected=error.stack}
  assert(rejected,`${name} mutant survived`)
  fs.writeFileSync(path.join(out,`${name}-red.log`),rejected+'\n')
  results.push({mutant:name,verdict:'killed',assertion:rejected.split('\n')[0]})
 }finally{await bridge.close();fs.rmSync(dir,{recursive:true,force:true})}
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({results},null,2)+'\n');console.log(JSON.stringify({out,results},null,2))
