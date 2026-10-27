// Export selected artifact directories as sanitized text evidence. Machine
// prefixes become logical placeholders; every line, attempt, timing and hash is
// kept. Binary files are omitted with their SHA-256. Original and exported
// hashes are recorded so the export never poses as the original bytes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}
const out=option('--out'),scope=option('--scope');assert(out&&scope,'--out <dir> and --scope <text> required')
const sources=process.argv.flatMap((a,i)=>a==='--from'?[process.argv[i+1]]:[]);assert(sources.length,'at least one --from <name=dir>')
assert(!fs.existsSync(out),'export directory exists; choose a fresh one');fs.mkdirSync(out,{recursive:true})
const replacements=[]
for(const arg of process.argv.flatMap((a,i)=>a==='--root'?[process.argv[i+1]]:[])){const [label,prefix]=arg.split('=');replacements.push([fs.realpathSync(prefix),`<${label}>`],[prefix,`<${label}>`])}
for(const [prefix,label]of [[fs.realpathSync(os.tmpdir()),'<tmp>'],[os.tmpdir(),'<tmp>'],['/private/tmp','<tmp>'],['/tmp','<tmp>'],[os.homedir(),'<home>'],[path.dirname(process.execPath),'<toolchain>']])replacements.push([prefix,label])
replacements.sort((a,b)=>b[0].length-a[0].length)
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const text=b=>!b.includes(0)&&Buffer.from(b.toString('utf8'),'utf8').equals(b)
const files=[],omitted=[]
for(const source of sources){
 const [name,dir]=source.split('=')
 const walk=rel=>{for(const entry of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){const r=path.join(rel,entry.name);if(entry.isDirectory())walk(r);else if(entry.isFile()){
  const bytes=fs.readFileSync(path.join(dir,r)),target=path.join(name,r)
  if(!text(bytes)){omitted.push({path:target,reason:'binary/generated artifact; target must rebuild',sha256:sha(bytes)});continue}
  let body=bytes.toString('utf8');for(const [prefix,label]of replacements)body=body.split(prefix).join(label)
  fs.mkdirSync(path.dirname(path.join(out,target)),{recursive:true});fs.writeFileSync(path.join(out,target),body)
  files.push({path:target,original_sha256:sha(bytes),exported_sha256:sha(Buffer.from(body)),redacted:body!==bytes.toString('utf8')})}}}
 walk('')
}
const manifest={format:1,scope,transformations:['repository roots replaced with logical placeholders','home and OS temporary prefixes replaced with logical placeholders','absolute toolchain prefix replaced with placeholder'],retained:'All text lines, outcomes, attempts, timings, source/build hashes and synthetic identities; no success-only filtering',omitted,files}
fs.writeFileSync(path.join(out,'evidence-export.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({out,files:files.length,omitted:omitted.length},null,2))
