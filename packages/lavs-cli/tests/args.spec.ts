import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs, resolveEndpoint, CliError } from '../src/args.ts'

describe('parseArgs', () => {
  it('collects positional verbs and targets', () => {
    const args = parseArgs(['call', 'todo-list', 'addTodo'])
    expect(args.positional).toEqual(['call', 'todo-list', 'addTodo'])
  })

  it('parses value flags', () => {
    const args = parseArgs(['list', '--preset', 'demo-ppt', '--workspace', '/work/proj', '--url', 'http://127.0.0.1:1', '--token', 't'])
    expect(args.preset).toBe('demo-ppt')
    expect(args.workspace).toBe('/work/proj')
    expect(args.url).toBe('http://127.0.0.1:1')
    expect(args.token).toBe('t')
    expect(args.json).toBe(false)
  })

  it('toggles --json', () => {
    expect(parseArgs(['list', '--json', '--url', 'u', '--token', 't']).json).toBe(true)
  })

  it('parses --input without JSON validation (deferred to call)', () => {
    const args = parseArgs(['call', 'b', 'e', '--input', '{not-json'])
    expect(args.input).toBe('{not-json')
  })

  it('rejects unknown options', () => {
    expect(() => parseArgs(['list', '--wat'])).toThrow(CliError)
  })

  it('rejects value flags without values', () => {
    expect(() => parseArgs(['list', '--preset'])).toThrow(CliError)
  })

  it('marks help without requiring discovery', () => {
    const args = parseArgs(['--help'])
    expect(args.flags.has('help')).toBe(true)
  })
})

describe('resolveEndpoint', () => {
  // Each case pins the machine state it depends on: env cleared, discovery
  // routed to a path this test owns — no real ~/.dsh read, no ordering luck.
  const savedEnv: Record<string, string | undefined> = {}

  function pinEnv(keys: string[]): void {
    for (const key of keys) savedEnv[key] = process.env[key]
  }
  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  it('prefers explicit flags over env and discovery', () => {
    pinEnv(['LAVS_HOST_URL', 'LAVS_HOST_TOKEN', 'LAVS_HOST_DISCOVERY'])
    delete process.env.LAVS_HOST_URL
    delete process.env.LAVS_HOST_TOKEN
    delete process.env.LAVS_HOST_DISCOVERY
    try {
      const args = parseArgs(['list', '--url', 'http://127.0.0.1:1', '--token', 'flag-t'])
      expect(resolveEndpoint(args)).toEqual({ url: 'http://127.0.0.1:1', token: 'flag-t' })
    } finally { restoreEnv() }
  })

  it('falls back to LAVS_HOST_URL/LAVS_HOST_TOKEN env', () => {
    pinEnv(['LAVS_HOST_URL', 'LAVS_HOST_TOKEN', 'LAVS_HOST_DISCOVERY'])
    delete process.env.LAVS_HOST_DISCOVERY
    process.env.LAVS_HOST_URL = 'http://127.0.0.1:2'
    process.env.LAVS_HOST_TOKEN = 'env-t'
    try {
      expect(resolveEndpoint(parseArgs(['list']))).toEqual({ url: 'http://127.0.0.1:2', token: 'env-t' })
    } finally { restoreEnv() }
  })

  it('reads the discovery file at LAVS_HOST_DISCOVERY when flags and env are absent', () => {
    pinEnv(['LAVS_HOST_URL', 'LAVS_HOST_TOKEN', 'LAVS_HOST_DISCOVERY'])
    delete process.env.LAVS_HOST_URL
    delete process.env.LAVS_HOST_TOKEN
    const dir = mkdtempSync(join(tmpdir(), 'lavs-disc-'))
    const file = join(dir, 'lavs-host.json')
    writeFileSync(file, JSON.stringify({ port: 4321, token: 'disc-t' }))
    process.env.LAVS_HOST_DISCOVERY = file
    try {
      expect(resolveEndpoint(parseArgs(['list']))).toEqual({ url: 'http://127.0.0.1:4321', token: 'disc-t' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
      restoreEnv()
    }
  })

  it('throws when no source supplies the endpoint', () => {
    pinEnv(['LAVS_HOST_URL', 'LAVS_HOST_TOKEN', 'LAVS_HOST_DISCOVERY'])
    delete process.env.LAVS_HOST_URL
    delete process.env.LAVS_HOST_TOKEN
    process.env.LAVS_HOST_DISCOVERY = join(tmpdir(), `lavs-absent-${process.pid}-${Date.now()}.json`)
    try {
      expect(() => resolveEndpoint(parseArgs(['list']))).toThrow(CliError)
    } finally { restoreEnv() }
  })
})
