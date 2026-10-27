// Startup adapter only. Shared suites keep all existing assertions unchanged.
export const bridgeCommand = process.env.NUDGE_CANDIDATE
  ? JSON.parse(process.env.NUDGE_CANDIDATE)
  : [process.execPath, 'bridge/bridge.mjs']
if (!Array.isArray(bridgeCommand) || !bridgeCommand.length || bridgeCommand.some(x => typeof x !== 'string')) throw new Error('NUDGE_CANDIDATE must be a JSON argument array')
