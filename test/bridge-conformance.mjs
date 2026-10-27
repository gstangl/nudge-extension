// Candidate-neutral HTTP/filesystem assertions. Expected effects are handwritten.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { candidate, binding, root, freePort } from './support/bridge-candidate.mjs'
const outArg = process.argv.indexOf('--out')
const out = path.resolve(outArg < 0 ? `artifacts/bridge-comparison/conformance-${Date.now()}` : process.argv[outArg + 1])
assert(!fs.existsSync(out), 'evidence directory already exists; choose a fresh output')
fs.mkdirSync(out, { recursive: true })
const events = []
const event = (kind, data) => { const e = {at:performance.now(),kind,data}; events.push(e); fs.appendFileSync(path.join(out,'events.jsonl'),JSON.stringify(e)+'\n') }
const source = binding(); fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2))
const results = []; let bridge
async function check(id, run) {
  try { await run(); results.push({id,verdict:'passed'}); event('pass',id) }
  catch (error) { results.push({id,verdict:'failed',error:error.stack}); event('fail',{id,error:error.stack}); throw error }
}
const payload = (n, extra = {}) => ({ submissionId:`reference_submission_${n}`,submissionCreatedAt:new Date().toISOString(),text:`Reference ${n}`,url:'http://alpha.localhost:5322/',target:{selector:'#reference'},...extra })
let proxy
try {
  bridge = await candidate({log:(kind,data)=>event(kind,data)}); const identity=await bridge.start()
  await check('P01',async()=>{assert.equal(identity.app,'groundworks-nudge');assert.equal(identity.capabilities.submissionIdempotency,1);assert.equal(identity.agentLive,false)})
  await check('R01-stable-owners',async()=>{
    for (const [session,host,pid] of [['session_alpha','alpha.localhost:5322',101],['session_beta','beta.localhost:5322',102]])
      assert.equal((await bridge.request('/agent/heartbeat',{label:session,session,pid,since:1,hosts:[host],wake:'pull'})).status,200)
    const alpha=await bridge.request('/comments',payload('owner_a',{owner:{session:'session_beta'}}))
    const beta=await bridge.request('/comments',payload('owner_b',{url:'http://beta.localhost:5322/'}))
    assert.equal(alpha.status,201);assert.equal(beta.status,201)
    const pins=bridge.read().pins
    assert.equal(pins[0].owner.session,'session_alpha');assert.equal(pins[1].owner.session,'session_beta')
  })
  const a=payload('a');let original
  await check('P02-P03-replay-conflict',async()=>{
    original=await bridge.request('/comments',a); assert.equal(original.status,201)
    const before=bridge.read().pins.length
    for(let n=0;n<5;n++){ const retry=await bridge.request('/comments',Object.fromEntries(Object.entries(a).reverse()));assert.equal(retry.status,200);assert.equal(retry.body.id,original.body.id);assert.equal(retry.body.replay,true) }
    for(const change of [{text:'Wrong replacement'},{console:['wrong console']},{target:{selector:'#wrong'}}]) {
      const conflict=await bridge.request('/comments',{...a,...change});assert.equal(conflict.status,409);assert.equal(conflict.body.error,'submission_conflict')
    }
    assert.equal(bridge.read().pins.length,before);assert.equal(bridge.read().pins.find(p=>p.id===original.body.id).text,'Reference a')
  })
  await check('P04-concurrent-retries',async()=>{
    const p=payload('race');const replies=await Promise.all(Array.from({length:16},()=>bridge.request('/comments',p)))
    assert.equal(new Set(replies.map(r=>r.body.id)).size,1);assert.equal(replies.filter(r=>r.status===201).length,1)
    assert.equal(bridge.read().pins.filter(pin=>pin.submissionId===p.submissionId).length,1)
  })
  await check('P05-process-crash-replay',async()=>{
    const before=bridge.read();await bridge.stop('SIGKILL');await bridge.start()
    assert.deepEqual(bridge.read(),before)
    const replay=await bridge.request('/comments',a);assert.equal(replay.status,200);assert.equal(replay.body.id,original.body.id)
  })
  await check('P06-withdrawn-replay',async()=>{
    const removed=await bridge.request(`/comments/${original.body.id}`,undefined,'DELETE');assert.equal(removed.status,200)
    await bridge.stop('SIGKILL');await bridge.start()
    const replay=await bridge.request('/comments',a);assert.equal(replay.body.id,original.body.id);assert.equal(replay.body.withdrawn,true)
    assert(!bridge.read().pins.some(p=>p.id===original.body.id));assert(fs.existsSync(path.join(bridge.store,'inbox',`${original.body.id}.withdrawn.md`)))
  })
  await check('P07-resolve-amend-owner',async()=>{
    const p=payload('resolve');const made=await bridge.request('/comments',p);const id=made.body.id
    assert.equal((await bridge.request(`/comments/${id}/amend`,{text:'First amendment'})).status,200)
    assert.equal((await bridge.request(`/comments/${id}/amend`,{text:'Second amendment'})).status,200)
    assert.equal((await bridge.request(`/comments/${id}/resolve`,{})).status,200)
    assert.equal((await bridge.request(`/comments/${id}/amend`,{text:'Must fail'})).status,409)
    const stored=bridge.read().pins.find(p=>p.id===id);assert.equal(stored.text,'Reference resolve');assert.deepEqual(stored.amendments.map(a=>a.text),['First amendment','Second amendment']);assert.equal(stored.status,'resolved')
  })
  await check('P13-write-failure-recovery',async()=>{
    const before=bridge.read();const tmp=path.join(bridge.store,'store.json.tmp');fs.mkdirSync(tmp)
    const p=payload('write_fault');const rejected=await bridge.request('/comments',p);assert(rejected.status>=400,'write failure falsely acknowledged')
    assert.deepEqual(bridge.read(),before,'failed mutation corrupted committed bytes');fs.rmdirSync(tmp)
    assert.equal((await bridge.request('/comments',p)).status,201)
    assert.equal((await bridge.request('/comments',p)).body.replay,true)
    assert.equal(bridge.read().pins.filter(pin=>pin.submissionId===p.submissionId).length,1)
  })
  await check('P03-lost-response-after-commit',async()=>{
    let drop=true
    proxy=http.createServer((req,res)=>{
      const upstream=http.request({hostname:'127.0.0.1',port:bridge.port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${bridge.port}`}},reply=>{
        if(drop){reply.resume();reply.on('end',()=>{drop=false;res.destroy()})}else{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res)}
      });upstream.on('error',()=>res.destroy());req.pipe(upstream)
    })
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve)); const port=proxy.address().port
    const p=payload('lost_reply')
    await assert.rejects(fetch(`http://127.0.0.1:${port}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}))
    const retry=await bridge.request('/comments',p);assert.equal(retry.status,200);assert.equal(retry.body.replay,true)
    assert.equal(bridge.read().pins.filter(pin=>pin.submissionId===p.submissionId).length,1)
    proxy.closeAllConnections();await new Promise(r=>proxy.close(r));proxy=null
  })
  await check('P12-invalid-input-healthy-peer',async()=>{
    const count=bridge.read().pins.length
    for(const body of [null,[],{submissionId:5},{submissionId:'valid_token',submissionCreatedAt:'wrong'},payload('bad_image',{screenshot:'data:image/png;base64,bm90LXBpeGVscw=='}),payload('bad_source',{browserSource:{browser:'chrome'}})])
      assert((await bridge.request('/comments',body)).status>=400)
    assert.equal(bridge.read().pins.length,count)
    assert.equal((await bridge.request('/comments',payload('healthy'))).status,201)
    const foreign=await fetch(`http://127.0.0.1:${bridge.port}/comments`,{headers:{Origin:'https://foreign.example'},signal:AbortSignal.timeout(1000)});assert.equal(foreign.status,403)
  })
  await check('L03-single-writer',async()=>{
    const second=await candidate();second.env.NUDGE_STORE=bridge.store
    try{await assert.rejects(second.start(),/exited before readiness|lease PID mismatch|identity\/store mismatch/)}finally{await second.close()}
    assert.equal((await bridge.request('/.identity')).status,200)
  })
  await check('P15-seeded-reference-model',async()=>{
    let seed=0x51a12;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
    const expected=new Map();const inputs=new Map()
    for(let n=0;n<60;n++){
      const k=random()%10;const p=inputs.get(k)||payload(`model_${k}`);inputs.set(k,p)
      const result=await bridge.request('/comments',p)
      if(expected.has(k)){assert.equal(result.body.id,expected.get(k));assert.equal(result.status,200)}else{assert.equal(result.status,201);expected.set(k,result.body.id)}
      if(n%17===0){await bridge.stop('SIGKILL');await bridge.start()}
    }
    const pins=bridge.read().pins.filter(p=>p.submissionId.startsWith('reference_submission_model_'))
    assert.equal(pins.length,expected.size);assert.equal(new Set(pins.map(p=>p.id)).size,expected.size)
    assert.deepEqual(pins.map(p=>p.text),[...expected.keys()].map(k=>`Reference model_${k}`))
  })
  assert.equal(binding().sha256,source.sha256,'source changed during conformance')
} catch(error){event('run-error',error.stack);process.exitCode=1}
finally {
  if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r))}
  if(bridge){try{fs.writeFileSync(path.join(out,'store.json'),JSON.stringify(bridge.read(),null,2))}catch{}await bridge.close()}
  const report={verdict:process.exitCode?'failed':'passed',source:source.sha256,argv:bridge?.argv,results};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,...report},null,2))
}
