#!/usr/bin/env node
/**
 * lavs — agent-facing thin client over the running dsh lavs-host adapter.
 *
 * Three verbs, manifest-driven, zero per-bundle code:
 *   lavs list [--preset <id>] [--json]
 *   lavs schema <bundle> [--json]
 *   lavs call <bundle> <endpoint> [--input '<json>'] [--json]
 *   lavs url                          # show the discovered host endpoint
 *
 * Why a CLI and not registered tools: N bundles × M endpoints of tool
 * schemas are a fixed context tax; this surface is one command name whose
 * details load per scenario (skill + `lavs schema`). Calls route through
 * the running host (never direct storage writes), so mutations stay in one
 * auditable stream and mounted views refresh over SSE.
 *
 * Discovery order: --url/--token flags → LAVS_HOST_URL/LAVS_HOST_TOKEN env
 * → ~/.dsh/lavs-host.json (written by the lavs-host adapter at boot).
 * @module dsh-plugin-lavs-cli
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface Discovery {
  port: number
  token: string
  pid?: number
  startedAt?: string
}

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

const USAGE = `lavs — Local Agent View Service CLI (thin client over the dsh lavs-host adapter)

Usage:
  lavs list [--preset <id>] [--workspace <dir>] [--json]
                                             list bundles visible to that scope
  lavs schema <bundle> [--json]              one bundle's endpoints with input schemas
  lavs call <bundle> <endpoint> [--input '<json>'] [--json]
                                             invoke an endpoint through the host
  lavs url                                   show the discovered host endpoint
  lavs --help | -h                           this help

Discovery: --url/--token flags → LAVS_HOST_URL / LAVS_HOST_TOKEN env →
~/.dsh/lavs-host.json (written by the lavs-host adapter at boot).`

class CliError extends Error {}

function parseArgs(argv: string[]): { url: string; token: string; positional: string[]; flags: Set<string>; preset: string | undefined; workspace: string | undefined; input: string | undefined; json: boolean } {
  let url: string | undefined
  let token: string | undefined
  let preset: string | undefined
  let workspace: string | undefined
  let input: string | undefined
  const positional: string[] = []
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '--url') {
      url = argv[++i]
      if (url === undefined) throw new CliError('--url needs a value')
      continue
    }
    if (arg === '--token') {
      token = argv[++i]
      if (token === undefined) throw new CliError('--token needs a value')
      continue
    }
    if (arg === '--preset') {
      preset = argv[++i]
      if (preset === undefined) throw new CliError('--preset needs a value')
      continue
    }
    if (arg === '--workspace') {
      workspace = argv[++i]
      if (workspace === undefined) throw new CliError('--workspace needs a directory')
      continue
    }
    if (arg === '--input') {
      input = argv[++i]
      if (input === undefined) throw new CliError('--input needs a JSON string')
      continue
    }
    if (arg === '--json') { flags.add('json'); continue }
    if (arg === '--help' || arg === '-h') { flags.add('help'); continue }
    if (arg.startsWith('--')) throw new CliError(`unknown option "${arg}"`)
    positional.push(arg)
  }
  if (url === undefined || token === undefined) {
    const discoveryPath = join(homedir(), '.dsh', 'lavs-host.json')
    try {
      const found = JSON.parse(readFileSync(discoveryPath, 'utf8')) as Discovery
      if (url === undefined) url = `http://127.0.0.1:${found.port}`
      if (token === undefined) token = found.token
    } catch {
      throw new CliError(`no host discovery: ${discoveryPath} is missing and no --url/--token or env override given. Is a dsh web profile with the lavs bundle running?`)
    }
  }
  return { url: url as string, token: token as string, positional, flags, preset, workspace, input, json: flags.has('json') }
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
