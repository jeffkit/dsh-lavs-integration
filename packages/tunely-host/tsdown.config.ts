import { defineConfig } from 'tsdown'
import { nodeLib } from '../../tools/build.ts'

export default defineConfig(
  nodeLib({ index: 'src/index.ts' }, [
    'tunely',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/schemastery',
  ]),
)
