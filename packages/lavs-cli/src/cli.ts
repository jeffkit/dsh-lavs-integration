#!/usr/bin/env node
/**
 * lavs — agent-facing thin client over the running dsh lavs-host adapter.
 *
 * Verbs (see USAGE in ./args.ts): list / schema / call / init / url.
 * Calls route through the running host (never direct storage writes), so
 * mutations stay in one auditable stream and mounted views refresh over
 * SSE. `init` scaffolds a minimal, loader-valid bundle skeleton.
 * @module dsh-plugin-lavs-cli
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs, CliError, USAGE } from './args.ts'

interface BundleInfo {
  name: string
  contentType: string
  version: string
  description?: string
  hasView: boolean
  endpoints: Array<{ id: string; method: string; description?: string }>
}

interface BundleSchema {
  name: string
  contentType: string
  version: string
  description?: string
  endpoints: Array<{ id: string; method: string; description?: string; input?: unknown }>
}

async function request(url: string, token: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload: unknown = text
  try { payload = JSON.parse(text) } catch { /* non-JSON error bodies pass through */ }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : text
    throw new CliError(`HTTP ${response.status}: ${message}`)
  }
  return payload
}

function printBundles(infos: BundleInfo[]): void {
  for (const info of infos) {
    const view = info.hasView ? 'view ✓' : 'data only'
    console.log(`${info.name}  (${info.contentType} v${info.version}, ${view})`)
    if (info.description !== undefined) console.log(`  ${info.description}`)
    for (const endpoint of info.endpoints) {
      console.log(`  ${endpoint.method.padEnd(9)} ${info.name}.${endpoint.id}${endpoint.description === undefined ? '' : ` — ${endpoint.description}`}`)
    }
  }
  if (infos.length === 0) console.log('no bundles visible (check LAVS_BUNDLES_DIR / bundlesDir config)')
}

function printSchema(schema: BundleSchema): void {
  console.log(`${schema.name}  (${schema.contentType} v${schema.version})`)
  if (schema.description !== undefined) console.log(`  ${schema.description}`)
  for (const endpoint of schema.endpoints) {
    console.log(`\n${endpoint.method.padEnd(9)} ${schema.name}.${endpoint.id}${endpoint.description === undefined ? '' : ` — ${endpoint.description}`}`)
    if (endpoint.input !== undefined) console.log(`  input: ${JSON.stringify(endpoint.input)}`)
  }
}

/** Scaffold a minimal, loader-valid bundle skeleton (refuses to overwrite). */
function initBundle(dirArg: string, nameArg: string | undefined): void {
  const dir = resolve(dirArg)
  const name = nameArg ?? basename(dir)
  const manifestPath = join(dir, 'lavs.json')
  if (existsSync(manifestPath)) throw new CliError(`refusing to overwrite existing ${manifestPath}`)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'view'), { recursive: true })
  const manifest = {
    lavs: '1.0',
    name,
    contentType: `lavs/${name}`,
    version: '0.1.0',
    description: `${name} — scaffolded by lavs init`,
    endpoints: [
      {
        id: 'ping',
        method: 'query',
        description: 'liveness probe returning { name } as JSON',
        handler: { type: 'script', command: 'echo', args: [JSON.stringify({ name })] },
      },
    ],
    view: { entry: 'index.html' },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(dir, 'view', 'index.html'),
    `<!doctype html>\n<html><body style="font-family: system-ui; padding: 24px">\n  <h2>${name}</h2>\n  <p>Scaffolded view — edit <code>view/index.html</code>; data endpoints live in <code>lavs.json</code>.</p>\n</body></html>\n`,
  )
  console.log(`scaffolded bundle "${name}" at ${dir}`)
  console.log(`  ${manifestPath}   — declare query/mutation endpoints here`)
  console.log(`  ${join(dir, 'view', 'index.html')}   — the rendered view (postMessage bridge is wired by the host)`)
  console.log('next: copy this dir under <project>/.lavs/bundles/ or the host bundlesDir, then `lavs list`')
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.flags.has('help') || args.positional.length === 0) {
    console.log(USAGE)
    return 0
  }
  const [verb, bundle, endpoint] = args.positional
  if (verb === 'url') {
    console.log(`${args.url} (pid/discovery in ~/.dsh/lavs-host.json)`)
    return 0
  }
  if (verb === 'init') {
    if (bundle === undefined) throw new CliError('usage: lavs init <dir> [--name <name>]')
    initBundle(bundle, args.positional[2] === undefined ? undefined : args.positional[2])
    return 0
  }
  if (verb === 'list') {
    const payload = await request(args.url, args.token, '/list', {
      ...(args.preset === undefined ? {} : { presetId: args.preset }),
      ...(args.workspace === undefined ? {} : { workspaceCwd: args.workspace }),
    })
    if (args.json) { console.log(JSON.stringify(payload, null, 2)); return 0 }
    printBundles(payload as BundleInfo[])
    return 0
  }
  if (verb === 'schema') {
    if (bundle === undefined) throw new CliError('usage: lavs schema <bundle>')
    const payload = await request(args.url, args.token, `/schema?bundle=${encodeURIComponent(bundle)}`)
    if (args.json) { console.log(JSON.stringify(payload, null, 2)); return 0 }
    printSchema(payload as BundleSchema)
    return 0
  }
  if (verb === 'call') {
    if (bundle === undefined || endpoint === undefined) throw new CliError('usage: lavs call <bundle> <endpoint> [--input \'<json>\']')
    let parsed: unknown
    if (args.input !== undefined) {
      try { parsed = JSON.parse(args.input) } catch (e) {
        throw new CliError(`--input is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const payload = await request(args.url, args.token, '/call', { bundle, endpoint, input: parsed })
    console.log(args.json ? JSON.stringify(payload, null, 2) : JSON.stringify((payload as { result?: unknown }).result))
    return 0
  }
  throw new CliError(`unknown verb "${verb}" — try lavs --help`)
}

main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
  console.error(`lavs: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
