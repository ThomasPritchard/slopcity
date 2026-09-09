import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Client, type Room } from '@colyseus/sdk';
import { TownScene, type SceneStats, type PlayerView } from './world/scene';
import { CAPACITY, SHIRTS, SKINS, parseProfile, type Profile } from '../shared/world';
import type { TownState } from '../shared/state';
import './style.css';
import type { PrivateGuestProfile } from '../shared/profile';
import { SEATS, SIT_REACH } from '../shared/social';
import type { VoiceNeighbour } from '../shared/voice';
import { restoreGuest, establishGuest, saveGuest, setGuestBlock } from './social/profile';
import { ProximityVoice, silentVoice } from './social/voice';
import { SocialPanel } from './social/SocialPanel';
import { CATALOGUE, STARTER_OUTFIT, clothingItem, isInShop, type WalletState, type EconomyView } from '../shared/catalog';
import { getWallet, buyClothing, equipClothing, WalletError } from './economy/api';
import { Wallet, type TimedWallet } from './economy/Wallet';
import { ShopPanel } from './shop/ShopPanel';
import { CasinoPanel } from './casino/CasinoPanel';
import { CASINO_ANCHORS, CASINO_INTERACTION_RADIUS, type CasinoState, type CasinoPrivateState, type CasinoTableId, type CasinoCommand, type CasinoReceipt } from '../shared/casino';
import { LocationAnnouncement } from './ui/LocationAnnouncement';
import { loadPreferences, savePreferences, type Preferences } from './settings/preferences';
import { TownAudio } from './audio/TownAudio';

type Chat = { id: string; profileId: string; name: string; body: string };
function savedProfile(): Profile {
  try { return parseProfile(JSON.parse(localStorage.getItem('slop-city-profile') || '{}')); }
  catch { return parseProfile({}); }
}
function Icon({ kind, size = 20 }: { kind: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    people: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/></>,
    chat: <path d="M21 11a9 9 0 0 1-9 9H4l-3 2 2-6a9 9 0 1 1 18-5Z"/>,
    map: <><path d="m2 5 7-3 6 3 7-3v17l-7 3-6-3-7 3V5ZM9 2v17M15 5v17"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/></>,
    wave: <><path d="M8 13V6a2 2 0 0 1 4 0v7m0-6a2 2 0 0 1 4 0v7m0-4a2 2 0 0 1 4 0v5a7 7 0 0 1-13 4l-4-6a2 2 0 0 1 3-2l2 2Z"/><path d="M2 3 1 6M19 2l3 3"/></>,
    settings: <><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="19" r="2"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 12 5M12 19v3M2 2l20 20"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] || paths.compass}</svg>;
}
function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<TownScene | null>(null);
  const room = useRef<Room<unknown, TownState> | null>(null);
  const voiceClient = useRef<ProximityVoice | null>(null);
  const audio = useRef<TownAudio | null>(null);
  const focusedCasino = useRef<CasinoTableId | null>(null);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [systemMotion, setSystemMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reducedMotion = preferences.motion === 'reduced' || preferences.motion === 'system' && systemMotion;
  function updatePreferences(patch: Partial<Preferences>) { setPreferences(previous => ({ ...previous, ...patch })); }
  const [wallet,setWallet]=useState<TimedWallet|null>(null);
  const walletRef=useRef<TimedWallet|null>(null);
  const purchaseKeys=useRef(new Map<string,string>());
  const [casinoState,setCasinoState]=useState<CasinoState>({serverTime:Date.now(),tables:[]});
  const [casinoPrivate,setCasinoPrivate]=useState<CasinoPrivateState>({rouletteBets:[]});
  const [casinoTable,setCasinoTable]=useState<CasinoTableId|null>(null);
  const [casinoBusy,setCasinoBusy]=useState(false);
  const [casinoError,setCasinoError]=useState('');
  const [casinoNotice,setCasinoNotice]=useState('');
  const [casinoRetry,setCasinoRetry]=useState(false);
  const casinoPending=useRef<CasinoCommand|null>(null);
  const casinoTimeout=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [shopMode,setShopMode]=useState<'shop'|'wardrobe'|null>(null);
  const [selectedItem,setSelectedItem]=useState(STARTER_OUTFIT.top);
  const [shopBusy,setShopBusy]=useState(false);
  const [shopError,setShopError]=useState('');
  const [shopNotice,setShopNotice]=useState('');
  const [voiceState, setVoiceState] = useState(silentVoice);
  const [socialOpen, setSocialOpen] = useState(false);
  const [muted, setMuted] = useState(new Set<string>());
  const [guest, setGuest] = useState<PrivateGuestProfile | null>(null);
  const [guestReady, setGuestReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const knownNames = useRef(new Map<string, string>());
  const sequence = useRef(0);
  const joining = useRef(false);
  const [profile, setProfile] = useState(savedProfile);
  const [phase, setPhase] = useState<'welcome' | 'customising' | 'joining' | 'playing' | 'disconnected'>('welcome');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [players, setPlayers] = useState(new Map<string, PlayerView>());
  const [stats, setStats] = useState<SceneStats>({ fps: 0, district: 'Town Square', x: 0, z: -17 });
  const [panel, setPanel] = useState<'map' | 'settings' | null>(null);
  const [chatOpen, setChatOpen] = useState(() => !matchMedia('(pointer: coarse)').matches);
  const [chatFocused, setChatFocused] = useState(false);
  const [messages, setMessages] = useState<Chat[]>([]);
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState(true);
  const low = preferences.low;
  const [wave, setWave] = useState(false);
  const [previewView, setPreviewView] = useState<'face' | 'outfit' | 'shoes'>('outfit');
  const [stick, setStick] = useState({ x: 0, z: 0 });
  const chatEnd = useRef<HTMLDivElement>(null);
  const joystick = useRef<HTMLDivElement>(null);

  function acceptWallet(state:WalletState,accruing?:boolean) {
    const previous=walletRef.current;
    if(previous && state.revision<previous.revision)return;
    const active=accruing??previous?.accruing??false;
    const next={...state,accruing:active,receivedAt:previous?.revision===state.revision && previous.accruing===active ? previous.receivedAt : Date.now()};
    walletRef.current=next;setWallet(next);
  }
  useEffect(() => {
    document.getElementById('startup')?.remove();
    voiceClient.current = new ProximityVoice(setVoiceState);
    audio.current = new TownAudio();
    const unlockAudio = () => audio.current?.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    let mounted = true;
    void restoreGuest().then(async saved => { if (!mounted) return; if (saved) { setGuest(saved); setProfile(saved); const balance=await getWallet(); if(mounted)acceptWallet(balance,false); } }).catch(() => { if (mounted) setError('Your saved guest could not load. Check that the local game services are running.'); }).finally(() => { if (mounted) setGuestReady(true); });
    let timer: ReturnType<typeof setInterval>;
    try {
      const scene = new TownScene(canvas.current!, preferences.low); world.current = scene;
      scene.onStats = setStats;
      scene.onMotion = (x, z, moving) => audio.current?.motion(x, z, moving);
      scene.onInput = (x, z) => { if (room.current) room.current.send('input', { x, z, seq: sequence.current++ }); };
      void scene.ready.then(() => setReady(true)).catch(err => setError(`The scene assets could not load. ${err instanceof Error ? err.message : ''}`));
      timer = setInterval(() => {
        const state = room.current?.state;
        if (!state?.players) return;
        const snapshot = new Map<string, PlayerView>();
        state.players.forEach((p, id) => snapshot.set(id, { profileId: p.profileId, seatId: p.seatId, top:p.top, bottoms:p.bottoms, shoes:p.shoes, name: p.name, x: p.x, z: p.z, heading: p.heading, moving: p.moving, shirt: p.shirt, skin: p.skin, wave: p.wave }));
        for (const player of snapshot.values()) knownNames.current.set(player.profileId, player.name);
        scene.sync(snapshot); setPlayers(snapshot);
      }, 50);
    } catch (err) { setError(`The 3D scene could not start. Try a browser with WebGL enabled. ${err instanceof Error ? err.message : ''}`); }
    return () => { mounted = false; window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); audio.current?.dispose(); if(casinoTimeout.current)clearTimeout(casinoTimeout.current); void voiceClient.current?.leave(); clearInterval(timer); const current = room.current; room.current = null; void current?.leave(); world.current?.dispose(); };
  }, []);
  useEffect(() => {
    savePreferences(preferences);
    world.current?.setQuality(preferences.low);
    world.current?.setReducedMotion(reducedMotion);
    audio.current?.configure(preferences);
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [preferences, reducedMotion]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSystemMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { audio.current?.setActive(phase === 'playing' && shopMode === null); }, [phase, shopMode]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => document.documentElement.style.setProperty('--keyboard-inset', `${viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); update();
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
  }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages, chatOpen]);
  useEffect(() => { world.current?.setPaused(panel !== null || socialOpen || shopMode!==null || casinoTable!==null || phase !== 'playing'); }, [panel, socialOpen, shopMode, casinoTable, phase]);
  useEffect(() => {
    const outfit={...STARTER_OUTFIT,...wallet?.outfit};
    const selected=shopMode?clothingItem(selectedItem):null;
    if(selected)outfit[selected.slot]=selected.id;
    world.current?.updatePreview({...profile,...outfit});
  }, [profile,wallet?.outfit,selectedItem,shopMode]);
  useEffect(()=>{
    if(phase!=='playing')return;
    const send=()=>room.current?.send('presence',!document.hidden);
    const hide=()=>room.current?.send('presence',false);
    send();const timer=setInterval(send,5000);
    document.addEventListener('visibilitychange',send);window.addEventListener('pagehide',hide);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',send);window.removeEventListener('pagehide',hide);};
  },[phase]);
  function openCasino(id:CasinoTableId) {
    const anchor=CASINO_ANCHORS.find(anchor=>anchor.id===id);if(!anchor)return;
    focusedCasino.current=id;audio.current?.casino(casinoState,id);setPanel(null);setSocialOpen(false);setHint(false);setCasinoTable(id);setCasinoError('');setCasinoNotice('');world.current?.focusCasino(anchor);
    room.current?.send('casino-command',{requestId:crypto.randomUUID(),action:'sync'});
  }
  function closeCasino() {focusedCasino.current=null;audio.current?.casino(casinoState,null);setCasinoTable(null);world.current?.focusCasino(null);}
  function sendCasino(command:CasinoCommand,retry=false) {
    if(!room.current || casinoPending.current && !retry)return;
    casinoPending.current=command;setCasinoBusy(true);setCasinoRetry(false);setCasinoError('');setCasinoNotice('');
    if(casinoTimeout.current)clearTimeout(casinoTimeout.current);
    room.current.send('casino-command',command);
    casinoTimeout.current=setTimeout(()=>{setCasinoRetry(true);setCasinoError('Confirmation is delayed. Retry the same action to check its result.');},6000);
  }
  async function openShop(mode:'shop'|'wardrobe') {
    if(casinoTable)return;
    const sessionId=room.current?.sessionId;
    if(!sessionId)return;
    setShopError('');setShopNotice('');setPanel(null);setSocialOpen(false);
    try {
      const state=await getWallet();
      if(room.current?.sessionId!==sessionId)return;
      acceptWallet(state);
      setSelectedItem(state.outfit.top);setShopMode(mode);
      world.current?.customise({...profile,...state.outfit},mode==='shop',true);
    } catch {setNotice('Your wardrobe could not load. Please try again.');}
  }
  function closeShop() {setShopMode(null);setShopError('');setShopNotice('');if(room.current)world.current?.enter(room.current.sessionId);}
  async function clothingAction(id:string,buy:boolean) {
    if(shopBusy)return;setShopBusy(true);setShopError('');setShopNotice('');
    try {
      let state:WalletState;
      if(buy){let key=purchaseKeys.current.get(id);if(!key){key=crypto.randomUUID();purchaseKeys.current.set(id,key);}state=await buyClothing(id,key);purchaseKeys.current.delete(id);}
      else state=await equipClothing(id,walletRef.current!.revision);
      acceptWallet(state);setShopNotice(buy?'Added to your wardrobe. Choose Wear this to put it on.':'Outfit saved. Your neighbours can see your new look.');
    }catch(error){if(error instanceof WalletError && error.snapshot)acceptWallet(error.snapshot);setShopError(error instanceof Error?error.message:'That change could not be saved. Please try again.');}
    finally{setShopBusy(false);}
  }
  async function customise() {
    if (saving || !guestReady) return;
    if (!profile.name.trim() || profile.name === 'New neighbour') { setError('Please enter your name.'); return; }
    setSaving(true); setError('');
    try {
      if (!guest) {
        const saved = await establishGuest(parseProfile(profile));
        // A blocked cookie must not be presented as a recoverable saved guest.
        const restored = await restoreGuest();
        if (!restored || restored.id !== saved.id) throw new Error('Allow cookies for this site so your guest can be remembered.');
        setGuest(saved);
      }
      const balance=await getWallet();acceptWallet(balance,false);
      setPreviewView('outfit'); world.current?.customise({...profile,...balance.outfit}); setPhase('customising');
    } catch (error) { setError(error instanceof Error ? error.message : 'Your guest could not be saved. Please try again.'); }
    finally { setSaving(false); }
  }
  async function join() {
    if (joining.current || !world.current || !guest) return;
    joining.current = true; setError(''); setPhase('joining');
    const clean = parseProfile(profile); setProfile(clean);
    try {
      if (clean.name !== guest.name || clean.shirt !== guest.shirt || clean.skin !== guest.skin) setGuest(await saveGuest(clean, guest.revision));
      const endpoint = import.meta.env.VITE_GAME_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/game`;
      const connected = await new Client(endpoint).joinOrCreate<TownState>('town');
      room.current = connected; sequence.current = 0;
      connected.onMessage<EconomyView>('economy',value=>acceptWallet(value,value.accruing));
      connected.onMessage<string>('economy-error',text=>setNotice(text));
      connected.send('economy-sync');
      connected.onMessage<CasinoState>('casino-state',state=>{setCasinoState(state);world.current?.syncCasino(state);audio.current?.casino(state,focusedCasino.current);});
      connected.onMessage<CasinoPrivateState>('casino-private',value=>{setCasinoPrivate(value);world.current?.syncCasinoPrivate(value);});
      connected.onMessage<CasinoReceipt>('casino-receipt',receipt=>{
        if(receipt.wallet)acceptWallet(receipt.wallet);
        if(receipt.requestId!==casinoPending.current?.requestId)return;
        if(receipt.ok && ['roulette-bet','blackjack-bet'].includes(casinoPending.current.action))audio.current?.receipt(receipt);
        if(!receipt.ok && receipt.code==='temporarily_unavailable') {
          if(casinoTimeout.current)clearTimeout(casinoTimeout.current);
          setCasinoRetry(true);setCasinoError(receipt.message);return;
        }
        if(casinoTimeout.current)clearTimeout(casinoTimeout.current);casinoPending.current=null;setCasinoBusy(false);setCasinoRetry(false);
        setCasinoError(receipt.ok?'':receipt.message);setCasinoNotice(receipt.ok?receipt.message:'');
      });
      connected.send('casino-command',{requestId:crypto.randomUUID(),action:'sync'});
      connected.onMessage<VoiceNeighbour[]>('voice-neighbours', targets => voiceClient.current?.setTargets(targets));
      connected.onMessage<string>('notice', text => { setNotice(text); setTimeout(() => setNotice(''), 3500); });
      connected.onMessage<Chat>('chat', value => setMessages(previous => [...previous.slice(-79), value]));
      connected.onError((_code, text) => setError(text || 'The connection encountered a problem.'));
      connected.onLeave(() => {
        if (room.current !== connected) return;
        room.current = null; setShopMode(null);setCasinoTable(null);setCasinoState({serverTime:Date.now(),tables:[]});setCasinoPrivate({rouletteBets:[]});casinoPending.current=null;if(casinoTimeout.current)clearTimeout(casinoTimeout.current);setCasinoBusy(false);setCasinoRetry(false);world.current?.focusCasino(null); if(walletRef.current)acceptWallet(walletRef.current,false); void voiceClient.current?.leave(); voiceClient.current?.setTargets([]); setSocialOpen(false); setMuted(new Set()); world.current?.sync(new Map()); setPlayers(new Map()); setPhase('disconnected');
        setError('You have left the town. Rejoin to continue.');
      });
      try { localStorage.setItem('slop-city-profile', JSON.stringify(clean)); } catch { /* A restricted browser can still play. */ }
      setNotice(''); world.current.enter(connected.sessionId); setPhase('playing'); setHint(true); setMessages([]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not join the town. Please try again.'); setPhase('customising'); }
    finally { joining.current = false; }
  }
  function muteNeighbour(id: string) {
    setMuted(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); voiceClient.current?.setMuted(next); return next; });
  }
  async function blockNeighbour(profileId: string, blocked: boolean) {
    try { const result = await setGuestBlock(profileId, blocked); setGuest(previous => previous ? { ...previous, blocks: result.blocks } : null); if (blocked) setMessages(previous => previous.filter(message => message.profileId !== profileId)); }
    catch { setNotice('That change could not be saved. Please try again.'); }
  }
  function sendChat(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim() || !room.current) return;
    room.current.send('chat', message.trim()); setMessage(''); canvas.current?.focus();
  }
  function doWave() {
    if (wave || !room.current) return;
    room.current.send('wave'); setWave(true); setTimeout(() => setWave(false), 2800); canvas.current?.focus();
  }
  function moveStick(event: React.PointerEvent<HTMLDivElement>) {
    if (!joystick.current?.hasPointerCapture(event.pointerId)) return;
    const rect = joystick.current.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2) / 35, z = (event.clientY - rect.top - rect.height / 2) / 35;
    const len = Math.max(1, Math.hypot(x, z)); const next = { x: x / len, z: z / len };
    setStick(next); world.current?.setTouch(next.x, next.z);
  }
  function releaseStick() { setStick({ x: 0, z: 0 }); world.current?.setTouch(0, 0); }
  const localPlayer = players.get(room.current?.sessionId ?? '');
  const occupied = new Set([...players.values()].map(player => player.seatId).filter(Boolean));
  const nearbySeats = localPlayer ? SEATS.filter(seat => Math.hypot(seat.x - localPlayer.x, seat.z - localPlayer.z) <= SIT_REACH).sort((a,b) => Math.hypot(a.x-localPlayer.x,a.z-localPlayer.z)-Math.hypot(b.x-localPlayer.x,b.z-localPlayer.z)) : [];
  const availableSeat = nearbySeats.find(seat => !occupied.has(seat.id));
  const neighbours = [...players.entries()].filter(([id]) => id !== room.current?.sessionId).map(([sessionId, player]) => ({ sessionId, profileId: player.profileId, name: player.name, distance: localPlayer ? Math.hypot(player.x-localPlayer.x,player.z-localPlayer.z) : 0, muted: muted.has(sessionId), blocked: guest?.blocks.includes(player.profileId) ?? false, speaking: voiceState.speaking.includes(sessionId) })).sort((a,b) => a.distance-b.distance);
  const nearbyGames = localPlayer && stats.district === 'The Meridian Casino' && !casinoTable && !shopMode && !panel && !socialOpen && (!chatOpen || !matchMedia('(pointer: coarse)').matches) ? CASINO_ANCHORS.filter(anchor => Math.hypot(localPlayer.x-anchor.x, localPlayer.z-anchor.z) <= CASINO_INTERACTION_RADIUS).sort((a,b) => Math.hypot(localPlayer.x-a.x,localPlayer.z-a.z)-Math.hypot(localPlayer.x-b.x,localPlayer.z-b.z)) : [];
  const [hoveredGame, setHoveredGame] = useState<CasinoTableId | null>(null);
  const focusGame = nearbyGames.find(anchor => anchor.id === hoveredGame) ?? nearbyGames[0] ?? null;
  useEffect(() => { world.current?.setInteractionFocus(focusGame); }, [focusGame?.id]);
  const playing = phase === 'playing';
  const customising = phase === 'customising' || phase === 'joining';
  return <main className={playing ? `game playing${shopMode?' shopping':''}${casinoTable?' at-table':''}${chatFocused?' typing-chat':''}` : customising ? 'game customising' : 'game'}>
    <canvas id="world" ref={canvas} tabIndex={0} aria-label="Slop City 3D world. Use W A S D or arrow keys to walk and drag to look around." />
    <div className="vignette" />
    <header className="masthead">
      <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="Slop City"><span className="brand-mark">s<span>c</span></span><span>SLOP CITY<small>A PLACE TO MAKE YOUR OWN</small></span></a>
      <div className="top-right"><span className="build-tag">FIRST PLAYABLE <i>01</i></span>{playing && <span className="population"><span className="live-dot"/><Icon kind="people" size={16}/>{players.size}<span className="muted">/ {CAPACITY}</span></span>}</div>
    </header>
    {!playing && !customising && <>
      <div className="welcome-shade" />
      <section className="welcome">
        <div className="eyebrow"><span className="small-line"/> YOUR NEXT CHAPTER STARTS HERE</div>
        <h1>A little city.<br/>A lot of <em>possibility.</em></h1>
        <p className="welcome-copy">Find your people. Make yourself at home.<br/>The square is yours to explore.</p>
        <form className="join-card" onSubmit={e => { e.preventDefault(); void customise(); }}>
          <div className="card-heading"><span>First, make an entrance.</span><span className="step">01 / 01</span></div>
          <label className="field-label" htmlFor="display-name">WHAT SHOULD WE CALL YOU?</label>
          <input id="display-name" disabled={!guestReady || saving} autoComplete="nickname" maxLength={20} placeholder="Your name" value={profile.name === 'New neighbour' ? '' : profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })}/>
          <button className="enter" disabled={!ready || !guestReady || saving} type="submit">{saving ? 'Remembering your guest…' : !ready || !guestReady ? 'Opening the square…' : 'Enter'}<Icon kind="arrow"/></button>
          <p className="fine-print">{guest ? 'Your guest is remembered in this browser.' : 'No account needed. Your guest stays with this browser.'} Next, choose your look.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
        <p className="development-note">A shared town with your own wardrobe, credits and neighbours.<br className="desktop-only"/> Earn a little. Find your next look. Try your luck at the Meridian.</p>
      </section>
      <div className="scene-caption"><span className="coordinate">01 — THE NEIGHBOURHOOD</span><h2>Town Square</h2><span>A shared space. An open invitation.</span></div>
      <footer className="welcome-footer"><span>COME AS YOU ARE.</span><span>STAY A LITTLE WHILE.</span></footer>
    </>}
    {customising && <>
      <section className="custom-heading"><span className="eyebrow">THE CHANGING ROOM</span><h1>Make it <em>you.</em></h1><p>A fresh start. Your own style.</p></section>
      <section className="custom-panel" aria-label="Character customisation">
        <span className="eyebrow">YOUR FIRST LOOK</span><h2>{profile.name}</h2>
        <p className="custom-copy">Try a colour. Take a turn.<br/>See yourself in the city.</p>
        <fieldset className="custom-field"><legend>SKIN TONE</legend><div className="swatches">{SKINS.map((colour, i) => <button key={colour} type="button" className={profile.skin === i ? 'swatch selected' : 'swatch'} style={{ background: colour }} aria-label={`Skin tone ${i + 1}`} aria-pressed={profile.skin === i} onClick={() => setProfile({ ...profile, skin: i })}/>)}</div></fieldset>
        <fieldset className="custom-field"><legend>STARTER JACKET COLOUR</legend><div className="swatches">{SHIRTS.map((colour, i) => <button key={colour} type="button" className={profile.shirt === i ? 'swatch selected' : 'swatch'} style={{ background: colour }} aria-label={`Outfit colour ${i + 1}`} aria-pressed={profile.shirt === i} onClick={() => setProfile({ ...profile, shirt: i })}/>)}</div></fieldset>
        <div className="outfit-description"><span>THE EVERYDAY SET</span><p>Utility jacket · Straight-leg trousers<br/>Leather sneakers</p><small>Your complimentary first outfit. Saved when you join.</small></div>
        <button className="enter" disabled={phase === 'joining'} onClick={() => void join()}>{phase === 'joining' ? 'Joining your neighbours…' : 'Join the square'}<Icon kind="arrow"/></button>
        <button className="change-name" onClick={() => { const name = document.getElementById('custom-name'); name?.focus(); }}>Edit name</button>
        <label className="sr-only" htmlFor="custom-name">Character name</label><input id="custom-name" className="custom-name" maxLength={20} value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })}/>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <div className="preview-controls"><button aria-label="Rotate character left" onClick={() => world.current?.rotatePreview(-1)}>↶</button><div className="preview-views">{(['face', 'outfit', 'shoes'] as const).map(view => <button key={view} aria-label={`View ${view}`} aria-pressed={previewView === view} onClick={() => { setPreviewView(view); world.current?.framePreview(view); }}>{view}</button>)}</div><button aria-label="Rotate character right" onClick={() => world.current?.rotatePreview(1)}>↷</button></div>
    </>}
    {playing && <>
      <Wallet wallet={wallet} onWardrobe={()=>void openShop('wardrobe')}/>
      {localPlayer && isInShop(localPlayer.x,localPlayer.z) && !shopMode && <button className="shop-entry" onClick={()=>void openShop('shop')}>Browse Form & Thread</button>}
      <ShopPanel open={shopMode!==null} mode={shopMode??'shop'} balance={wallet?.balance??0} items={[...CATALOGUE]} owned={wallet?.owned??[]} equipped={wallet?.outfit??STARTER_OUTFIT} selectedId={selectedItem} busy={shopBusy} error={shopError} notice={shopNotice} onSelect={id=>{setSelectedItem(id);setShopError('');setShopNotice('');const item=clothingItem(id);world.current?.framePreview(item?.slot==='shoes'?'shoes':'outfit');}} onBuy={id=>void clothingAction(id,true)} onEquip={id=>void clothingAction(id,false)} onClose={closeShop} onRotate={direction=>world.current?.rotatePreview(direction)} onFrame={view=>world.current?.framePreview(view)}/>
      {notice && <div className="social-notice" role="status">{notice}</div>}
      {(localPlayer?.seatId || nearbySeats.length > 0) && <button className="seat-action" disabled={!localPlayer?.seatId && !availableSeat} onClick={() => { if (localPlayer?.seatId) room.current?.send('stand'); else if (availableSeat) room.current?.send('sit', availableSeat.id); canvas.current?.focus(); }}>{localPlayer?.seatId ? 'Stand up' : availableSeat ? 'Sit down' : 'Bench occupied'}</button>}
      {voiceState.status !== 'off' && <button className="voice-status" onClick={event => { event.currentTarget.focus(); setSocialOpen(true); }} aria-label="Open voice controls">{voiceState.status === 'connected' ? voiceState.micEnabled ? 'Voice · Mic on' : 'Voice · Mic off' : voiceState.status === 'connecting' ? 'Voice connecting…' : 'Voice disconnected'}</button>}
      <SocialPanel open={socialOpen} onClose={() => setSocialOpen(false)} voice={voiceState} neighbours={neighbours} blockedProfiles={(guest?.blocks ?? []).map(profileId => ({profileId, name: knownNames.current.get(profileId) ?? 'Guest not in town'}))} onJoinVoice={() => void voiceClient.current?.join()} onLeaveVoice={() => void voiceClient.current?.leave()} onToggleMic={() => void voiceClient.current?.toggleMicrophone()} onResumeAudio={() => void voiceClient.current?.resumeAudio()} onMute={muteNeighbour} onBlock={id => void blockNeighbour(id,true)} onUnblock={id => void blockNeighbour(id,false)}/>

      {nearbyGames.length > 0 && <div className="casino-entry" aria-label="Nearby casino games">{nearbyGames.map(anchor=><button key={anchor.id} aria-current={focusGame?.id===anchor.id ? 'true' : undefined} onPointerEnter={()=>setHoveredGame(anchor.id)} onPointerLeave={()=>setHoveredGame(null)} onFocus={()=>setHoveredGame(anchor.id)} onBlur={()=>setHoveredGame(null)} onClick={()=>openCasino(anchor.id)}>Open {anchor.name}</button>)}</div>}
      <CasinoPanel open={casinoTable!==null} table={casinoState.tables.find(table=>table.id===casinoTable)??null} serverTime={casinoState.serverTime} profileId={guest?.id??''} balance={wallet?.balance??0} privateState={casinoPrivate} busy={casinoBusy} error={casinoError} notice={casinoNotice} onCommand={command=>sendCasino(command)} onClose={closeCasino}/>
      {casinoRetry && <button className="casino-retry" onClick={()=>{if(casinoPending.current)sendCasino(casinoPending.current,true);}}>Retry last casino action</button>}
      <LocationAnnouncement key={stats.district} name={stats.district}/>
      {hint && <aside className="welcome-hint"><button className="close" aria-label="Dismiss welcome" onClick={() => setHint(false)}><Icon kind="close" size={16}/></button><span className="eyebrow">GOOD TO SEE YOU, {profile.name.toUpperCase()}</span><h2>Make yourself at home.</h2><p>Take a walk. Meet a neighbour.<br/>There’s no rush to be anywhere.</p></aside>}
      <div className="bottom-left">
        {chatOpen && <section className="chat-panel" aria-label="Town chat"><div className="chat-title"><span className="live-dot"/> TOWN CHAT <span>{players.size} in town</span></div><div className="chat-history" role="log" aria-live="polite">{messages.length === 0 && <p className="chat-empty">A simple hello goes a long way.</p>}{messages.map((m, i) => <p key={i}><strong>{m.name}</strong> {m.body}</p>)}<div ref={chatEnd}/></div><form onSubmit={sendChat}><input aria-label="Message to town" placeholder="Say something…" value={message} maxLength={240} onFocus={() => { setChatFocused(true); releaseStick(); world.current?.setPaused(true); }} onBlur={() => { setChatFocused(false); world.current?.setPaused(panel !== null || socialOpen || casinoTable!==null || shopMode!==null); }} onChange={e => setMessage(e.target.value)}/><button aria-label="Send message" onMouseDown={event => event.preventDefault()} disabled={!message.trim()}><Icon kind="arrow" size={18}/></button></form></section>}
        <div className="identity"><span className="identity-dot" style={{ background: SHIRTS[profile.shirt] }}/><span>{profile.name}<small>NEW NEIGHBOUR</small></span><span className="identity-status">IN TOWN</span></div>
      </div>
      <div className="controls-hint"><kbd>W</kbd><span className="key-stack"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Walk</span><span className="divider"/>Drag to look<span className="divider"/>Scroll to zoom</div>
      <nav className="toolbar" aria-label="Town tools">
        <button title="Town chat" aria-label="Toggle town chat" aria-pressed={chatOpen} onClick={() => setChatOpen(!chatOpen)}><Icon kind="chat"/><span>Chat</span></button>
        <button title="Wave" aria-label="Wave to neighbours" disabled={wave || !!localPlayer?.seatId} onClick={doWave}><Icon kind="wave"/><span>{wave ? 'Hello!' : 'Wave'}</span></button>
        <button title="Neighbours" aria-label="Open neighbours" aria-pressed={socialOpen} onClick={event => { event.currentTarget.focus(); setPanel(null); setSocialOpen(true); }}><Icon kind="people"/><span>Social</span></button>
        <button title="Town map" aria-label="Open town map" aria-pressed={panel === 'map'} onClick={() => setPanel(panel === 'map' ? null : 'map')}><Icon kind="map"/><span>Map</span></button>
        <button title="Recenter camera" aria-label="Recenter camera" onClick={() => world.current?.recenter()}><Icon kind="compass"/><span>View</span></button>
        <button title="Settings" aria-label="Open settings" aria-pressed={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Icon kind="settings"/><span>Settings</span></button>
      </nav>
      <div className="joystick" ref={joystick} role="group" aria-label="Touch movement control" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); moveStick(event); }} onPointerMove={moveStick} onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}><div className="stick-guide"/><div className="stick" style={{ transform: `translate(${stick.x * 35}px, ${stick.z * 35}px)` }}/></div>
      {error && <div role="alert" className="connection-alert">{error}</div>}
      {panel && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className="modal" role="dialog" aria-modal="true" aria-label={panel === 'map' ? 'Town map' : 'Settings'} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setPanel(null); if (e.key === 'Tab') { const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')]; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><button autoFocus className="close" aria-label="Close panel" onClick={() => setPanel(null)}><Icon kind="close"/></button><span className="eyebrow">SLOP CITY</span><h2>{panel === 'map' ? 'Get your bearings.' : 'Make it comfortable.'}</h2>{panel === 'map' ? <><svg className="town-map" viewBox="-30 -30 60 60" role="img" aria-label="Map of the square: casino north, clothing shop east, fountain in the centre"><rect x="-27" y="-27" width="54" height="54" rx="1" fill="#d9d3bd"/><path d="M-4-26H4V26H-4ZM-26-1H26V5H-26Z" fill="#f2eedf"/><rect x="-16" y="-26" width="32" height="12" fill="#687e6b"/><rect x="18" y="-8" width="8" height="20" fill="#a58f70"/><circle cx="0" cy="-1" r="3.2" fill="#83aca5"/>{[[-10, -4], [10, -4], [-10, 11], [10, 11]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2" fill="#8a996b"/>)}<text x="0" y="-19" textAnchor="middle">CASINO</text><text x="22" y="1" textAnchor="middle" transform="rotate(90 22 1)">CLOTHING</text>{[...players.entries()].map(([id, p]) => <circle key={id} cx={p.x} cy={-p.z} r={id === room.current?.sessionId ? 1 : .6} fill={id === room.current?.sessionId ? '#253d33' : '#9cab84'} stroke="#fff" strokeWidth=".25"/>)}</svg><p className="map-legend"><span className="live-dot"/> You are in {stats.district}.</p></> : <><div className="comfort-settings"><label className="setting"><span>Performance mode<small>Lighter water and shadows; a smaller render budget.</small></span><input type="checkbox" checked={low} onChange={e => updatePreferences({low:e.target.checked})}/></label><label className="setting"><span>Motion<small>Reduce decorative movement; keep game results visible.</small></span><select aria-label="Motion preference" value={preferences.motion} onChange={e=>updatePreferences({motion:e.target.value as Preferences['motion']})}><option value="system">Follow device</option><option value="reduced">Reduced</option><option value="full">Full</option></select></label><fieldset><legend>City sound</legend><label className="setting"><span>Sound effects <output>{Math.round(preferences.effects*100)}%</output></span><input aria-label="Sound effects volume" type="range" min="0" max="1" step="0.05" value={preferences.effects} onChange={e=>updatePreferences({effects:Number(e.target.value)})}/></label><label className="setting"><span>Fountain ambience <output>{Math.round(preferences.ambience*100)}%</output></span><input aria-label="Fountain ambience volume" type="range" min="0" max="1" step="0.05" value={preferences.ambience} onChange={e=>updatePreferences({ambience:Number(e.target.value)})}/></label><small>Slide to zero to mute. Saved for this browser.</small></fieldset></div><div className="setting"><span>Proximity voice<small>Join from Social. Your microphone starts muted.</small></span><Icon kind="mic"/></div><p className="diagnostics">Rendering at {stats.fps} fps · {players.size} connected<br/>Saved guest · Shared town</p><button className="secondary" onClick={() => { setPanel(null); void room.current?.leave(); }}>Leave the square</button></>}</section></div>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
