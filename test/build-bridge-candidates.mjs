// Stage distinct production/fault bytes, restoring the normal target executable.
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {root,commandBinding} from './support/bridge-candidate.mjs'
const out=path.join(root,'artifacts/bridge-comparison/bin');fs.mkdirSync(out,{recursive:true})
const executable=path.join(root,'bridge-rust/target/release/nudge-bridge-experiment')
const stage=name=>{const file=path.join(out,name);fs.copyFileSync(executable,file);fs.chmodSync(file,fs.statSync(executable).mode);return file}
execFileSync('cargo',['build','--locked','--release','--manifest-path','bridge-rust/Cargo.toml'],{cwd:root,stdio:'inherit'})
const production=stage('rust-production');let fault
try{
 execFileSync('cargo',['build','--locked','--release','--features','fault-hooks','--manifest-path','bridge-rust/Cargo.toml'],{cwd:root,stdio:'inherit'})
 fault=stage('rust-fault-hooks')
}finally{fs.copyFileSync(production,executable)}
const report={production:commandBinding([production]),fault:commandBinding([fault]),rustc:execFileSync('rustc',['--version'],{encoding:'utf8'}).trim()};fs.writeFileSync(path.join(out,'builds.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
