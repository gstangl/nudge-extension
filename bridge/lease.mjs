import fs from 'node:fs'
import path from 'node:path'

export function acquireStoreLease(storeDir) {
  fs.mkdirSync(storeDir, { recursive: true })
  const file = path.join(storeDir, '.bridge-writer-lease.json')
  const ours = { pid: process.pid, startedAt: new Date().toISOString() }
  try {
    const fd = fs.openSync(file, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify(ours))
    fs.closeSync(fd)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let holder = null
    try { holder = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* malformed means stale */ }
    let alive = false
    if (Number.isInteger(holder?.pid) && holder.pid > 1) {
      try { process.kill(holder.pid, 0); alive = true } catch { /* stale pid */ }
    }
    if (alive) throw new Error(`store writer already held by process ${holder.pid}`)
    // A dead owner cannot release its file. Remove only this exact lock then
    // acquire again with O_EXCL so concurrent recovery still has one winner.
    try { fs.unlinkSync(file) } catch { /* other contender changed it */ }
    const fd = fs.openSync(file, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify(ours))
    fs.closeSync(fd)
  }
  let released = false
  return {
    file,
    release() {
      if (released) return
      released = true
      try {
        const holder = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (holder.pid === process.pid) fs.unlinkSync(file)
      } catch { /* process teardown must not throw */ }
    },
  }
}
