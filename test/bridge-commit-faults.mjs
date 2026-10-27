import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { candidate, root, until, binding } from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`commit-faults-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2));const results=[]
for(const barrier of ['write-start','write-complete','pre-rename','post-rename']){
 const log=[];const bridge=await candidate({log:(kind,data)=>log.push({at:performance.now(),kind,data})})
 const input=n=>({submissionId:`commit_barrier_${n}`,submissionCreatedAt:new Date().toISOString(),text:`Expected ${n}`,url:'http://localhost:5322/'})
 try{
  await bridge.start();const a=input('alpha'),b=input('beta');assert.equal((await bridge.request('/comments',a)).status,201)
  await bridge.stop()
  const signal=path.join(bridge.home,'barrier-reached')
  bridge.env.NUDGE_TEST_BARRIER=barrier;bridge.env.NUDGE_TEST_SIGNAL=signal
  bridge.env.NODE_OPTIONS=`--import=${JSON.stringify(path.join(root,'test/support/commit-barrier.mjs'))}`
  await bridge.start()
  const pending=bridge.request('/comments',b).catch(error=>({error:String(error)}))
  await until(()=>fs.existsSync(signal),5000,barrier)
  await bridge.stop('SIGKILL');const outcome=await pending;assert(outcome.error,'crash barrier must precede reply')
  const beforeRetry=bridge.read();assert(beforeRetry.pins.some(p=>p.text==='Expected alpha'),'previously confirmed work lost')
  assert.equal(beforeRetry.pins.length,barrier==='post-rename'?2:1,'semantic crash boundary')
  delete bridge.env.NODE_OPTIONS;delete bridge.env.NUDGE_TEST_BARRIER
  await bridge.start();const replay=await bridge.request('/comments',b)
  assert.equal(replay.status,barrier==='post-rename'?200:201)
  assert.deepEqual(bridge.read().pins.map(p=>p.text),['Expected alpha','Expected beta'])
  assert.equal(bridge.read().receipts.filter(r=>r.submissionId===b.submissionId).length,1)
  results.push({barrier,verdict:'passed',uncertainRequest:outcome})
 }catch(error){results.push({barrier,verdict:'failed',error:error.stack});process.exitCode=1}
 finally{await bridge.close();fs.writeFileSync(path.join(out,barrier+'.json'),JSON.stringify(log,null,2))}
}
assert.equal(source.sha256,binding().sha256,'source changed')
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,scope:'instrumented semantic process-crash barriers; no power-loss claim',results},null,2));console.log(JSON.stringify({out,results},null,2))
