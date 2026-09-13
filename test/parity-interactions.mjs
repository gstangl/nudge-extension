// Shared browser acceptance interactions. DOM evaluation is observation or
// fixture setup only; every extension/page interaction uses real input actions.
import assert from 'node:assert/strict'

const SHIFT = '\uE008'
const ENTER = '\uE007'
export async function runInteractions({ driver, check, inspect, click, escape, readStore, until, report }) {
  assert.equal(typeof driver.keyDown, 'function', 'Browser adapter must implement real keyDown')
  assert.equal(typeof driver.keyUp, 'function', 'Browser adapter must implement real keyUp')
  const active = async selector => (await inspect(selector))?.cls.split(/\s+/).includes('active') === true
  const shift = async action => {
    await driver.keyDown(SHIFT)
    try { await action() } finally { await driver.keyUp(SHIFT) }
  }
  const rowFor = async id => {
    for (let index = 1; index <= readStore().pins.length + 5; index++) {
      const row = `.q-list > .q-row:nth-child(${index})`
      if ((await inspect(row + ' .q-id'))?.text === id) return row
    }
    return null
  }
  const openQueue = async () => {
    if (!(await inspect('.queue'))?.cls.includes('on')) await click('.count')
    await until(async () => (await inspect('.queue'))?.cls.includes('on'), 'history popover opens')
  }

  await check('real keyboard P/F/Escape and editable-field shortcut gating', async () => {
    await escape()
    await click('h1', true)
    await driver.key('p')
    await until(() => active('.btn-pick'), 'P selects Pick')
    await escape()
    assert.equal(await active('.btn-pick'), false)
    await driver.key('f')
    await until(() => active('.btn-draw'), 'F selects Freeform')
    await escape()
    assert.equal(await active('.btn-draw'), false)
    const beforeCount = readStore().pins.length
    await click('#page-input', true)
    await driver.type('pf')
    assert.equal((await inspect('#page-input', true)).value, 'pf')
    assert.equal(await active('.btn-pick'), false, 'Typing p must not arm the picker')
    assert.equal(await active('.btn-draw'), false, 'Typing f must not arm freeform')
    await escape()
    assert.equal((await inspect('#page-input', true)).value, 'pf')
    assert.equal(readStore().pins.length, beforeCount)
    await click('h1', true)
  })

  let multiPin
  await check('real Shift multi-select, toggle, retained draft and UI send', async () => {
    const text = '[TEST-parity] Swap both targets'
    await click('.btn-pick')
    await click('#target', true)
    await driver.type(text)
    await shift(() => click('#second', true))
    await until(async () => (await inspect('.composer .meta'))?.text.includes('2 elements'), 'two selected elements')
    assert((await inspect('.composer .meta')).text.includes('#target'))
    assert((await inspect('.composer .meta')).text.includes('#second'))
    assert.equal((await inspect('.composer textarea')).value, text, 'Extending must preserve typed text')
    await shift(() => click('#second', true))
    await until(async () => (await inspect('.composer .meta'))?.text.startsWith('1 element'), 'Shift toggles the second target off')
    await shift(() => click('#second', true))
    await until(async () => (await inspect('.composer .meta'))?.text.includes('2 elements'), 'Shift adds the target back')
    await driver.type(' pf')
    assert.equal((await inspect('.composer textarea')).value, text + ' pf', 'Shadow-DOM typing must not trigger p/f tools while collecting')
    await click('.composer .send')
    multiPin = await until(() => readStore().pins.find(pin => pin.text === text + ' pf'), 'multi-target prompt stored')
    assert.deepEqual(multiPin.targets.map(target => target.selector), ['#target', '#second'])
    assert(!multiPin.screenshot, 'Multi-element prompt is DOM context, not pixel evidence')
    await until(async () => !(await inspect('.composer'))?.visible, 'sent multi composer closes')
  })

  let draftPin
  await check('DOM draft, newline and target survive real browser reload', async () => {
    const text = '[TEST-parity] Draft survives\npf remain text'
    await click('.btn-pick')
    await click('#second', true)
    await driver.type('[TEST-parity] Draft survives')
    await shift(() => driver.key(ENTER))
    await driver.type('pf remain text')
    assert.equal((await inspect('.composer textarea')).value, text)
    await until(() => driver.evaluate(expected => {
      const snapshot = JSON.parse(sessionStorage.getItem('__rootsNudgeSession') || 'null')
      return snapshot?.composer?.text === expected
    }, text), 'durable per-tab composer snapshot')
    const count = readStore().pins.length
    await driver.reload()
    await until(async () => (await inspect('.composer'))?.visible, 'composer restored after reload')
    await until(async () => (await inspect('.composer textarea'))?.value === text, 'restored exact draft text')
    assert((await inspect('.composer .meta')).text.includes('#second'))
    assert.equal(readStore().pins.length, count, 'Reload must not submit the draft')
    await click('.composer .send')
    draftPin = await until(() => readStore().pins.find(pin => pin.text === text), 'restored draft sent through UI')
    assert.equal(draftPin.target.selector, '#second')
    assert.equal(draftPin.browserSource.session, multiPin.browserSource.session)
    assert.equal(draftPin.browserSource.tab, multiPin.browserSource.tab)
    assert.notEqual(draftPin.browserSource.document, multiPin.browserSource.document, 'Reload creates a successor document, not a copied token')
  })

  await check('real History amendment, multiline entry, immutable owner and withdrawal', async () => {
    await until(async () => !(await inspect('.composer'))?.visible, 'draft composer sent')
    await openQueue()
    let row = await until(() => rowFor(draftPin.id), 'draft pin history row')
    await click(row + ' .q-add')
    await until(async () => (await inspect('.q-row.amending .q-amend-input'))?.visible, 'amend field open')
    await driver.type('Keep the spacing')
    await shift(() => driver.key(ENTER))
    await driver.type('and the colour')
    const amendment = 'Keep the spacing\nand the colour'
    assert.equal((await inspect('.q-row.amending .q-amend-input')).value, amendment)
    await click('.q-row.amending .q-amend-send')
    const amended = await until(() => {
      const pin = readStore().pins.find(pin => pin.id === draftPin.id)
      return pin?.amendments?.length === 1 && pin
    }, 'amendment stored once')
    assert.equal(amended.amendments[0].text, amendment)
    assert.equal(amended.text, draftPin.text, 'Amend is append-only')
    assert.deepEqual(amended.owner, draftPin.owner, 'Amend must not reattribute the owner')
    row = await until(() => rowFor(draftPin.id), 'amended row refreshed')
    await until(async () => (await inspect(row + ' .q-amend-item'))?.text === amendment, 'amendment rendered in History')
    await click(row + ' .q-x')
    await until(() => !readStore().pins.some(pin => pin.id === draftPin.id), 'withdrawn pin removed')
    assert(readStore().receipts.some(receipt => receipt.id === draftPin.id && receipt.withdrawn), 'Withdrawal retains a non-content deduplication receipt')
    await until(async () => (await inspect('.feed'))?.text.includes('withdrawn'), 'honest withdrawal feedback')
    await escape()
  })

  await check('page outside-click popover survives toolbar controls and near-miss', async () => {
    await escape()
    // A deliberately hostile document-capture outside-click handler models page
    // dropdowns. This installs fixture behavior; it does not operate Nudge.
    await driver.evaluate(() => {
      const pop = document.getElementById('page-pop')
      const trigger = document.createElement('button')
      trigger.id = 'parity-pop-toggle'
      trigger.textContent = 'Toggle page popover'
      trigger.style.cssText = 'position:fixed;left:40px;bottom:120px;z-index:10'
      trigger.addEventListener('click', () => { pop.hidden = !pop.hidden })
      document.body.appendChild(trigger)
      document.addEventListener('pointerdown', event => {
        if (!pop.hidden && !pop.contains(event.target) && !trigger.contains(event.target)) pop.hidden = true
      }, true)
    })
    await click('#parity-pop-toggle', true)
    await until(async () => (await inspect('#page-pop', true))?.visible, 'page popover opens via real click')
    await click('.status')
    await until(async () => (await inspect('.status-menu'))?.cls.includes('on'), 'toolbar control remains operable')
    assert((await inspect('#page-pop', true)).visible, 'Toolbar click must not dismiss page state')
    await click('.status')
    const pill = await inspect('.pill')
    assert(pill.x > 12, 'Near-miss requires room beside the toolbar')
    await driver.click(pill.x - 6, pill.y + pill.h / 2)
    assert((await inspect('#page-pop', true)).visible, 'Toolbar margin must absorb near-miss')
    await click('h1', true)
    await until(async () => !(await inspect('#page-pop', true))?.visible, 'ordinary page click still dismisses page popover')
  })
  report.interactions = { multiPin: multiPin.id, withdrawnPin: draftPin.id, input: 'real WebDriver/Playwright pointer and keyboard actions' }
}
