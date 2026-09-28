import { defineConfig } from 'tsdown'
import { clientBundle, nodeLib } from '../../tools/build.ts'

const PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-tool-todo',
]

export default defineConfig([
  nodeLib({ index: 'src/index.ts', invariant: 'src/invariant.ts' }, PEERS),
  // Client value imports are react-only; the dsh.client.inject rows stay
  // requested so the boot graph orders their registrations ahead of ours.
  clientBundle('dsh-plugin-ui-tasks', []),
])
