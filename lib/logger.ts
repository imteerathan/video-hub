export function logEvent(event:string,data:Record<string,unknown>={}){console.info(JSON.stringify({ts:new Date().toISOString(),event,...data}))}
export function logError(event:string,error:unknown,data:Record<string,unknown>={}){console.error(JSON.stringify({ts:new Date().toISOString(),event,error:error instanceof Error?error.message:String(error),...data}))}
