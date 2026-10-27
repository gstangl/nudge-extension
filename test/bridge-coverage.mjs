// Map all 115 catalog cases to the checks that actually ran in one recorder
// report (plus optional diagnostic reports). A case is "passed" only when it is
// fully mapped and every assertion file ran green; partial mappings stay
// "partially-exercised", unmapped cases "unavailable", unexecuted ones "not-run".
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {root} from './support/bridge-candidate.mjs'
import {validateCatalog} from './support/bridge-catalog.mjs'
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}
const checks=option('--checks');assert(checks&&fs.existsSync(path.join(checks,'report.json')),'--checks <recorder directory> required')
const recorder=JSON.parse(fs.readFileSync(path.join(checks,'report.json'),'utf8'))
const catalog=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/bridge-comparison/catalog.json'),'utf8'));validateCatalog(catalog)
// Assertion file -> recorder check ids that execute it (runner membership is
// read from run-portable-regression.mjs, run-browser-regression.mjs and
// bridge-checks.mjs; unit files run in the portable fast gate).
const runs=Object.fromEntries(recorder.results.map(r=>[r.id,r.verdict]))
const portable=['bridge-boundary','bridge-realtime','browser-protocol','bridge-lifecycle','bridge-hardening','bridge-brutal','origin-routing','provenance','hook-optin','wake-mode','runtime-neutral']
const browser=['e2e','fixture-gauntlet','toolbar-ux','page-inertness','escape-clear','multi-select','reload-resilience','amend','cancel','capture-stall','off-means-off','battletest']
const shared=['bridge-conformance','bridge-image-conformance','bridge-retention','bridge-origin-headers','bridge-half-close','bridge-owner-tie','browser-protocol','bridge-boundary','bridge-realtime']
const direct={'bridge-commit-faults':['commit-fault-js','commit-fault-rust'],'bridge-withdrawal-fault':['withdrawal-fault-js','withdrawal-fault-rust'],'bridge-rollback':['rollback'],'bridge-canonical-retry':['canonical-retry'],'bridge-differential':['differential'],'bridge-mutants':['negative-controls'],'bridge-harness-interrupt':['interrupt'],'browser-coexistence':['browser-coexistence'],'browser-parity':['browser-parity'],'chrome-delivery':['chromium-js','chromium-rust']}
const diagnostics=(process.argv.flatMap((a,i)=>a==='--diagnostic'?[process.argv[i+1]]:[])).map(entry=>{const [file,report]=entry.split('=');const r=JSON.parse(fs.readFileSync(report,'utf8'));return {file,report,verdict:r.verdict}})
function executors(assertion){
 const file=assertion.split(':')[0].trim(),name=path.basename(file,'.mjs')
 const ids=[]
 if(file.startsWith('test/unit/'))ids.push('portable')
 if(shared.includes(name))ids.push(`js-${name}`,`rust-${name}`)
 if(portable.includes(name))ids.push('portable')
 if(browser.includes(name))ids.push('browser-regression')
 if(direct[name])ids.push(...direct[name])
 return {file,checks:[...new Set(ids)].filter(id=>id in runs).map(id=>({id,verdict:runs[id]})),diagnostics:diagnostics.filter(d=>d.file===file)}
}
const cases=catalog.scenarios.map(c=>{
 const assertions=c.assertions.map(a=>({assertion:a,...executors(a)}))
 const ran=a=>a.checks.length||a.diagnostics.length
 const green=a=>[...a.checks.map(x=>x.verdict),...a.diagnostics.map(x=>x.verdict)].every(v=>v==='passed'||v==='inconclusive')
 let execution
 if(!assertions.length)execution='unavailable'
 else if(assertions.some(a=>ran(a)&&!green(a)))execution='failed'
 else if(!assertions.every(ran))execution=assertions.some(ran)?'partially-run':'not-run'
 else execution=c.coverage==='mapped'?'passed':'partially-exercised'
 return {id:c.id,requirements:c.requirements,coverage:c.coverage,execution,assertions,missing_prerequisites:c.missing_prerequisites}
})
const totals=cases.reduce((t,c)=>(t[c.execution]=(t[c.execution]||0)+1,t),{})
const report={scope:'Local recorder evidence only; a passing check covers its mapped assertions, never the whole catalog',recorder:{dir:path.relative(root,checks),revision:recorder.revision,source:recorder.source,verdict:recorder.verdict},diagnostics,totals,cases}
const out=option('--out')||path.join(checks,'coverage.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({out,totals},null,2))
