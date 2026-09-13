import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Unknown is occupied: malformed historical leases and EPERM are not proof
// that a writer is dead. PID reuse also fails closed.
export function leaseOwnerAlive(holder, kill = process.kill) {
  if (!Number.isInteger(holder?.pid) || holder.pid <= 1) return true
  try { kill(holder.pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}
function readHolder(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export function acquireStoreLease(storeDir) {
  fs.mkdirSync(storeDir, { recursive: true })
  const file = path.join(storeDir, '.bridge-writer-lease.json')
  const guard = path.join(storeDir, '.bridge-writer-recovery.json')
  const ours = { pid: process.pid, nonce: crypto.randomUUID(), startedAt: new Date().toISOString() }
  const staged = path.join(storeDir, `.bridge-writer-${ours.nonce}.tmp`)
  // Atomically publish an already-complete inode, never an empty lease file.
  const fd = fs.openSync(staged, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(ours)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  let guarded = false
  try {
    try { fs.linkSync(staged, file) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      // Never steal this recovery guard. A crash in the tiny removal section
      // needs inspection, not a recursive stale-lock race that can unlink a
      // fresh owner's lease. Ordinary owner crashes remain recoverable.
      try { fs.linkSync(staged, guard); guarded = true } catch (error) {
        if (error.code === 'EEXIST') throw new Error('store recovery is locked; retry, or inspect its recovery guard if the process exited')
        throw error
      }
      const holder = readHolder(file)
      if (fs.existsSync(file)) {
        if (leaseOwnerAlive(holder)) throw new Error('store writer lease is occupied or its owner cannot be proven dead')
        fs.unlinkSync(file)
      }
      // Another contender can publish into the gap. Linking loses safely;
      // never unlink that new winner's lease.
      fs.linkSync(staged, file)
    }
  } finally {
    if (guarded) fs.unlinkSync(guard)
    fs.unlinkSync(staged)
  }
  let released = false
  return {
    file,
    release() {
      if (released) return
      released = true
      try {
        const holder = readHolder(file)
        if (holder?.pid === ours.pid && holder.nonce === ours.nonce) fs.unlinkSync(file)
      } catch { /* process teardown must not throw */ }
    },
  }
}
