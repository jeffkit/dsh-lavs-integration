import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发模式把 /api（含 /?token= 登录链路）代理到本地测试实例。
// DSH 的 Host/Origin 围栏要求 Origin 与 Host 同 authority：changeOrigin 改写
// Host，headers.origin 同步改写 Origin，cookie 的 audience 两者一致。
const TARGET = process.env.DSH_MOBILE_TARGET ?? 'http://127.0.0.1:3099'

const proxyBase = {
  target: TARGET,
  changeOrigin: true,
  headers: { origin: TARGET },
}

export default defineConfig({
  plugins: [react()],
  // 应用由 mobile-gateway 托管在 /m/ 下，资产引用必须带前缀
  base: '/m/',
  server: {
    port: 5173,
    proxy: {
      // 仅当带 token 查询时把 / 代理给实例（登录链路），否则本地 SPA 接管
      '/': {
        ...proxyBase,
        bypass: (req) => {
          const url = new URL(req.url ?? '/', 'http://dev.local')
          if (url.searchParams.has('token')) return undefined
          return req.url
        },
        rewrite: () => '/',
      },
      '/api': proxyBase,
      '/connect': proxyBase,
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
