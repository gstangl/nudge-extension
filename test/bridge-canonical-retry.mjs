// Independent JS -> Rust -> JS (and Rust -> JS -> Rust) receipt retries.
// Expectations are BR-02/BR-10 obligations, not values computed by either
// candidate: a byte-identical retry under one submission id replays the first
// stored effect at every hop, a changed prompt is refused, and a store written by
// one implementation stays readable by the other without losing visible work.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`canonical-retry-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2))
const js=[process.execPath,path.join(root,'bridge/bridge.mjs')]
const rust=process.env.NUDGE_RUST_CANDIDATE?JSON.parse(process.env.NUDGE_RUST_CANDIDATE):[path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')]
const at=new Date().toISOString()
// Raw request bodies: number spellings and key order must reach the bridge as
// written, so they are never re-serialized by this harness.
const body=(id,fields)=>`{"submissionId":"${id}","submissionCreatedAt":"${at}","url":"http://localhost:5341/","text":"Canonical ${id}"${fields?','+fields:''}}`
const cases=[
 {id:'plain',fields:''},
 {id:'number_spellings',fields:'"annotations":[{"type":"lasso","points":[[1.0,2.50],[1e2,-0],[1e21,5e-7],[12345678901234567890,0.1]]}]'},
 {id:'unicode_keys',fields:'"annotations":[{"type":"lasso","points":[[1,2]],"\\uffff":1,"\\ud83d\\ude00":2,"\\u00e9":3,"Z":4,"a":5}]'},
 // Truncation at 4000 UTF-16 units may split a pair; the changed-text control
 // therefore edits the start of the prompt, inside the retained prefix.
 // Truncation at 4000 UTF-16 units may split a pair; the changed-text control
 // edits the start of the prompt, inside the retained prefix.
 {id:'surrogate_boundary',text:'a'.repeat(3999)+'\u{1F600}tail'},
 {id:'falsy_console',fields:'"console":""'},
]
const rawFor=(c,variant='')=>c.text!==undefined?JSON.stringify({submissionId:`canon_${c.id}`,submissionCreatedAt:at,url:'http://localhost:5341/',text:variant+c.text}):body(`canon_${c.id}`,c.fields).replace(`"text":"Canonical canon_${c.id}"`,`"text":"Canonical canon_${c.id}${variant}"`)
async function post(bridge,raw){const r=await fetch(`http://127.0.0.1:${bridge.port}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:raw,signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()}}
const bridges=[],results=[]
async function hop(argv,fixture){const b=await candidate({argv,fixture});bridges.push(b);await b.start();return b}
async function chain(name,order){
 for(const c of cases){
  const steps=[];let store,id,visible
  try{
   for(const [i,argv]of order.entries()){
    const b=await hop(argv,store)
    if(i>0){
     assert(!fs.readdirSync(b.store).some(f=>f.startsWith('store.json.corrupt')),`${name}/${c.id}: hop ${i} did not classify the other implementation's store as corrupt`)
     const listed=(await b.request('/comments')).body.map(p=>[p.id,p.text])
     // Declared deviation: a Rust string cannot hold the unpaired surrogate that
     // JavaScript truncation may leave, so only that unit may read as U+FFFD.
     // Every other unit, the id and the stored-effect count stay exact.
     const exact=JSON.stringify(listed)===JSON.stringify(visible)
     assert.deepEqual(listed.map(([id,t])=>[id,t.toWellFormed()]),visible.map(([id,t])=>[id,t.toWellFormed()]),`${name}/${c.id}: hop ${i} serves the visible work written by hop ${i-1}`)
     if(!exact)steps.push({hop:i,declaredDeviation:'unpaired surrogate read as U+FFFD'})
    }
    const r=await post(b,rawFor(c));steps.push({hop:i,implementation:argv===js?'js':'rust',status:r.status,body:r.body})
    if(i===0){assert.equal(r.status,201,`${name}/${c.id}: first submission accepted`);id=r.body.id}
    else assert.deepEqual([r.status,r.body],[200,{id,replay:true,withdrawn:false}],`${name}/${c.id}: hop ${i} replays the first effect`)
    const conflict=await post(b,rawFor(c,' changed'));steps.push({hop:i,control:'changed-text',status:conflict.status,body:conflict.body})
    assert.equal(conflict.status,409,`${name}/${c.id}: hop ${i} refuses changed content under the same id`)
    assert.equal(b.read().pins.length,1,`${name}/${c.id}: hop ${i} holds one stored effect`)
    assert(!fs.readdirSync(b.store).some(f=>f.startsWith('store.json.corrupt')),`${name}/${c.id}: hop ${i} did not classify the other implementation's store as corrupt`)
    visible=(await b.request('/comments')).body.map(p=>[p.id,p.text]);await b.close();store=b.store
   }
   results.push({id:`${name}/${c.id}`,verdict:'passed',steps})
  }catch(error){results.push({id:`${name}/${c.id}`,verdict:'failed',error:error.message,steps});process.exitCode=1}
  finally{for(const b of bridges.splice(0))await b.close()}
 }
}
try{
 await chain('js-rust-js',[js,rust,js])
 await chain('rust-js-rust',[rust,js,rust])
 assert.equal(binding().sha256,source.sha256)
}catch(error){results.push({verdict:'failed',error:error.stack});process.exitCode=1}
finally{for(const b of bridges)await b.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,js:js,rust,results},null,2));console.log(JSON.stringify({out,results:results.map(r=>({id:r.id,verdict:r.verdict,error:r.error}))},null,2))}
