#!/usr/bin/env node
// Portable payload input for a future native installer, NOT an installer or
// service. It never changes the live CLI, Skill, store or native registration.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts/safari')

// Audited against static imports, CLI bridge/watch dynamic imports, /demo,
// setup-agent.sh copies, and install-native-host.sh's ../extension lookup.
// Chrome registration is a separate opt-in operation; its generated wrapper
// and native-host manifests are deliberately absent.
export const RUNTIME_FILES = Object.freeze([
  'LICENSE', 'INSTALL.md',
  'agent/groundworks-nudge.mjs', 'agent/status-check.mjs', 'agent/runtime.mjs', 'agent/nudge-context.mjs',
  'agent/nudge-session-start.sh', 'agent/NUDGE-SKILL.md', 'agent/setup-agent.sh',
  'bridge/bridge.mjs', 'bridge/store.mjs', 'bridge/images.mjs', 'bridge/watch-nudges.mjs',
  'bridge/lease.mjs', 'bridge/lifecycle.mjs', 'bridge/native-host.mjs', 'bridge/http-boundary.mjs',
  'bridge/demo.html', 'bridge/install-native-host.sh',
  'bridge/package.json', 'bridge/package-lock.json',
  'extension/manifest.json', 'extension/platform.js', 'extension/sw.js',
  'extension/queue.js', 'extension/content.js', 'extension/page-hook.js',
  'extension/styles.js', 'extension/options.html', 'extension/options.js',
  'extension/vendor/finder.js', 'extension/vendor/finder-LICENSE.txt', 'extension/vendor/lucide-LICENSE.txt', 'extension/fonts/rn-sans.woff2',
  'extension/fonts/rn-sans-italic.woff2', 'extension/fonts/rn-mono.woff2',
  'extension/fonts/README.md', 'extension/fonts/OFL-IBMPlexSans.txt',
  'extension/icons/icon-16.png', 'extension/icons/icon-32.png',
  'extension/icons/icon-48.png', 'extension/icons/icon-128.png',
  'extension/icons/circle-grey-16.png', 'extension/icons/circle-grey-32.png',
  'extension/icons/circle-grey-48.png', 'extension/icons/circle-grey-128.png',
].sort())

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
function noSymlinks(file, boundary) {
  for (let at = file; at !== boundary; at = path.dirname(at)) {
    let stat
    try { stat = fs.lstatSync(at) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (stat.isSymbolicLink()) throw new Error('Payload paths must not traverse symlinks.')
  }
}

export function validateOutput(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('An output directory is required.')
  const out = path.resolve(ROOT, value)
  if (!out.startsWith(ARTIFACT_ROOT + path.sep)) throw new Error('Output must be a child of artifacts/safari/.')
  noSymlinks(out, ROOT)
  // No recursive replacement: an existing directory may contain unrelated
  // evidence. Callers choose a fresh path, including for repeatability checks.
  if (fs.existsSync(out)) throw new Error('Output already exists; choose a fresh artifact directory.')
  return out
}

export function auditRuntimeSources() {
  const inventory = new Set(RUNTIME_FILES)
  for (const relative of RUNTIME_FILES) {
    const file = path.join(ROOT, relative)
    noSymlinks(file, ROOT)
    if (!fs.statSync(file).isFile()) throw new Error(`Missing regular payload file: ${relative}`)
    if (!relative.endsWith('.sh') && !relative.endsWith('.mjs')) continue
    const source = fs.readFileSync(file, 'utf8')
    if (relative.endsWith('.sh')) {
      for (const match of source.matchAll(/\$HERE\/([A-Za-z0-9._/-]+)/g)) {
        const asset = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]))
        if (asset === 'extension' || asset === 'bridge/native-host-wrapper.sh') continue
        if (!inventory.has(asset)) throw new Error(`Unreviewed setup asset in ${relative}: ${asset}`)
      }
    }
    if (!relative.endsWith('.mjs')) continue
    // These runtime modules use plain imports. Fail when a newly introduced
    // relative literal import has not received a packaging inventory review.
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      if (specifier.startsWith('node:') || specifier === 'ws') continue
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier))
      if (!specifier.startsWith('.') || !inventory.has(dependency)) throw new Error(`Unreviewed import in ${relative}: ${specifier}`)
    }
  }
  const manifest = json(path.join(ROOT, 'extension/manifest.json'))
  const browserFiles = [manifest.background.service_worker, manifest.options_ui.page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => script.js || []),
    ...manifest.web_accessible_resources.flatMap(entry => entry.resources || [])]
  for (const file of browserFiles) if (!inventory.has(`extension/${file}`)) throw new Error(`Unreviewed Chrome resource: ${file}`)
  const pkg = json(path.join(ROOT, 'bridge/package.json'))
  const lock = json(path.join(ROOT, 'bridge/package-lock.json'))
  const dep = lock.packages?.['node_modules/ws']
  if (lock.lockfileVersion !== 3 || JSON.stringify(Object.keys(pkg.dependencies || {})) !== '["ws"]'
      || JSON.stringify(Object.keys(lock.packages || {}).sort()) !== '["","node_modules/ws"]'
      || pkg.version !== lock.version || pkg.version !== lock.packages[''].version
      || pkg.dependencies.ws !== lock.packages[''].dependencies?.ws
      || !dep?.version || dep.resolved !== `https://registry.npmjs.org/ws/-/ws-${dep.version}.tgz`
      || !/^sha512-[A-Za-z0-9+/]+=*$/.test(dep.integrity || '') || dep.license !== 'MIT') {
    throw new Error('Production dependency inventory or lock changed; review packaging before staging.')
  }
  return { productVersion: manifest.version, bridgeVersion: pkg.version, node: pkg.engines.node, dependency: dep }
}

export function stageRuntime({ out: outArg, dependencies = 'install' } = {}) {
  if (!['install', 'locked'].includes(dependencies)) throw new Error('Dependencies must be install or locked.')
  const out = validateOutput(outArg)
  const audited = auditRuntimeSources()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  noSymlinks(out, ROOT)
  fs.mkdirSync(out)
  for (const relative of RUNTIME_FILES) {
    const target = path.join(out, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(ROOT, relative), target)
    fs.chmodSync(target, relative.endsWith('.sh') || relative === 'agent/groundworks-nudge.mjs' ? 0o755 : 0o644)
  }
  if (dependencies === 'install') {
    // npm verifies the tarball against the checked-in integrity. Never copy a
    // developer's node_modules, .npmrc or optional platform-native modules.
    execFileSync('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: path.join(out, 'bridge'), timeout: 120_000, stdio: 'pipe',
    })
    const installed = json(path.join(out, 'bridge/node_modules/ws/package.json'))
    if (installed.name !== 'ws' || installed.version !== audited.dependency.version
        || !fs.readFileSync(path.join(out, 'bridge/node_modules/ws/LICENSE'), 'utf8').includes('Permission is hereby granted, free of charge')) {
      throw new Error('Installed dependency version or license does not match the reviewed inventory.')
    }
    const installedNames = fs.readdirSync(path.join(out, 'bridge/node_modules')).filter(name => name !== '.package-lock.json')
    if (installedNames.length !== 1 || installedNames[0] !== 'ws') throw new Error('Unexpected production dependency was installed.')
  }
  const metadata = {
    format: 1, kind: 'groundworks-nudge-portable-runtime',
    productVersion: audited.productVersion, bridgeVersion: audited.bridgeVersion,
    nodePrerequisite: audited.node, dependencies: dependencies === 'install' ? 'installed-from-lock' : 'lock-only-not-runnable',
    installed: false, nativeAppVerified: false,
    dependencyInventory: [{ name: 'ws', version: audited.dependency.version, license: 'MIT', integrity: audited.dependency.integrity }],
    licenses: ['LICENSE', 'extension/fonts/OFL-IBMPlexSans.txt', 'extension/vendor/finder-LICENSE.txt', 'extension/vendor/lucide-LICENSE.txt',
      ...(dependencies === 'install' ? ['bridge/node_modules/ws/LICENSE'] : [])],
    // These are ownership declarations for a future installer, not a receipt
    // asserting that any user installation or service has been changed.
    sharedComponents: ['agent', 'bridge', 'extension'], safariOwnedComponents: [],
  }
  fs.writeFileSync(path.join(out, 'RUNTIME.json'), JSON.stringify(metadata, null, 2) + '\n')
  const hashes = []
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) {
        fs.chmodSync(file, file.endsWith('.sh') || file === path.join(out, 'agent/groundworks-nudge.mjs') ? 0o755 : 0o644)
        hashes.push(`${sha256(fs.readFileSync(file))}  ${path.relative(out, file).split(path.sep).join('/')}`)
      } else throw new Error('A non-regular file appeared in the payload.')
    }
  }
  visit(out)
  fs.writeFileSync(path.join(out, 'RUNTIME-SHA256'), hashes.join('\n') + '\n')
  return { ...metadata, out: path.relative(ROOT, out), files: hashes.length, resourceHash: sha256(hashes.join('\n')) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {}
    while (args.length) {
      const flag = args.shift(), value = args.shift()
      if (!['--out', '--dependencies'].includes(flag) || !value || value.startsWith('--') || options[flag]) throw new Error('Usage: node scripts/package-runtime.mjs --out artifacts/safari/<fresh-directory> [--dependencies install|locked]')
      options[flag] = value
    }
    console.log(JSON.stringify(stageRuntime({ out: options['--out'], dependencies: options['--dependencies'] }), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
