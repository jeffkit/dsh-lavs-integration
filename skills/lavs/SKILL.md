---
name: lavs
description: Structured data surfaces for the agent — discover and operate LAVS view bundles (todo-list, bookmark, data-table, daily-note, …) through the `lavs` CLI. Use when the user asks to manage todos/notes/bookmarks/tabular data, or any time structured state should persist beyond the chat instead of living in message text.
---

# LAVS: structured data through the `lavs` CLI

LAVS bundles are small local apps (todo-list, bookmark, data-table, …) whose
data the agent reads and writes through manifest-declared endpoints. Views
render in the DSH "Views" tab and refresh automatically after every mutation.

## The three verbs

```sh
lavs list                          # which bundles exist + their endpoints
lavs schema <bundle>               # one bundle's endpoints with input schemas
lavs call <bundle>.<endpoint> …    # see exact form below
lavs call <bundle> <endpoint> --input '{"text": "…"}'
```

Add `--json` to any verb for machine-readable output. Discovery is automatic
(`~/.dsh/lavs-host.json`, written by the running host); overrides:
`--url`/`--token` flags or `LAVS_HOST_URL`/`LAVS_HOST_TOKEN` env.

The binary ships with the dsh lavs profile; if bare `lavs` is not on PATH use
`~/.dsh/profiles/lavs/node_modules/.bin/lavs`.

## Workflow

1. **Discover before you guess**: run `lavs list` once to see bundles, then
   `lavs schema <bundle>` for the exact endpoints and input shapes. Endpoint
   ids and inputs are manifest-declared — never invent them.
2. **Prefer mutations over prose**: when the user asks to track something
   (a todo, a bookmark, a table row), write it through `lavs call <bundle>
   <mutation-endpoint>` instead of restating it in chat. The data then shows
   up in the user's Views tab and survives the session.
3. **Queries are cheap**: before answering "what's on my list"-style
   questions, `lavs call <bundle> <query-endpoint>` — never answer from
   memory about state you can read.
4. **Every mutation refreshes the views** automatically (SSE fan-out); there
   is no reload step and no need to mention it.

## Conventions

- Query endpoints are read-only; mutation endpoints persist. Manifests mark
  which is which (`method: query | mutation`).
- Input must match the manifest's JSON Schema (`lavs schema` prints it).
  On a validation error, re-read the schema rather than retrying blind.
- If `lavs` reports no discovery file, the dsh web profile with the lavs
  bundle is not running — say so instead of falling back to chat-only state.
