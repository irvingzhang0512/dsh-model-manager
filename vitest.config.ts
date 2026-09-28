import { defineConfig } from 'vitest/config'

// 用 threads 池而不是默认 forks 池：forks 依赖 IPC 命名管道，在受限沙箱
// （如 DSH 代理执行环境）里 spawn worker 会直接 EPERM；threads 用
// worker_threads 通信，不依赖命名管道，各种环境都能跑。
export default defineConfig({ test: { pool: 'threads' } })
