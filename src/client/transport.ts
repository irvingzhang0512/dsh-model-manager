/** HTTP uses Desktop's authenticated same-origin forwarder; streamBaseUrl is
 * the separate loopback transport advertised for streaming connections. */
export function hostRouteUrl(path: string): string {
  const location=(globalThis as {location?:{protocol:string;href:string}}).location
  if(location?.protocol==='dsh-app:')return new URL(path,'dsh-app://app/').href
  if(location && ['http:','https:'].includes(location.protocol))return new URL(path,location.href).href
  const transport = (globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__
  if (transport?.streamBaseUrl) return new URL(path, `${transport.streamBaseUrl.replace(/\/+$/, '')}/`).href
  return path
}
