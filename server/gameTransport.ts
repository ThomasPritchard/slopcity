import { WebSocketTransport } from '@colyseus/ws-transport';
import { clientAddress, socketIdentities } from './clientAddress.ts';

// The native transport provides typed access to ws; keep that detail out of rooms.
export class GameTransport extends WebSocketTransport {
 constructor(options: ConstructorParameters<typeof WebSocketTransport>[0]) {
  super(options);
  this.wss.prependListener('connection',(socket,req)=>{
   const ip=clientAddress(req.headers);
   if(ip)socketIdentities.set(socket,{ip,cookie:req.headers.cookie,isOpen:()=>socket.readyState===1,terminate:()=>socket.terminate()});
  });
 }
}
