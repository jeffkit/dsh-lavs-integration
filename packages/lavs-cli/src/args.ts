/**
 * lavs CLI argument handling. `parseArgs` is pure — no filesystem, no env —
 * so tests drive it without machine state; `resolveEndpoint` is where the
 * documented sources meet (flags → env → discovery file) and is tested with
 * injected env and a temp discovery file.
 * @module dsh-plugin-lavs-cli/args
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export class CliError extends Error {}

export interface Discovery {
  port: number
  token: string
  pid?: number
  startedAt?: string
}

export const USAGE = `lavs — Local Agent View Service CLI (thin client over the dsh lavs-host adapter)

Usage:
  lavs list [--preset <id>] [--workspace <dir>] [--json]
                                             list bundles visible to that scope
  lavs schema <bundle> [--json]              one bundle's endpoints with input schemas
  lavs call <bundle> <endpoint> [--input '<json>'] [--json]
                                             invoke an endpoint through the host
  lavs init <dir> [--name <n>]               scaffold a minimal bundle skeleton
  lavs url                                   show the discovered host endpoint
  lavs --help | -h                           this help

Discovery: --url/--token flags → LAVS_HOST_URL / LAVS_HOST_TOKEN env →
~/.dsh/lavs-host.json (written by the lavs-host adapter at boot).`

export interface ParsedArgs {
  /** Host base URL: flags only; env and discovery resolve later via {@link resolveEndpoint}. */
  url: string | undefined
  /** Host bearer token: flags only; env and discovery resolve later via {@link resolveEndpoint}. */
  token: string | undefined
  positional: string[]
  flags: Set<string>
  preset: string | undefined
  workspace: string | undefined
  input: string | undefined
  json: boolean
}

/** The resolved endpoint: a base URL and its bearer token. */
export interface Endpoint {
  url: string
  token: string
}

export function parseArgs(argv: string[]): ParsedArgs {
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
  return { url, token, positional, flags, preset, workspace, input, json: flags.has('json') }
}

/**
 * Resolve the host endpoint for a parsed invocation, first source wins:
 * `--url`/`--token` flags, the `LAVS_HOST_URL` / `LAVS_HOST_TOKEN` env pair,
 * then the discovery file (path overridable with `LAVS_HOST_DISCOVERY`).
 * The discovery read only happens when flags and env left something
 * unresolved, so fully-flagged invocations never touch the filesystem.
 * @param args - a parsed invocation.
 * @returns the endpoint every request rides on.
 */
export function resolveEndpoint(args: ParsedArgs): Endpoint {
  const envUrl = process.env.LAVS_HOST_URL
  const envToken = process.env.LAVS_HOST_TOKEN
  let discUrl: string | undefined
  let discToken: string | undefined
  if (args.url === undefined || args.token === undefined) {
    const discoveryPath = process.env.LAVS_HOST_DISCOVERY ?? join(homedir(), '.dsh', 'lavs-host.json')
    try {
      const found = JSON.parse(readFileSync(discoveryPath, 'utf8')) as Discovery
      discUrl = `http://127.0.0.1:${found.port}`
      discToken = found.token
    } catch { /* reported below when nothing else supplied the endpoint */ }
  }
  const url = args.url ?? envUrl ?? discUrl
  const token = args.token ?? envToken ?? discToken
  if (url === undefined || token === undefined) {
    throw new CliError('no host endpoint: pass --url/--token, set LAVS_HOST_URL/LAVS_HOST_TOKEN, or ensure the discovery file (~/.dsh/lavs-host.json) exists. Is a dsh web profile with the lavs bundle running?')
  }
  return { url, token }
}
