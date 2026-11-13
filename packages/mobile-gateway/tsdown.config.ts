import { defineConfig } from 'tsdown'
import { nodeLib } from '../../tools/build.ts'

export default defineConfig(
  nodeLib({ index: 'src/index.ts' }, [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/schemastery',
  ]),
)
