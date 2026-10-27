// Separate protocol resource diagnostic; it is not Chrome input latency.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`resources-${Date.now()}`);fs.mkdirSync(out,{recursive:true});const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2));const results=[]
for(const [name,argv]of [['js',[process.execPath,path.join(root,'bridge/bridge.mjs')]],['rust',[path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')]]]){
 const b=await candidate({argv});const samples=[];const attempts=[]
 const sample=phase=>{const raw=execFileSync('ps',['-p',String(b.child.pid),'-o','pid=,rss=,time='],{encoding:'utf8'}).trim();samples.push({phase,at:performance.now(),raw,rssKiB:Number(raw.split(/\s+/)[1])})}
 try{await b.start();sample('idle');for(let n=0;n<300;n++){
  const t0=performance.now();const input={submissionId:`resource_reference_${n}`,submissionCreatedAt:new Date().toISOString(),text:`Expected resource ${n}`,url:'http://localhost:5322/'}
  const reply=await b.request('/comments',input);attempts.push({index:n,status:reply.status,latencyMs:performance.now()-t0});assert.equal(reply.status,201)
  if(n%100===99)sample(`accepted-${n+1}`)
 }
 assert.equal(b.read().pins.length,300);sample('complete');results.push({name,verdict:'passed',attempts,samples})
 }catch(error){results.push({name,verdict:'failed',error:error.stack,attempts,samples});process.exitCode=1}finally{await b.close()}
}
assert.equal(binding().sha256,source.sha256);const report={scope:'Bridge process only, direct sequential HTTP, no browser/watcher; RSS high-water diagnostic, no leak/dominance claim',host:{type:os.type(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,load:os.loadavg()},source:source.sha256,results};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,results:results.map(r=>({name:r.name,verdict:r.verdict,samples:r.samples}))},null,2))
