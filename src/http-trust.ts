import type { IncomingMessage } from 'node:http'
export function trusted(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
  if (!origin) return loopback
  if (origin === 'dsh-app://app') return loopback
  try { return new URL(origin).host === req.headers.host && new URL(origin).protocol !== 'null:' } catch { return false }
}
