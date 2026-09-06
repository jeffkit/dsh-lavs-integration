import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  // Zero runtime dependencies: the CLI is a thin HTTP client over the
  // running lavs-host adapter and ships as one self-contained file.
})
