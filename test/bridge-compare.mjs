// Serial paired diagnostics. Qualification remains gated by the complete evidence map.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {root,binding,ownedChild,stop,isolatedEnv,commandBinding} from './support/bridge-candidate.mjs'
const value=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1]}
const blocks=Number(value('--blocks','3')),samples=Number(value('--samples','20'))
assert(Number.isInteger(blocks)&&blocks>0&&Number.isInteger(samples)&&samples>0,'invalid counts')
const base=path.join(root,'artifacts/bridge-comparison');fs.mkdirSync(base,{recursive:true});const out=fs.mkdtempSync(path.join(base,'paired-'))
const policy=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/bridge-comparison/policy.json')))
if(process.argv.includes('--qualify'))throw new Error('Qualification unavailable: full catalog, native/host/OS receipts, coverage/mutation floors and completed soaks must first be independently recorded. Use diagnostic blocks until those prerequisites exist.')
const before=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(before,null,2))
const candidates={js:[process.execPath,path.join(root,'bridge/bridge.mjs')],rust:[path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')]}
const builds=Object.fromEntries(Object.entries(candidates).map(([name,argv])=>[name,commandBinding(argv)]))
const results=[]
async function run(name,argv,script,args,timeout){
 const env={...isolatedEnv(path.join(out,'unused-store'),49999),NUDGE_CANDIDATE:JSON.stringify(argv)}
 const log=fs.openSync(path.join(out,name+'.log'),'wx');const child=ownedChild([process.execPath,path.join(root,script),...args],env,(_,data)=>fs.writeSync(log,data));let timer
 try{const finished=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),timeout)});const outcome=await Promise.race([finished,deadline]);if(outcome.timeout)await stop(child);return outcome}finally{clearTimeout(timer);fs.closeSync(log)}
}
let seed=0x53a17
try{
 // Fail fast on the same external essential checks before paired measurement.
 for(const [name,argv]of Object.entries(candidates)){
  for(const script of ['test/bridge-conformance.mjs','test/bridge-image-conformance.mjs','test/bridge-retention.mjs','test/bridge-origin-headers.mjs','test/browser-protocol.mjs','test/bridge-boundary.mjs','test/bridge-realtime.mjs']){
   const id=`gate-${name}-${path.basename(script,'.mjs')}`;const outcome=await run(id,argv,script,script==='test/bridge-conformance.mjs'?['--out',path.join(out,id)]:[],60000);results.push({id,...outcome});assert.equal(outcome.code,0,`${id} failed: no comparison eligibility`)
  }
 }
 for(let block=0;block<blocks;block++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const order=seed%2?['js','rust']:['rust','js']
  for(const name of order){
   const id=`block-${block}-${name}`,dir=path.join(out,id);const loadBefore=os.loadavg();const outcome=await run(id,candidates[name],'test/chrome-delivery.mjs',['--browser','chrome','--samples',String(samples),'--input-seed',`paired-reference-${block}`,'--out',dir],120000+samples*10000)
   const report=fs.existsSync(path.join(dir,'report.json'))?JSON.parse(fs.readFileSync(path.join(dir,'report.json'))):null
   results.push({id,block,candidate:name,order,loadBefore,loadAfter:os.loadavg(),...outcome,report});assert.equal(outcome.code,0,`${id} failed`)
  }
  fs.writeFileSync(path.join(out,'partial.json'),JSON.stringify(results,null,2))
 }
 assert.equal(binding().sha256,before.sha256,'source changed');for(const [name,argv]of Object.entries(candidates))assert.deepEqual(commandBinding(argv),builds[name],'build changed')
}catch(error){results.push({error:error.stack});process.exitCode=1}
const paired=[]
for(let b=0;b<blocks;b++){const js=results.find(r=>r.block===b&&r.candidate==='js')?.report;const rust=results.find(r=>r.block===b&&r.candidate==='rust')?.report;if(js?.verdict==='passed'&&rust?.verdict==='passed')paired.push({block:b,jsP95:js.statistics.p95,rustP95:rust.statistics.p95,differenceMs:rust.statistics.p95-js.statistics.p95})}
const report={verdict:process.exitCode?'failed':'inconclusive',reason:'Diagnostic sample counts; no qualified p99, native lifecycle, actual-agent receipt or completed soak claim',source:before.sha256,policy,builds,host:{type:os.type(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model},scheduledPerCandidate:blocks*samples,paired,results}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,verdict:report.verdict,paired},null,2))
