/**
 * Three-scope visibility predicate (pure): base roots are always visible;
 * preset-scoped entries only to sessions running that preset; workspace-
 * scoped entries only to sessions whose cwd is that project.
 */

export interface ScopeKeys {
  sourcePreset?: string
  sourceWorkspace?: string
}

export function visibleEntries<T extends ScopeKeys>(entries: Iterable<T>, presetId?: string, workspaceCwd?: string): T[] {
  const out: T[] = []
  for (const entry of entries) {
    if (entry.sourcePreset !== undefined && entry.sourcePreset !== presetId) continue
    if (entry.sourceWorkspace !== undefined && entry.sourceWorkspace !== workspaceCwd) continue
    out.push(entry)
  }
  return out
}
