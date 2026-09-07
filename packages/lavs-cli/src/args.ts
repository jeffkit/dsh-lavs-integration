/**
 * lavs CLI argument parsing — pure and side-effect free so tests can drive
 * it without touching the filesystem or the network.
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
  url: string
  token: string
  positional: string[]
  flags: Set<string>
  preset: string | undefined
  workspace: string | undefined
  input: string | undefined
  json: boolean
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
  // Help must work host-less: bypass discovery entirely.
  if (flags.has('help')) {
    return { url: '', token: '', positional, flags, preset, workspace, input, json: false }
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
