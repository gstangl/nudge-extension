// A client may half-close its write side right after sending a request. The
// bridge must still answer (BR-08): valid, duplicate-Origin and malformed-Origin
// requests each get a status line on every attempt, never a silent close.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`half-close-${Date.now()}`);fs.mkdirSync(out,{recursive:true})
const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2))
const attempts=40,b=await candidate(),results=[]
const raw=(origin,halfClose)=>new Promise(resolve=>{let data='';const socket=net.connect(b.port,'127.0.0.1');socket.setTimeout(2000,()=>{socket.destroy();resolve('deadline')})
 socket.on('connect',()=>{const request=Buffer.concat([Buffer.from(`GET /comments HTTP/1.1\r\nHost: 127.0.0.1:${b.port}\r\nConnection: close\r\n`),origin,Buffer.from('\r\n')]);halfClose?socket.end(request):socket.write(request)})
 socket.on('data',chunk=>{data+=chunk});socket.on('end',()=>resolve(data));socket.on('error',error=>resolve(`error ${error.code}`))})
const origins={valid:[Buffer.from('Origin: http://localhost:5322\r\n'),/^HTTP\/1\.1 200 /],duplicate:[Buffer.from('Origin: http://localhost:5322\r\nOrigin: http://localhost:5322\r\n'),/^HTTP\/1\.1 (400|403) /],'invalid-utf8':[Buffer.concat([Buffer.from('Origin: '),Buffer.from([255]),Buffer.from('\r\n')]),/^HTTP\/1\.1 (400|403) /]}
try{
 await b.start()
 for(const halfClose of [false,true])for(const [name,[origin,expected]]of Object.entries(origins)){
  const responses=[];for(let i=0;i<attempts;i++)responses.push((await raw(origin,halfClose)).split('\r\n')[0])
  const missing=responses.filter(r=>!expected.test(r+'\r\n')&&!expected.test(r+' ')).length
  const result={name,halfClose,attempts,missing,statuses:[...new Set(responses)]};results.push(result)
  assert.equal(missing,0,`${name} halfClose=${halfClose}: ${missing}/${attempts} attempts lacked the expected status`)
 }
 assert.equal(binding().sha256,source.sha256)
}catch(error){results.push({verdict:'failed',error:error.message});process.exitCode=1}
finally{await b.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,argv:b.argv,build:b.build,results},null,2));console.log(JSON.stringify({out,results},null,2))}
