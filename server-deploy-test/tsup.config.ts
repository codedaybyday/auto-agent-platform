import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  platform: 'node',
  bundle: true,
  // 打包所有依赖（包括 workspace 和 npm 包）
  noExternal: [/.*/],
  // 排除 Node.js 内置模块
  external: [
    'fs', 'path', 'http', 'https', 'crypto', 'stream', 'util',
    'url', 'querystring', 'zlib', 'events', 'os', 'child_process',
    'net', 'tls', 'dns', 'dgram', 'cluster', 'module', 'vm', 'async_hooks'
  ],
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
})
