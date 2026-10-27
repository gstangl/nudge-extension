import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`retention-${Date.now()}`);fs.mkdirSync(out,{recursive:true});const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2))
const b=await candidate();let report
try{
 const old=new Date(Date.now()-8*86400e3).toISOString(),fresh=new Date().toISOString()
 const pin=(n,status,time)=>({id:`nudge_${n}`,status,createdAt:time,resolvedAt:status==='resolved'?time:undefined,text:`Expected ${n}`,url:'http://localhost:5322/'})
 fs.writeFileSync(path.join(b.store,'store.json'),JSON.stringify({seq:42,pins:[pin(40,'open',old),pin(41,'resolved',old),pin(42,'resolved',fresh)],receipts:[{submissionId:'old_receipt',createdAt:old},{submissionId:'unknown_receipt',createdAt:'unknown'}]}))
 fs.mkdirSync(path.join(b.store,'inbox'));for(const file of ['nudge_41.md','nudge_39.withdrawn.md'])fs.writeFileSync(path.join(b.store,'inbox',file),'fixture')
 fs.utimesSync(path.join(b.store,'inbox/nudge_39.withdrawn.md'),new Date(old),new Date(old))
 await b.start();assert.deepEqual(b.read().pins.map(p=>p.id),['nudge_40','nudge_42']);assert.deepEqual(b.read().receipts.map(r=>r.submissionId),['unknown_receipt']);assert(!fs.existsSync(path.join(b.store,'inbox/nudge_41.md')));assert(!fs.existsSync(path.join(b.store,'inbox/nudge_39.withdrawn.md')))
 const made=await b.request('/comments',{text:'Next identity'});assert.equal(made.body.id,'nudge_43');assert.equal(binding().sha256,source.sha256)
 report={verdict:'passed',source:source.sha256,argv:b.argv,build:b.build,scope:'P09/P10 old open preserved, old resolved pruned, unknown-age receipt retained, ID never reused, old withdrawal marker collected'}
}catch(error){report={verdict:'failed',error:error.stack};process.exitCode=1}finally{await b.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report},null,2))}
