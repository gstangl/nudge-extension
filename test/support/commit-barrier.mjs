// Node test preload only, absent from production startup and timing lanes.
import fs from 'node:fs'
import path from 'node:path'
const mode=process.env.NUDGE_TEST_BARRIER
const signal=process.env.NUDGE_TEST_SIGNAL
const write=fs.writeFileSync.bind(fs),rename=fs.renameSync.bind(fs)
const pause=stage=>{if(mode!==stage)return;write(signal,stage);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}
fs.writeFileSync=function(file,...args){const watched=String(file)===path.join(process.env.NUDGE_STORE,'store.json.tmp');if(watched)pause('write-start');const result=write(file,...args);if(watched)pause('write-complete');return result}
fs.renameSync=function(from,...args){const watched=String(from)===path.join(process.env.NUDGE_STORE,'store.json.tmp');if(watched)pause('pre-rename');const result=rename(from,...args);if(watched)pause('post-rename');return result}
