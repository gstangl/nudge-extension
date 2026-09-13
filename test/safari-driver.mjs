// Minimal W3C WebDriver client. Real input uses actions, never DOM click().
export class SafariDriver {
  constructor(base) { this.base = base; this.session = null }
  async request(method, route, body) {
    const response = await fetch(this.base + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    })
    const result = await response.json()
    if (!response.ok || result.value?.error) throw new Error(`${method} ${route}: ${JSON.stringify(result.value)}`)
    return result.value
  }
  command(method, route, body) { return this.request(method, `/session/${this.session}${route}`, body) }
  async start() {
    const result = await this.request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })
    this.session = result.sessionId
    this.capabilities = result.capabilities
  }
  async install(directory) {
    const value = await this.command('POST', '/webextension', { type: 'path', path: directory })
    return typeof value === 'string' ? value : value.extension
  }
  uninstall(id) { return this.command('DELETE', `/webextension/${id}`) }
  evaluate(fn, arg) { return this.command('POST', '/execute/sync', { script: `return (${fn.toString()})(arguments[0])`, args: [arg ?? null] }) }
  goto(url) { return this.command('POST', '/url', { url }) }
  reload() { return this.command('POST', '/refresh', {}) }
  async pointer(actions) {
    await this.command('POST', '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] })
  }
  move(x, y, duration = 0) { return { type: 'pointerMove', origin: 'viewport', x: Math.round(x), y: Math.round(y), duration } }
  movePointer(x, y) { return this.pointer([this.move(x, y, 90)]) }
  windowSize() { return this.command('GET', '/window/rect') }
  resize(width, height) { return this.command('POST', '/window/rect', { width, height }) }
  async click(x, y) { await this.pointer([this.move(x, y), { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }]) }
  async drag(points) {
    await this.pointer([this.move(...points[0]), { type: 'pointerDown', button: 0 },
      ...points.slice(1).map(p => this.move(...p, 90)), { type: 'pointerUp', button: 0 }])
  }
  async key(value) { await this.keys([{ type: 'keyDown', value }, { type: 'keyUp', value }]) }
  keyDown(value) { return this.keys([{ type: 'keyDown', value }]) }
  keyUp(value) { return this.keys([{ type: 'keyUp', value }]) }
  keys(actions) { return this.command('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions }] }) }
  async type(text) { for (const value of text) await this.key(value) }
  async close() { if (this.session) await this.command('DELETE', ''); this.session = null }
}
