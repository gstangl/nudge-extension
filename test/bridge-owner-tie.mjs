// Independent owner election for equal `since` values (BR-05). The current
// product rule is "newest armed session owns an unassigned host"; when several
// sessions report the same `since`, the reviewed JS0 behaviour picks the session
// that joined the roster last, and later heartbeats do not reorder it. The
// expectation is written from that event order, not read from a candidate.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const argv=process.env.NUDGE_CANDIDATE?JSON.parse(process.env.NUDGE_CANDIDATE):[process.execPath,path.join(root,'bridge/bridge.mjs')]
const out=path.join(root,'artifacts/bridge-comparison',`owner-tie-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2))
const host='localhost:5343',since=1790000000000,sessions=Array.from({length:8},(_,i)=>`tie_session_${i}`)
const beat=(b,session,i)=>b.request('/agent/heartbeat',{label:`Tie ${i}`,pid:91000+i,since,session,wake:'pull',hosts:[host]})
const results=[],trials=6
for(let trial=0;trial<trials;trial++){
 const b=await candidate({argv});let observed
 try{
  await b.start()
  for(const [i,s]of sessions.entries())assert.equal((await beat(b,s,i)).status,200)
  // Re-heartbeat in reverse: freshness updates must not change the election.
  for(const [i,s]of [...sessions.entries()].reverse())assert.equal((await beat(b,s,i)).status,200)
  const r=await b.request('/comments',{submissionId:`tie_${trial}`,submissionCreatedAt:new Date().toISOString(),text:'Owner tie',url:`http://${host}/`})
  assert.equal(r.status,201)
  observed=b.read().pins[0].owner
  assert.deepEqual(observed,{label:'Tie 7',session:sessions.at(-1)},`trial ${trial}: last-joined equal-since session owns the host`)
  results.push({trial,verdict:'passed',observed})
 }catch(error){results.push({trial,verdict:'failed',observed,error:error.message});process.exitCode=1}
 finally{await b.close()}
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,candidate:argv,results},null,2))
console.log(JSON.stringify({out,candidate:argv,results},null,2))
