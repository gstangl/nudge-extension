// Serial source-bound recorder for existing required checks and shared candidates.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import {root,binding,ownedChild,stop,commandBinding} from './support/bridge-candidate.mjs'
const base=path.join(root,'artifacts/bridge-comparison');fs.mkdirSync(base,{recursive:true});const out=fs.mkdtempSync(path.join(base,'checks-'));const before=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(before,null,2))
const rust=[path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')]
const commands=[
 ['rust-builds',process.execPath,['test/build-bridge-candidates.mjs']],
 ['portable',process.execPath,['test/run-portable-regression.mjs']],
 ...['js','rust'].flatMap(name=>['bridge-conformance','bridge-image-conformance','bridge-retention','bridge-origin-headers','browser-protocol','bridge-boundary','bridge-realtime'].map(s=>[`${name}-${s}`,process.execPath,[`test/${s}.mjs`],name==='rust'?JSON.stringify(rust):undefined])),
 ['commit-fault-js',process.execPath,['test/bridge-commit-faults.mjs']],
 ['commit-fault-rust',process.execPath,['test/bridge-commit-faults.mjs'],JSON.stringify([path.join(root,'artifacts/bridge-comparison/bin/rust-fault-hooks')])],
 ['withdrawal-fault-rust',process.execPath,['test/bridge-withdrawal-fault.mjs'],JSON.stringify([path.join(root,'artifacts/bridge-comparison/bin/rust-fault-hooks')])],
 ['withdrawal-fault-js',process.execPath,['test/bridge-withdrawal-fault.mjs']],
 ['rollback',process.execPath,['test/bridge-rollback.mjs']],
 ['negative-controls',process.execPath,['test/bridge-mutants.mjs']],
 ['interrupt',process.execPath,['test/bridge-harness-interrupt.mjs']],
 ['rust-unit','cargo',['test','--locked','--manifest-path','bridge-rust/Cargo.toml']],
 ...(process.argv.includes('--browsers')?[
  ['browser-regression',process.execPath,['test/run-browser-regression.mjs','--headless']],
  ['browser-parity',process.execPath,['test/browser-parity.mjs','--chromium','--headless']],
  ['browser-coexistence',process.execPath,['test/browser-coexistence.mjs','--chromium-only','--headless']],
  ['chromium-js',process.execPath,['test/chrome-delivery.mjs','--browser','chromium','--headless','--samples','3']],
  ['chromium-rust',process.execPath,['test/chrome-delivery.mjs','--browser','chromium','--headless','--samples','3'],JSON.stringify(rust)],
 ]:[]),
]
const report={source:before.sha256,revision:before.revision,scope:'Local checks only; no remote CI, native Chrome/OS or actual host receipt',runtime:{node:process.version,rust:execFileSync('rustc',['--version'],{encoding:'utf8'}).trim(),os:os.type(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model},build:fs.existsSync(rust[0])?commandBinding(rust):[],results:[]}
let child, interruptedRun=false
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
const interrupted=async()=>{interruptedRun=true;report.verdict='failed';report.interrupted=true;await stop(child);save();process.exit(130)}
process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted)
for(const [id,exe,args,candidate]of commands){
 if(interruptedRun)break
 const startedAt=new Date().toISOString(),t0=performance.now();let output='',timer
 console.log('RUN',id)
 const env={...process.env,NUDGE_NO_RELOAD:'1'};delete env.NUDGE_CANDIDATE;if(candidate)env.NUDGE_CANDIDATE=candidate
 child=ownedChild([exe,...args],env,(_,data)=>{output+=data;fs.appendFileSync(path.join(out,id+'.log'),data)})
 try{
  const completed=new Promise(resolve=>child.once('close',(exitCode,signal)=>resolve({exitCode,signal})))
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),25*60e3)})
  const outcome=await Promise.race([completed,timeout]);if(outcome.timeout)await stop(child)
  const result={id,command:[exe,...args],candidate,startedAt,elapsedMs:performance.now()-t0,...outcome,verdict:outcome.exitCode===0?'passed':'failed'}
  report.results.push(result);if(id==='rust-builds'&&result.verdict==='passed')report.build=commandBinding(rust);save();console.log(result.verdict.toUpperCase(),id)
  if(result.verdict==='failed')console.error(output.slice(-2500))
 }finally{clearTimeout(timer)}
}
report.sourceUnchanged=binding().sha256===before.sha256
report.verdict=report.sourceUnchanged&&report.results.every(r=>r.verdict==='passed')?'passed':'failed';save();console.log(JSON.stringify({out,verdict:report.verdict,results:report.results.map(r=>({id:r.id,verdict:r.verdict}))},null,2));if(report.verdict!=='passed')process.exitCode=1
