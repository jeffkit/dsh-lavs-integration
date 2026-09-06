import { defineConfig } from 'tsdown'
import { nodeLib } from '../../tools/build.ts'

export default defineConfig(
  nodeLib({ index: 'src/index.ts', startup: 'src/startup.ts' }, [
    'commander',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-cmdline',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-util-values',
    '@deepseek-ai/schemastery',
  ]),
)
