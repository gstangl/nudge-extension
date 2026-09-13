// Serial runner: suites share ports and visible-window focus. Never run these
// browser suites concurrently. Native startup is disabled before worker load.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import {spawn, execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactRoot = path.join(root,'artifacts/safari')
fs.mkdirSync(artifactRoot,{recursive:true})
const out = fs.mkdtempSync(path.join(artifactRoot,'regression-'))
const extension = path.join(out,'extension')
const report = {headless:process.argv.includes('--headless'),results:[]}
report.resources = JSON.parse(execFileSync(process.execPath,['scripts/package-safari.mjs','--mode','test','--use-storage-port','--out',path.relative(root,extension)],{cwd:root,encoding:'utf8'}))
const suites = {
  'e2e':[4720], 'fixture-gauntlet':[4722,5320], 'toolbar-ux':[4785,5196],
  'page-inertness':[5192], 'escape-clear':[5194], 'multi-select':[5195],
  'reload-resilience':[5196,4799], 'amend':[4788,5188], 'cancel':[4791,5191,5192],
  'capture-stall':[4795], 'off-means-off':[4786,5201],
  'battletest':[4793,5321],
}
async function free(port) {
  const server=net.createServer()
  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve))
  await new Promise(resolve=>server.close(resolve))
}
for (const [suite,ports] of Object.entries(suites)) {
  const result={suite}
  try {
    for (const port of ports) await free(port)
    console.log(`RUN ${suite} (${report.headless?'headless Chromium':'visible Chromium'})`)
    const child=spawn(process.execPath,[`test/${suite}.mjs`],{cwd:root,env:{...process.env,NUDGE_EXT:extension,NUDGE_HEADLESS:report.headless?'1':'0',NUDGE_NO_RELOAD:'1'},stdio:['ignore','pipe','pipe']})
    let output=''
    child.stdout.on('data',b=>{output+=b;process.stdout.write(b)})
    child.stderr.on('data',b=>{output+=b;process.stderr.write(b)})
    result.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
    result.verdict=result.exitCode===0?'passed':'failed'
    fs.writeFileSync(path.join(out,suite+'.log'),output)
  } catch(error) {result.verdict='blocked';result.error=String(error)}
  report.results.push(result)
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log('Evidence:',path.relative(root,path.join(out,'report.json')))
if(report.results.some(r=>r.verdict!=='passed'))process.exitCode=1
