// Separate cloned stores at each handoff; never concurrent writers.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`rollback-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2));const results=[],bridges=[]
const rust=process.env.NUDGE_RUST_CANDIDATE?JSON.parse(process.env.NUDGE_RUST_CANDIDATE):[path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')]
const input=n=>({submissionId:`rollback_reference_${n}`,submissionCreatedAt:new Date().toISOString(),text:`Expected rollback ${n}`,url:'http://localhost:5322/'})
const a=input('alpha'),b=input('beta'),c=input('gamma')
try{
 const js=await candidate({argv:[process.execPath,path.join(root,'bridge/bridge.mjs')]});bridges.push(js);await js.start()
 assert.equal((await js.request('/comments',a)).body.id,'nudge_1');assert.equal((await js.request('/comments',b)).body.id,'nudge_2');await js.close()
 const rs=await candidate({argv:rust,fixture:js.store});bridges.push(rs);await rs.start()
 assert.deepEqual((await rs.request('/comments',a)).body,{id:'nudge_1',replay:true,withdrawn:false})
 assert.equal((await rs.request('/comments/nudge_1/resolve',{})).status,200);assert.equal((await rs.request('/comments/nudge_2',undefined,'DELETE')).status,200)
 assert.equal((await rs.request('/comments',c)).body.id,'nudge_3')
 const cli=JSON.parse(execFileSync(process.execPath,['agent/groundworks-nudge.mjs','queue','--all'],{cwd:root,env:rs.env,encoding:'utf8'}))
 assert.deepEqual(cli.open.map(p=>p.id),['nudge_3']);assert(cli.withdrawn.some(p=>p.id==='nudge_2'))
 const nodeRead=JSON.parse(execFileSync(process.execPath,['agent/groundworks-nudge.mjs','show','nudge_1'],{cwd:root,env:rs.env,encoding:'utf8'}));assert.equal(nodeRead.status,'resolved');assert.equal(nodeRead.prompt,a.text)
 await rs.close();const back=await candidate({argv:[process.execPath,path.join(root,'bridge/bridge.mjs')],fixture:rs.store});bridges.push(back);await back.start()
 assert.deepEqual((await back.request('/comments',a)).body,{id:'nudge_1',replay:true,withdrawn:false});assert.deepEqual((await back.request('/comments',b)).body,{id:'nudge_2',replay:true,withdrawn:true});assert.equal((await back.request('/comments',c)).body.id,'nudge_3')
 assert.deepEqual(back.read().pins.map(p=>[p.id,p.status,p.text]),[['nudge_1','resolved',a.text],['nudge_3','open',c.text]])
 results.push({id:'M01-M03-current-snapshot-direct-readers',verdict:'passed',scope:'Modern v2 receipts, submit/retry/resolve/withdraw and unchanged CLI files; pending browser queue, images and older release range unqualified'})
 assert.equal(binding().sha256,source.sha256)
}catch(error){results.push({verdict:'failed',error:error.stack});process.exitCode=1}
finally{for(const b of bridges)await b.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,results},null,2));console.log(JSON.stringify({out,results},null,2))}
