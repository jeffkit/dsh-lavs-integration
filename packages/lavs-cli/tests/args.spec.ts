import { describe, expect, it } from 'vitest'
import { parseArgs, CliError } from '../src/args.ts'

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
