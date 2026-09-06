import { defineConfig } from 'tsdown'
import { clientBundle, nodeLib } from '../../tools/build.ts'

const PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-slots',
]

export default defineConfig([
  nodeLib({ index: 'src/index.ts', invariant: 'src/invariant.ts' }, PEERS),
  // Client value imports are react-only; the dsh.client.inject rows stay
  // requested so the boot graph orders their registrations ahead of ours.
  clientBundle('dsh-plugin-ui-lavs', [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
  ]),
])
