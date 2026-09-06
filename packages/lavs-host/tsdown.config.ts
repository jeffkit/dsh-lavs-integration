import { defineConfig } from 'tsdown'
import { nodeLib } from '../../tools/build.ts'

export default defineConfig(
  nodeLib({ index: 'src/index.ts' }, [
    'lavs-runtime',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery',
  ]),
)
