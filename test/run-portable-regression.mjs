// Serial portable verification with retained logs. Do not run alongside browser
// suites: hardening/lifecycle/wake use ports also reserved by browser fixtures.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const base=path.join(root,'artifacts/safari')
fs.mkdirSync(base,{recursive:true})
const out=fs.mkdtempSync(path.join(base,'portable-'))
const report={scope:'portable Node contracts only; no Safari/native/distribution claim',results:[]}
const cases=[
  ['fast-gate','npm',['run','test:ci'],'test',[4817]],
  ...Object.entries({'browser-protocol':[4821],'bridge-lifecycle':[4822,4823],'bridge-hardening':[4799],
    'bridge-brutal':[4798],'origin-routing':[4783],'provenance':[4794],'hook-optin':[4797],'wake-mode':[4788]})
    .map(([name,ports])=>[name,process.execPath,[`test/${name}.mjs`],'.',ports]),
  ['resource-smoke',process.execPath,['test/safari-e2e.mjs','--smoke'],'.',[]],
]
async function free(port) {
  const server=net.createServer()
  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve))
  await new Promise(resolve=>server.close(resolve))
}
for (const [name,command,args,cwd,ports] of cases) {
  const result={name,command:[command===process.execPath?'node':command,...args].join(' ')}
  try {
    for(const port of ports)await free(port)
    console.log(`RUN ${name}`)
    const child=spawn(command,args,{cwd:path.resolve(root,cwd),env:{...process.env,NUDGE_NO_RELOAD:'1'},stdio:['ignore','pipe','pipe']})
    let output=''
    child.stdout.on('data',data=>{output+=data})
    child.stderr.on('data',data=>{output+=data})
    result.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
    result.verdict=result.exitCode===0?'passed':'failed'
    fs.writeFileSync(path.join(out,name+'.log'),output)
    console.log(`${result.verdict.toUpperCase()} ${name}`)
    if(result.exitCode!==0)console.error(output.slice(-5000))
  } catch(error){result.verdict='blocked';result.error=String(error)}
  report.results.push(result)
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log(`Evidence: ${path.relative(root,out)}/report.json`)
if(report.results.some(result=>result.verdict!=='passed'))process.exitCode=1
