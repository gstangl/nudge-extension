// Crash after the withdrawal commit but before its fallback marker/HTTP reply.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {candidate,root,until,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`withdrawal-fault-${Date.now()}`);fs.mkdirSync(out,{recursive:true});const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2));const results=[]
for(const modern of [true,false]){
 const b=await candidate()
 try{
  await b.start();await b.request('/agent/heartbeat',{pid:101,since:1,label:'Original owner',session:'session_alpha',hosts:['localhost:5322'],wake:'pull'})
  const input={text:'Private content must disappear',url:'http://localhost:5322/',...(modern?{submissionId:'withdrawal_crash_reference',submissionCreatedAt:new Date().toISOString()}: {})}
  const made=await b.request('/comments',input);assert.equal(made.status,201);const id=made.body.id;await b.stop()
  const signal=path.join(b.home,'withdrawal-barrier');Object.assign(b.env,{NODE_OPTIONS:`--import=${JSON.stringify(path.join(root,'test/support/commit-barrier.mjs'))}`,NUDGE_TEST_BARRIER:'post-rename',NUDGE_TEST_SIGNAL:signal})
  await b.start();const pending=b.request(`/comments/${id}`,undefined,'DELETE').catch(error=>({error:String(error)}));await until(()=>fs.existsSync(signal),5000,'withdrawal commit barrier');await b.stop('SIGKILL');assert((await pending).error)
  delete b.env.NODE_OPTIONS;delete b.env.NUDGE_TEST_BARRIER;await b.start()
  assert(!b.read().pins.some(p=>p.id===id),'withdrawal must remain committed')
  const marker=path.join(b.store,'inbox',`${id}.withdrawn.md`);assert(fs.existsSync(marker),'committed withdrawal lost its recoverable stop signal')
  const content=fs.readFileSync(marker,'utf8');assert(content.includes('session_alpha'),'original recipient lost');assert(!content.includes(input.text),'withdrawn prompt content retained')
  const cli=JSON.parse(execFileSync(process.execPath,['agent/groundworks-nudge.mjs','queue','--all'],{cwd:root,env:b.env,encoding:'utf8'}));assert(cli.withdrawn.some(w=>w.id===id),'unchanged reader cannot see recovered withdrawal')
  results.push({modern,verdict:'passed',build:b.build})
 }catch(error){results.push({modern,verdict:'failed',error:error.stack});process.exitCode=1}finally{await b.close()}
}
assert.equal(binding().sha256,source.sha256);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,results},null,2));console.log(JSON.stringify({out,results},null,2))
