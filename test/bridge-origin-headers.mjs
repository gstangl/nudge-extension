import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {candidate,root,binding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison',`origin-headers-${Date.now()}`);fs.mkdirSync(out,{recursive:true});const source=binding();fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2));const b=await candidate();const results=[]
try{
 await b.start()
 for(const[name,origin]of[['duplicate',Buffer.from('Origin: http://localhost:5322\r\nOrigin: http://localhost:5322\r\n')],['invalid-utf8',Buffer.concat([Buffer.from('Origin: '),Buffer.from([255]),Buffer.from('\r\n')])]]){
  const response=await new Promise((resolve,reject)=>{let data='';const socket=net.connect(b.port,'127.0.0.1');socket.setTimeout(2000,()=>socket.destroy(new Error('raw request deadline')));socket.on('connect',()=>socket.end(Buffer.concat([Buffer.from(`GET /comments HTTP/1.1\r\nHost: 127.0.0.1:${b.port}\r\nConnection: close\r\n`),origin,Buffer.from('\r\n')])));socket.on('data',chunk=>{data+=chunk});socket.on('end',()=>resolve(data));socket.on('error',reject)})
  try{assert.match(response,/^HTTP\/1\.1 (400|403) /,'malformed Origin must not become missing Origin');results.push({name,verdict:'passed',response})}catch(error){results.push({name,verdict:'failed',error:error.stack,response});process.exitCode=1}
 }
 assert.equal((await b.request('/comments',{text:'Healthy peer after malformed headers'})).status,201);assert.equal(binding().sha256,source.sha256)
}catch(error){results.push({verdict:'failed',error:error.stack});process.exitCode=1}finally{await b.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({source:source.sha256,argv:b.argv,build:b.build,results},null,2));console.log(JSON.stringify({out,results},null,2))}
