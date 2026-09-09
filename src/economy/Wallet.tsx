import { useEffect, useState } from 'react';
import { SALARY_CREDITS, SALARY_INTERVAL_MS, type EconomyView } from '../../shared/catalog';
import './wallet.css';
export type TimedWallet = EconomyView & {receivedAt:number};
export function Wallet({wallet,onWardrobe}:{wallet:TimedWallet|null;onWardrobe:()=>void}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const remaining=wallet?Math.max(0,SALARY_INTERVAL_MS-wallet.salaryProgressMs-(wallet.accruing?Math.max(0,now-wallet.receivedAt):0)):SALARY_INTERVAL_MS;
 const seconds=Math.ceil(remaining/1000);const countdown=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 return <button className="wallet-hud" aria-label="Open wardrobe" onClick={onWardrobe}>
  <span className="wallet-coin" aria-hidden="true">C</span><span><strong aria-label="Credit balance">{wallet?wallet.balance.toLocaleString():'—'} <small>credits</small></strong><span className="salary-countdown">{!wallet?'Loading wallet…':!wallet.accruing?'Salary paused':remaining<=0?'Saving salary…':`+${SALARY_CREDITS} in ${countdown}`}</span></span><span className="wallet-link">Wardrobe ↗</span>
 </button>;
}
