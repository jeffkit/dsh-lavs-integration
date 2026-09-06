import { defineConfig } from 'tsdown'
import { clientBundle, nodeLib } from '../../tools/build.ts'

const PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-slots',
]

export default defineConfig([
  nodeLib({ index: 'src/index.ts', invariant: 'src/invariant.ts' }, PEERS),
  clientBundle('dsh-plugin-ui-tasks', [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
  ]),
])
