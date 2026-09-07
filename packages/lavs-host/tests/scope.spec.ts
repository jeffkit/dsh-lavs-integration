import { describe, expect, it } from 'vitest'
import { visibleEntries } from '../src/scope.ts'

interface Entry {
  name: string
  sourcePreset?: string
  sourceWorkspace?: string
}

const base = (name: string): Entry => ({ name })
const preset = (name: string, p: string): Entry => ({ name, sourcePreset: p })
const workspace = (name: string, w: string): Entry => ({ name, sourceWorkspace: w })

describe('visibleEntries — three-scope visibility', () => {
  const entries: Entry[] = [
    base('todo-list'),
    preset('slides', 'demo-ppt'),
    workspace('project-notes', '/work/proj'),
  ]

  it('shows base bundles regardless of session scope', () => {
    expect(visibleEntries(entries).map(e => e.name)).toEqual(['todo-list'])
    expect(visibleEntries(entries, 'demo-ppt', '/work/proj').map(e => e.name)).toEqual([
      'todo-list', 'slides', 'project-notes',
    ])
  })

  it('shows preset bundles only to sessions running that preset', () => {
    expect(visibleEntries(entries, 'other-preset').map(e => e.name)).toEqual(['todo-list'])
    expect(visibleEntries(entries, 'demo-ppt').map(e => e.name)).toEqual(['todo-list', 'slides'])
  })

  it('shows workspace bundles only to sessions in that project', () => {
    expect(visibleEntries(entries, undefined, '/work/other').map(e => e.name)).toEqual(['todo-list'])
    expect(visibleEntries(entries, undefined, '/work/proj').map(e => e.name)).toEqual(['todo-list', 'project-notes'])
  })

  it('an unscoped session sees nothing beyond base', () => {
    const scoped: Entry[] = [preset('a', 'p1'), workspace('b', '/w')]
    expect(visibleEntries(scoped)).toEqual([])
  })
})
