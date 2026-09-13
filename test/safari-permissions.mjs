// Native Safari permissions are outside WebDriver's page API. Use fresh AX
// observations and address ONLY the extension installed by this test. No global
// security preference changes and no blanket "all websites" grant.
import { execFileSync } from 'node:child_process'
const run = args => {
  const result = JSON.parse(execFileSync('peekaboo', [...args, '--no-remote', '--json'], { encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL' }))
  if (!result.success) throw new Error(`Safari native UI: ${JSON.stringify(result.error)}`)
  return result.data
}
let fixtureTitle = 'Nudge browser parity fixture'
export function setFixtureTitle(title) { fixtureTitle = title }
const appleScript = script => execFileSync('osascript', ['-e', `with timeout of 4 seconds\n${script}\nend timeout`], {timeout:5000,killSignal:'SIGKILL',encoding:'utf8'})
export function openPermissionWindow(url) {
  appleScript(`tell application "Safari" to make new document with properties {URL:${JSON.stringify(url)}}`)
}
export function closePermissionWindow() {
  appleScript(`tell application "Safari" to close (every window whose name is ${JSON.stringify(fixtureTitle)})`)
}
const observe = () => run(['see', '--app', 'com.apple.Safari', '--window-title', fixtureTitle, '--capture-engine', 'classic'])
const click = (snapshot, element) => run(['click', '--app', 'com.apple.Safari', '--on', element.id, '--snapshot', snapshot.snapshot_id])
export function pressExtension(identifier) {
  const snapshot = observe()
  const element = snapshot.ui_elements.find(e => e.identifier === `WebExtension-${decodeURIComponent(identifier)}`)
  if (!element) throw new Error('Installed Safari extension action not found in the test window')
  click(snapshot, element)
}
export function existingNudgeActions() {
  return observe().ui_elements.filter(e => e.identifier?.startsWith('WebExtension-') && e.label?.startsWith('Groundworks Nudge')).map(e => e.identifier.slice('WebExtension-'.length))
}
export async function grantCurrentSite(identifier) {
  pressExtension(identifier)
  let snapshot
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 150))
    snapshot = observe()
    const button = snapshot.ui_elements.find(e => ['Always Allow on This Website', 'Auf dieser Website immer erlauben'].includes(e.label))
    if (button) { click(snapshot, button); return }
  }
  throw new Error(`Safari site-access prompt unavailable: ${JSON.stringify(snapshot.ui_elements.filter(e=>e.role==='button').map(e=>e.label))}`)
}
