import { defineConfig } from 'vitest/config'

// Fast Nudge unit tests only. The spawned-bridge integration harnesses
// (e2e.mjs, bridge-brutal.mjs, …) are NOT collected here — they run as
// standalone node scripts (see protocols.md) with real ports, SIGKILL drills
// and long real-clock waits, which do not belong in the fast unit gate.
export default defineConfig({
  test: {
    include: ['unit/**/*.test.mjs'],
  },
})
