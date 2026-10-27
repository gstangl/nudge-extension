// Same public image admission expectations for every executable candidate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`image-${Date.now()}`);fs.mkdirSync(out,{recursive:true});const before=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(before,null,2));const results=[]
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg==','base64')
const bridge=await candidate()
try{
 await bridge.start()
 const valid={submissionId:'image_valid_reference',submissionCreatedAt:new Date().toISOString(),text:'Valid PNG',url:'http://localhost:5322/',screenshot:'data:image/png;base64,'+png.toString('base64')}
 assert.equal((await bridge.request('/comments',valid)).status,201,'valid decoded PNG rejected');results.push({id:'valid-png',verdict:'passed'})
 const jpeg=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/bridge-comparison/jpeg.json'))).dataUrl
 assert.equal((await bridge.request('/comments',{...valid,submissionId:'jpeg_overview_reference',screenshotFull:jpeg})).status,201,'valid JPEG auxiliary overview rejected');results.push({id:'jpeg-overview',verdict:'passed'})
 assert((await bridge.request('/comments',{...valid,submissionId:'jpeg_crop_reference',screenshot:jpeg})).status>=400,'JPEG crop must not claim PNG decoding')
 const variants=[['trailing',Buffer.concat([png,Buffer.from([0])])],['truncated-iend',png.subarray(0,png.length-12)],['corrupt-iend',Buffer.concat([png.subarray(0,png.length-1),Buffer.from([0])])]]
 for(const [name,bytes]of variants){
  const count=bridge.read().pins.length;const r=await bridge.request('/comments',{...valid,submissionId:`image_invalid_${name.replaceAll('-','_')}`,screenshot:'data:image/png;base64,'+bytes.toString('base64')})
  try{assert(r.status>=400,`${name} accepted malformed PNG`);assert.equal(bridge.read().pins.length,count,'invalid image mutated store');results.push({id:name,verdict:'passed'})}catch(error){results.push({id:name,verdict:'failed',error:error.stack});process.exitCode=1}
 }
 assert.equal(binding().sha256,before.sha256)
}catch(error){results.push({id:'setup-or-valid',verdict:'failed',error:error.stack});process.exitCode=1}
finally{await bridge.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:before.sha256,argv:bridge.argv,results},null,2));console.log(JSON.stringify({out,results},null,2))}
