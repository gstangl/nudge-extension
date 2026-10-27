import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {root,until,ownedChild,stop,isolatedEnv} from './support/bridge-candidate.mjs'
const base=path.join(root,'artifacts/bridge-comparison');fs.mkdirSync(base,{recursive:true});const out=fs.mkdtempSync(path.join(base,'interrupt-'));const run=path.join(out,'send')
let output='';const child=ownedChild([process.execPath,path.join(root,'test/chrome-delivery.mjs'),'--browser','chrome','--samples','100','--out',run],isolatedEnv(path.join(out,'unused'),49998),(_,s)=>{output+=s})
try{
 await until(()=>fs.existsSync(path.join(run,'attempts.json')),20000,'first attempt before interruption')
 const owned=JSON.parse(fs.readFileSync(path.join(run,'owned-processes.json')))
 const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));process.kill(child.pid,'SIGTERM');const outcome=await ended
 assert.equal(outcome.code,130)
 for(const pid of [owned.bridge,...owned.watchers])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'})
 const report=JSON.parse(fs.readFileSync(path.join(run,'report.json')));assert.equal(report.verdict,'failed');assert.match(report.error,/interrupted/)
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({verdict:'passed',scope:'H06 interrupted runner preserves partial output and reaps owned bridge/watchers',owned,outcome},null,2))
 console.log('PASS H06',out)
}finally{await stop(child);fs.writeFileSync(path.join(out,'runner.log'),output)}
