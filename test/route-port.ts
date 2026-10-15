// Route tests isolate the internal configuration port. Desktop owner/CAS behavior
// is exercised separately against DesktopSettings and the real carrier.
export class RouteSettingsPort {
  writable=true
  constructor(_editor:unknown,forms:object){Object.assign(this,forms)}
  namespaceFor(ns:string){return ns}
}
export async function waitReady(routes:{path:string;handler:Function}[]) {
  for(let count=0;count<100;count++) {
    let status=0
    await routes.find(r=>r.path==='/api/model-manager')!.handler({method:'GET'},{writeHead:(v:number)=>{status=v},end:()=>{}})
    if(status===200)return
    await new Promise(resolve=>setTimeout(resolve,5))
  }
  throw Error('route fixture failed to initialize')
}
