import type { WalletState } from '../../shared/catalog';
export class WalletError extends Error {
 constructor(message:string,public code:string,public snapshot?:WalletState){super(message);}
}
async function request(path:string,body?:unknown):Promise<WalletState>{
 const response=await fetch(`/game/api/economy${path}`,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok)throw new WalletError(result.error||'That change could not be saved. Please retry.',result.code,result.snapshot);
 return result;
}
export const getWallet=()=>request('');
export const buyClothing=(itemId:string,requestId:string)=>request('/purchase',{itemId,requestId});
export const equipClothing=(itemId:string,expectedRevision:number)=>request('/equip',{itemId,expectedRevision});
