import { useAdmission } from './social/useAdmission';
import { useCreditLeaderboard } from './leaderboard/useCreditLeaderboard';
import { CreditLeaderboardPanel } from './leaderboard/CreditLeaderboardPanel';
import { nearCreditBoard } from '../shared/creditLeaderboard';
import { nearMemoriesBoard } from '../shared/memories';
import { CommunityNews } from './community/CommunityNews';
import { CommunityPanel, type CommunityView } from './community/CommunityPanel';
import { useCommunity } from './community/useCommunity';
import { inCinema } from '../shared/cinemaLayout';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from './admin/AdminPage';
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
import { PlayerCard, FriendsList, EmotePrompt, type SelectedNeighbour } from './social/PlayerCard';
import { usePlayerSocial } from './social/usePlayerSocial';
import type { EmoteInbox, EmoteCommand } from '../shared/emotes';
import { EMOTE_POSES } from '../shared/emotePoses';
import { isHopping } from '../shared/mobility';
import { CATALOGUE, STARTER_OUTFIT, clothingItem, isInShop, type WalletState, type EconomyView } from '../shared/catalog';
import { getWallet, buyClothing, equipClothing, WalletError } from './economy/api';
import { Wallet, type TimedWallet } from './economy/Wallet';
import { ShopPanel } from './shop/ShopPanel';
import { CasinoPanel } from './casino/CasinoPanel';
import { CasinoResultAnnouncement } from './casino/CasinoResultAnnouncement';
import type { CasinoResult } from './casino/casinoResults';
import { CASINO_ANCHORS, CASINO_INTERACTION_RADIUS, type CasinoState, type CasinoPrivateState, type CasinoTableId, type CasinoCommand, type CasinoReceipt } from '../shared/casino';
import { LocationAnnouncement } from './ui/LocationAnnouncement';
import { TownMapSvg } from './ui/TownMapSvg';
import { MiniMap } from './ui/MiniMap';
import { TownChat, type ChatLine } from './ui/TownChat';
import './ui/quiet-glass.css';
import { loadPreferences, savePreferences, type Preferences } from './settings/preferences';
import { GRAPHICS_QUALITIES, GRAPHICS_LABELS, GRAPHICS_DESCRIPTIONS, isGraphicsQuality } from './settings/graphics';
import { TownAudio } from './audio/TownAudio';
import { checkChat, moderationNoticeKey, type ModerationNoticeKey } from '../shared/moderation.ts';
import { isBlockedProfileName, PROFILE_NAME_ERROR } from '../shared/profileModeration.ts';

type Chat = { id: string; profileId: string; name: string; body: string };
// Local-only chat panel guidance shown when moderation intervenes. Never sent to the server and
// never visible to anyone else; the server remains the authority on what is actually delivered.
const SYSTEM_LINES: Record<ModerationNoticeKey, string> = {
  profanity: 'Extreme profanity is not tolerated in Slop City. If you keep going, chat may be disabled for you for a while.',
  url: "Links can't be posted in chat right now.",
  flood: 'Easy now — too many messages too quickly.',
  repeat: "That's a repeat of your last message.",
};
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
  const admission = useAdmission();
  const [entryDeadline,setEntryDeadline] = useState(0);
  async function reverifyEntry() {
    try { await admission.ensure(true); setEntryDeadline(0); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please retry the entry check.'); }
  }
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
  const [casinoResults,setCasinoResults]=useState<Record<string,CasinoResult>>({});
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
  const [selectedNeighbour, setSelectedNeighbour] = useState<SelectedNeighbour | null>(null);
  const [emoteInbox, setEmoteInbox] = useState<EmoteInbox>({ serverTime: 0, incoming: null, outgoing: null });
  const [sprintEnabled, setSprintEnabled] = useState(false);
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
  const leaderboard = useCreditLeaderboard(phase === 'playing');
  const socialData = usePlayerSocial(phase === 'playing', guest?.id, acceptWallet);
  const [ready, setReady] = useState(false);
  useEffect(() => { world.current?.syncCreditLeaderboard(leaderboard.snapshot, leaderboard.unavailable); }, [leaderboard.snapshot, leaderboard.unavailable, ready]);
  const [error, setError] = useState('');
  const [players, setPlayers] = useState(new Map<string, PlayerView>());
  const [stats, setStats] = useState<SceneStats>({ fps: 0, district: 'Town Square', x: 0, z: -17 });
  const community = useCommunity(true, phase === 'playing');
  const [panel, setPanel] = useState<'map' | 'settings' | 'leaderboard' | 'memory' | 'cinema' | 'submit' | 'admin' | null>(null);
  const communityViewChanged=useCallback((view:CommunityView)=>setPanel(view==='board'?'memory':view),[]);
  const [chatOpen, setChatOpen] = useState(() => !matchMedia('(pointer: coarse)').matches);
  const [chatFocused, setChatFocused] = useState(false);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [message, setMessage] = useState('');
  const [silencedUntil, setSilencedUntil] = useState(0);
  const [silencedSeconds, setSilencedSeconds] = useState(0);
  const [hint, setHint] = useState(true);
  const [wave, setWave] = useState(false);
  const [previewView, setPreviewView] = useState<'face' | 'outfit' | 'shoes'>('outfit');
  const [stick, setStick] = useState({ x: 0, z: 0 });
  const chatInput = useRef<HTMLInputElement>(null);
  const joystick = useRef<HTMLDivElement>(null);
  const systemSeq = useRef(0);
  const shownSystem = useRef(new Set<ModerationNoticeKey>());
  const silencedAnnounced = useRef(false);
  function pushSystem(body: string) {
    setMessages(previous => [...previous.slice(-79), { id: `system-${systemSeq.current++}`, system: true, body }]);
  }

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
      const scene = new TownScene(canvas.current!, preferences.graphics); world.current = scene;
      scene.onStats = setStats;
      scene.onMotion = (x, z, moving) => audio.current?.motion(x, z, moving);
      scene.onInput = (x, z, sprint) => { if (room.current) room.current.send('input', { x, z, sprint, seq: sequence.current++ }); };
      scene.onJump = () => room.current?.send('jump');
      scene.onSprintChange = setSprintEnabled;
      scene.onCreditLeaderboard = () => { setPanel('leaderboard'); setHint(false); releaseStick(); };
      scene.onMemory = () => { setPanel('memory'); setHint(false); releaseStick(); };
      scene.onCinema = () => { setPanel('cinema'); setHint(false); releaseStick(); };
      scene.onSelectPlayer = profileId => {
        const player = [...(room.current?.state.players.values() ?? [])].find(player => player.profileId === profileId);
        if (player) openNeighbour({ profileId, name: player.name });
      };
      void scene.ready.then(() => setReady(true)).catch(err => setError(`The scene assets could not load. ${err instanceof Error ? err.message : ''}`));
      timer = setInterval(() => {
        const state = room.current?.state;
        if (!state?.players) return;
        const snapshot = new Map<string, PlayerView>();
        state.players.forEach((p, id) => snapshot.set(id, { profileId: p.profileId, seatId: p.seatId, top:p.top, bottoms:p.bottoms, shoes:p.shoes, name: p.name, x: p.x, z: p.z, heading: p.heading, moving: p.moving, shirt: p.shirt, skin: p.skin, wave: p.wave, sprinting: p.sprinting, jumpAt: p.jumpAt, emoteId: p.emoteId, emoteKind: p.emoteKind, emoteRole: p.emoteRole, emoteAt: p.emoteAt }));
        for (const player of snapshot.values()) knownNames.current.set(player.profileId, player.name);
        scene.sync(snapshot); setPlayers(snapshot);
      }, 50);
    } catch (err) { setError(`The 3D scene could not start. Try a browser with WebGL enabled. ${err instanceof Error ? err.message : ''}`); }
    return () => { mounted = false; window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); audio.current?.dispose(); if(casinoTimeout.current)clearTimeout(casinoTimeout.current); void voiceClient.current?.leave(); clearInterval(timer); const current = room.current; room.current = null; void current?.leave(); world.current?.dispose(); };
  }, []);
  useEffect(() => {
    savePreferences(preferences);
    world.current?.setQuality(preferences.graphics);
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
  useEffect(() => {
    if (phase !== 'playing' || panel || socialOpen || selectedNeighbour || shopMode) return;
    const chatShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')) return;
      event.preventDefault(); event.stopPropagation();
      setChatOpen(true); releaseStick();
      requestAnimationFrame(() => chatInput.current?.focus({ preventScroll: true }));
    };
    document.addEventListener('keydown', chatShortcut, true);
    return () => document.removeEventListener('keydown', chatShortcut, true);
  }, [phase, panel, socialOpen, selectedNeighbour, shopMode]);
  useEffect(() => {
    if (!silencedUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((silencedUntil - Date.now()) / 1000));
      setSilencedSeconds(left);
      if (!left) {
        if (silencedAnnounced.current) pushSystem('Chat is available again. Welcome back.');
        silencedAnnounced.current = false;
        setSilencedUntil(0);
      }
    };
    tick(); const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [silencedUntil]);
  useEffect(() => { if(ready) world.current?.syncCommunity(community.programme); }, [community.programme, ready]);
  useEffect(() => { if(ready) world.current?.setCinemaPlaybackEnabled(phase === 'playing' && panel === null && !socialOpen && !selectedNeighbour && !shopMode && !casinoTable); }, [ready,phase,panel,socialOpen,selectedNeighbour,shopMode,casinoTable]);
  useEffect(() => { if(ready)world.current?.focusCommunity(phase==='playing' ? panel==='memory'?'board':panel==='cinema'?'cinema':null : null); }, [panel,phase,ready]);
  useEffect(() => { world.current?.setPaused(panel !== null || socialOpen || selectedNeighbour !== null || chatFocused || shopMode!==null || casinoTable!==null || phase !== 'playing'); }, [panel, socialOpen, selectedNeighbour, chatFocused, shopMode, casinoTable, phase]);
  useEffect(() => {
    if (phase === 'playing') room.current?.send('interaction-busy', panel !== null || shopMode !== null || casinoTable !== null || chatFocused);
  }, [panel, shopMode, casinoTable, chatFocused, phase]);
  useEffect(() => { world.current?.selectPlayer(selectedNeighbour?.profileId ?? null); }, [selectedNeighbour?.profileId]);
  const activeEmoteId = players.get(room.current?.sessionId ?? '')?.emoteId;
  useEffect(() => { if (activeEmoteId) { setSelectedNeighbour(null); setSocialOpen(false); } }, [activeEmoteId]);
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
    if (focusedCasino.current && focusedCasino.current !== id) room.current?.send('casino-command', { requestId: crypto.randomUUID(), action: 'table-presence', tableId: focusedCasino.current, viewing: false });
    focusedCasino.current=id;audio.current?.casino(casinoState,id);setPanel(null);setSocialOpen(false);setHint(false);setCasinoTable(id);setCasinoError('');setCasinoNotice('');world.current?.focusCasino(anchor);
    room.current?.send('casino-command', { requestId: crypto.randomUUID(), action: 'table-presence', tableId: id, viewing: true });
    room.current?.send('casino-command',{requestId:crypto.randomUUID(),action:'sync'});
  }
  function closeCasino() {if (focusedCasino.current) room.current?.send('casino-command', { requestId: crypto.randomUUID(), action: 'table-presence', tableId: focusedCasino.current, viewing: false });focusedCasino.current=null;audio.current?.casino(casinoState,null);setCasinoTable(null);world.current?.focusCasino(null);}
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
    if (isBlockedProfileName(profile.name)) { setError(PROFILE_NAME_ERROR); return; }
    setSaving(true); setError('');
    try {
      if (!guest) {
        const saved = await establishGuest(parseProfile(profile),await admission.requestToken());
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
    if (isBlockedProfileName(profile.name)) { setError(PROFILE_NAME_ERROR); return; }
    joining.current = true; setError(''); setPhase('joining');
    const clean = parseProfile(profile); setProfile(clean);
    try {
      if (clean.name !== guest.name || clean.shirt !== guest.shirt || clean.skin !== guest.skin) setGuest(await saveGuest(clean, guest.revision));
      await admission.ensure();
      const endpoint = import.meta.env.VITE_GAME_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/game`;
      const connected = await new Client(endpoint).joinOrCreate<TownState>('town');
      room.current = connected; sequence.current = 0; setEntryDeadline(0);
      connected.onMessage<{deadline:number}>('entry-check',({deadline})=>{setEntryDeadline(deadline);world.current?.stopMovement();void reverifyEntry();});
      connected.onMessage<EconomyView>('economy',value=>acceptWallet(value,value.accruing));
      connected.onMessage<string>('economy-error',text=>setNotice(text));
      connected.onMessage('social-changed', () => void socialData.refresh());
      connected.onMessage<EmoteInbox>('emote-inbox', value => { setEmoteInbox(value); world.current?.syncInteractionTime(value.serverTime); });
      connected.send('emote-command', { action: 'sync' });
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
        if (receipt.ok && ['leave','poker-leave'].includes(casinoPending.current.action)) {
          closeCasino(); setNotice(receipt.message === 'Accepted' ? 'You left your seat.' : receipt.message); setTimeout(() => setNotice(''), 5000);
        }
        if(casinoTimeout.current)clearTimeout(casinoTimeout.current);casinoPending.current=null;setCasinoBusy(false);setCasinoRetry(false);
        setCasinoError(receipt.ok?'':receipt.message);setCasinoNotice(receipt.ok?receipt.message:'');
      });
      connected.send('casino-command',{requestId:crypto.randomUUID(),action:'sync'});
      connected.onMessage<VoiceNeighbour[]>('voice-neighbours', targets => voiceClient.current?.setTargets(targets));
      connected.onMessage<string>('notice', text => {
        const key = moderationNoticeKey(text);
        if (key) {
          if (!shownSystem.current.has(key)) { shownSystem.current.add(key); pushSystem(SYSTEM_LINES[key]); }
          return;
        }
        setNotice(text); setTimeout(() => setNotice(''), 3500);
      });
      connected.onMessage<Chat>('chat', value => setMessages(previous => [...previous.slice(-79), value]));
      connected.onMessage<{ seconds?: number }>('silenced', value => {
        const seconds = Math.max(0, Math.floor(Number(value?.seconds) || 0));
        if (seconds > 0 && !silencedAnnounced.current) {
          silencedAnnounced.current = true;
          pushSystem(`Chat is disabled for you for ${seconds}s. Please keep it friendly.`);
        }
        setSilencedSeconds(seconds); setSilencedUntil(seconds > 0 ? Date.now() + seconds * 1000 : 0);
      });
      connected.onError((_code, text) => setError(text || 'The connection encountered a problem.'));
      connected.onLeave((code) => {
        if (room.current !== connected) return;
        room.current = null; setEntryDeadline(0); setSelectedNeighbour(null); setEmoteInbox({ serverTime: 0, incoming: null, outgoing: null }); setShopMode(null);setCasinoTable(null);setCasinoState({serverTime:Date.now(),tables:[]});setCasinoPrivate({rouletteBets:[]});casinoPending.current=null;if(casinoTimeout.current)clearTimeout(casinoTimeout.current);setCasinoBusy(false);setCasinoRetry(false);world.current?.focusCasino(null); if(walletRef.current)acceptWallet(walletRef.current,false); void voiceClient.current?.leave(); voiceClient.current?.setTargets([]); setSocialOpen(false); setMuted(new Set()); world.current?.sync(new Map()); setPlayers(new Map()); setPhase('disconnected');
        setSilencedUntil(0); setSilencedSeconds(0); silencedAnnounced.current = false;
        setError(code===4009?'Please complete a fresh entry check to rejoin.':code===4003?'Access to Slop City is currently restricted.':code===4008?'Too many game messages. Please wait before rejoining.':'You have left the town. Rejoin to continue.');
      });
      try { localStorage.setItem('slop-city-profile', JSON.stringify(clean)); } catch { /* A restricted browser can still play. */ }
      setNotice(''); world.current.enter(connected.sessionId); setPhase('playing'); setHint(true); setMessages([]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not join the town. Please try again.'); setPhase('customising'); }
    finally { joining.current = false; }
  }
  function openNeighbour(person: SelectedNeighbour) {
    socialData.clearFeedback(); setSelectedNeighbour(person); setSocialOpen(false); setPanel(null); setHint(false); releaseStick();
  }
  function sendEmote(command: EmoteCommand) {
    if (command.action === 'request' || command.action === 'accept') { releaseStick(); world.current?.stopMovement(); }
    room.current?.send('emote-command', command);
  }
  function muteNeighbour(id: string) {
    setMuted(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); voiceClient.current?.setMuted(next); return next; });
  }
  async function blockNeighbour(profileId: string, blocked: boolean) {
    try { const result = await setGuestBlock(profileId, blocked); setGuest(previous => previous ? { ...previous, blocks: result.blocks } : null); if (blocked) setMessages(previous => previous.filter(message => message.profileId !== profileId)); void socialData.refresh(); }
    catch { setNotice('That change could not be saved. Please try again.'); }
  }
  function returnFromChat() {
    setChatFocused(false);
    if (focusedCasino.current) document.querySelector<HTMLButtonElement>('.casino-primary:not(:disabled), .casino-close')?.focus({ preventScroll: true });
    else canvas.current?.focus({ preventScroll: true });
  }
  function closeChat() { setChatOpen(false); returnFromChat(); }
  function openChat() { setChatOpen(true); requestAnimationFrame(() => chatInput.current?.focus({ preventScroll: true })); }
  function sendChat(event: React.FormEvent) {
    event.preventDefault();
    const body = message.trim(); if (!body || !room.current || silencedUntil > 0) return;
    const verdict = checkChat(body);
    if (!verdict.ok) {
      // Instant feedback only; the server still decides. Keep the draft so it can be edited.
      if (!shownSystem.current.has(verdict.reason)) { shownSystem.current.add(verdict.reason); pushSystem(SYSTEM_LINES[verdict.reason]); }
      return;
    }
    room.current.send('chat', body); setMessage(''); returnFromChat();
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
  const nearbyGames = localPlayer && stats.district === 'The Meridian Casino' && !casinoTable && !shopMode && !panel && !socialOpen && !selectedNeighbour && !localPlayer.emoteId && (!chatOpen || !matchMedia('(pointer: coarse)').matches) ? CASINO_ANCHORS.filter(anchor => Math.hypot(localPlayer.x-anchor.x, localPlayer.z-anchor.z) <= CASINO_INTERACTION_RADIUS).sort((a,b) => Math.hypot(localPlayer.x-a.x,localPlayer.z-a.z)-Math.hypot(localPlayer.x-b.x,localPlayer.z-b.z)) : [];
  const [hoveredGame, setHoveredGame] = useState<CasinoTableId | null>(null);
  const [pickedGame, setPickedGame] = useState<CasinoTableId | null>(null);
  const pickedAnchor = pickedGame ? nearbyGames.find(anchor => anchor.id === pickedGame) ?? null : null;
  const focusGame = pickedAnchor ?? nearbyGames.find(anchor => anchor.id === hoveredGame) ?? nearbyGames[0] ?? null;
  useEffect(() => {
    if (pickedGame && !nearbyGames.some(anchor => anchor.id === pickedGame)) setPickedGame(null);
    if (hoveredGame && !nearbyGames.some(anchor => anchor.id === hoveredGame)) setHoveredGame(null);
  }, [nearbyGames, pickedGame, hoveredGame]);
  useEffect(() => { world.current?.setInteractionFocus(focusGame); }, [focusGame?.id]);
  const selectedLive = selectedNeighbour ? [...players.entries()].find(([, player]) => player.profileId === selectedNeighbour.profileId) : undefined;
  const selectedDistance = localPlayer && selectedLive ? Math.hypot(localPlayer.x - selectedLive[1].x, localPlayer.z - selectedLive[1].z) : Infinity;
  const movementDisabled = !!localPlayer?.seatId || !!localPlayer?.emoteId || isHopping(localPlayer?.jumpAt ?? 0, Date.now());
  const invitation = <EmotePrompt inbox={emoteInbox} onCommand={sendEmote}/>;
  const playing = phase === 'playing';
  const customising = phase === 'customising' || phase === 'joining';
  const townChat = chatOpen ? <TownChat messages={messages} message={message} name={profile.name} colour={SHIRTS[profile.shirt]} population={players.size} silenced={silencedUntil>0} silencedSeconds={silencedSeconds} inputRef={chatInput} onChange={setMessage} onSubmit={sendChat} onFocus={()=>{setChatFocused(true);releaseStick();world.current?.setPaused(true);}} onBlur={()=>setChatFocused(false)} onClose={closeChat}/> : null;
  const casinoChat = <aside className={`casino-chat${chatOpen?' is-open':''}`} aria-label="Chat while playing">{townChat ?? <button className="casino-chat-toggle" type="button" aria-label="Open town chat" aria-keyshortcuts="/" onClick={openChat}><Icon kind="chat"/>Chat<kbd>/</kbd></button>}</aside>;
  return <main className={playing ? `game playing${shopMode?' shopping':''}${casinoTable?' at-table':''}${chatFocused?' typing-chat':''}` : customising ? 'game customising' : 'game welcome-menu'}>
    <canvas id="world" ref={canvas} tabIndex={0} aria-label="Slop City 3D world. Use W A S D or arrows to walk, Shift to sprint, Space to jump, and drag to look around. Select a neighbour to interact." />
    <div className="vignette" />
    <header className="masthead">
      <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="Slop City"><span className="brand-mark">s<span>c</span></span><span>SLOP CITY<small>{playing ? `THE NEIGHBOURHOOD · ${stats.district.toUpperCase()}` : 'A PLACE TO MAKE YOUR OWN'}</small></span></a>
      <div className="top-right"><span className="build-tag">PRE-ALPHA <i>v0.1</i></span>{playing && <span className="population"><span className="live-dot"/><Icon kind="people" size={16}/>{players.size}<span className="muted">/ {CAPACITY}</span></span>}</div>
    </header>
    {!playing && !customising && <>
      <div className="welcome-shade" />
      <div className="welcome-layout">
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
      <CommunityNews onOpen={() => setPanel('memory')}/>
      </div>
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
      <div className="hud-right-stack">
        <Wallet wallet={wallet} onWardrobe={()=>void openShop('wardrobe')}/>
        {voiceState.status !== 'off' && <button className="voice-status" onClick={event => { event.currentTarget.focus(); setSocialOpen(true); }} aria-label="Open voice controls">{voiceState.status === 'connected' ? voiceState.micEnabled ? 'Voice · Mic on' : 'Voice · Mic off' : voiceState.status === 'connecting' ? 'Voice connecting…' : 'Voice disconnected'}</button>}
        <MiniMap players={players} sessionId={room.current?.sessionId} pressed={panel === 'map'} onOpen={() => setPanel(panel === 'map' ? null : 'map')}/>
      </div>
      {localPlayer && isInShop(localPlayer.x,localPlayer.z) && !shopMode && <button className="shop-entry" onClick={()=>void openShop('shop')}>Browse Form & Thread</button>}
      <ShopPanel open={shopMode!==null} mode={shopMode??'shop'} balance={wallet?.balance??0} items={[...CATALOGUE]} owned={wallet?.owned??[]} equipped={wallet?.outfit??STARTER_OUTFIT} selectedId={selectedItem} busy={shopBusy} error={shopError} notice={shopNotice} onSelect={id=>{setSelectedItem(id);setShopError('');setShopNotice('');const item=clothingItem(id);world.current?.framePreview(item?.slot==='shoes'?'shoes':'outfit');}} onBuy={id=>void clothingAction(id,true)} onEquip={id=>void clothingAction(id,false)} onClose={closeShop} onRotate={direction=>world.current?.rotatePreview(direction)} onFrame={view=>world.current?.framePreview(view)}/>
      {notice && <div className="social-notice" role="status">{notice}</div>}
      {(localPlayer?.seatId || nearbySeats.length > 0) && <button className={`seat-action${localPlayer?.seatId.startsWith('casino:') ? ' casino-seat-action' : ''}`} disabled={localPlayer?.seatId.startsWith('casino:') ? casinoBusy : !localPlayer?.seatId && (!availableSeat || movementDisabled)} onClick={() => { if (localPlayer?.seatId.startsWith('casino:')) sendCasino({ requestId: crypto.randomUUID(), action: 'leave', tableId: localPlayer.seatId.split(':')[1] as CasinoTableId }); else if (localPlayer?.seatId) room.current?.send('stand'); else if (availableSeat) room.current?.send('sit', availableSeat.id); canvas.current?.focus(); }}>{localPlayer?.seatId ? localPlayer.seatId.startsWith('casino:') ? 'Leave seat' : 'Stand up' : availableSeat ? 'Sit down' : 'Bench occupied'}</button>}
      <SocialPanel onInspect={(profileId, name) => openNeighbour({ profileId, name })} invitation={invitation} extra={<FriendsList snapshot={socialData.snapshot} busy={socialData.busy} error={socialData.error} notice={socialData.notice} pending={socialData.pending} onOpen={openNeighbour} onFriend={(id, action) => void socialData.friend(id, action)} onRetry={() => void socialData.refresh()}/>} open={socialOpen} onClose={() => setSocialOpen(false)} voice={voiceState} neighbours={neighbours} blockedProfiles={(guest?.blocks ?? []).map(profileId => ({profileId, name: knownNames.current.get(profileId) ?? 'Guest not in town'}))} onJoinVoice={() => void voiceClient.current?.join()} onLeaveVoice={() => void voiceClient.current?.leave()} onToggleMic={() => void voiceClient.current?.toggleMicrophone()} onResumeAudio={() => void voiceClient.current?.resumeAudio()} onMute={muteNeighbour} onBlock={id => void blockNeighbour(id,true)} onUnblock={id => void blockNeighbour(id,false)}/>

      {nearbyGames.length > 0 && <div className="casino-entry" aria-label="Nearby casino games">{nearbyGames.map(anchor=><button key={anchor.id} aria-current={focusGame?.id===anchor.id ? 'true' : undefined} style={nearbyGames.length>1&&focusGame&&focusGame.id!==anchor.id?{opacity:.72}:undefined} onPointerEnter={()=>setHoveredGame(anchor.id)} onPointerLeave={()=>setHoveredGame(null)} onFocus={()=>setHoveredGame(anchor.id)} onBlur={()=>setHoveredGame(null)} onPointerDown={()=>{setPickedGame(anchor.id);setHoveredGame(anchor.id);world.current?.setInteractionFocus(anchor);}} onClick={()=>{setPickedGame(anchor.id);setHoveredGame(anchor.id);world.current?.setInteractionFocus(anchor);openCasino(anchor.id);}}>Open {anchor.name}</button>)}</div>}
      <CasinoPanel open={casinoTable!==null} table={casinoState.tables.find(table=>table.id===casinoTable)??null} serverTime={casinoState.serverTime} profileId={guest?.id??''} balance={wallet?.balance??0} privateState={casinoPrivate} busy={casinoBusy} error={casinoError} notice={casinoNotice} latestResult={casinoTable ? casinoResults[casinoTable] : undefined} onCommand={command=>sendCasino(command)} onClose={closeCasino} chat={casinoChat}/>
      <CasinoResultAnnouncement state={casinoState} privateState={casinoPrivate} profileId={guest?.id??''} atTable={casinoTable!==null} onResults={results=>setCasinoResults(previous=>({...previous,...Object.fromEntries(results.map(result=>[result.tableId,result]))}))}/>
      {casinoRetry && <button className="casino-retry" onClick={()=>{if(casinoPending.current)sendCasino(casinoPending.current,true);}}>Retry last casino action</button>}
      {localPlayer && nearCreditBoard(localPlayer.x, localPlayer.z) && !panel && !socialOpen && !selectedNeighbour && !casinoTable && !shopMode && !localPlayer.emoteId && <button className="shop-entry" onClick={() => { setPanel('leaderboard'); setHint(false); releaseStick(); }}>View credit leaderboard</button>}
      {localPlayer && inCinema(localPlayer.x,localPlayer.z) && !panel && !socialOpen && !selectedNeighbour && !casinoTable && !shopMode && !localPlayer.emoteId && <button className="shop-entry cinema-entry-action" onClick={() => { setPanel('cinema'); setHint(false); releaseStick(); }}>Visit the picture house</button>}
      {panel === 'leaderboard' && <CreditLeaderboardPanel snapshot={leaderboard.snapshot} unavailable={leaderboard.unavailable} onClose={() => setPanel(null)}/>}
      {localPlayer && nearMemoriesBoard(localPlayer.x, localPlayer.z) && !panel && !socialOpen && !selectedNeighbour && !casinoTable && !shopMode && !localPlayer.emoteId && <button className="shop-entry" onClick={() => { setPanel('memory'); setHint(false); releaseStick(); }}>Examine the memories board</button>}
      <LocationAnnouncement key={stats.district} name={stats.district}/>
      {hint && <aside className="welcome-hint"><button className="close" aria-label="Dismiss welcome" onClick={() => setHint(false)}><Icon kind="close" size={16}/></button><span className="eyebrow">GOOD TO SEE YOU, {profile.name.toUpperCase()}</span><h2>Make yourself at home.</h2><p>Take a walk. Meet a neighbour.<br/>There’s no rush to be anywhere.</p></aside>}
      <div className="bottom-left">
        {!casinoTable && townChat}
        <div className="identity"><span className="identity-dot" style={{ background: SHIRTS[profile.shirt] }}/><span>{profile.name}<small>NEW NEIGHBOUR</small></span><span className="identity-status">IN TOWN</span></div>
      </div>
      <div className="controls-hint"><kbd>W</kbd><span className="key-stack"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Walk</span><span className="divider"/>Drag to look<span className="divider"/>Scroll to zoom<span className="divider"/><kbd>/</kbd>Chat</div>
      {selectedNeighbour && <PlayerCard key={selectedNeighbour.profileId} person={selectedNeighbour} online={!!selectedLive} distance={selectedDistance} blocked={guest?.blocks.includes(selectedNeighbour.profileId) ?? false} muted={!!selectedLive && muted.has(selectedLive[0])} available={!movementDisabled && !selectedLive?.[1].seatId && !selectedLive?.[1].emoteId && !isHopping(selectedLive?.[1].jumpAt ?? 0, Date.now())} snapshot={socialData.snapshot} balance={wallet?.balance ?? 0} busy={socialData.busy} error={socialData.error} notice={socialData.notice} pending={socialData.pending} invitation={invitation} canInvite={!emoteInbox.incoming && !emoteInbox.outgoing} onClose={() => setSelectedNeighbour(null)} onMute={() => { if (selectedLive) muteNeighbour(selectedLive[0]); }} onBlock={() => void blockNeighbour(selectedNeighbour.profileId, !(guest?.blocks.includes(selectedNeighbour.profileId) ?? false))} onFriend={action => void socialData.friend(selectedNeighbour.profileId, action)} onEmote={kind => sendEmote({ action: 'request', targetId: selectedNeighbour.profileId, kind })} onGift={amount => socialData.gift(selectedNeighbour.profileId, selectedNeighbour.name, amount)}/>}
      {!socialOpen && !selectedNeighbour && !panel && !casinoTable && !shopMode && <div className="emote-world-prompt">{invitation}{localPlayer?.emoteId && <div className="emote-active"><span>{localPlayer.emoteKind === 'hug' ? EMOTE_POSES.hug.label : EMOTE_POSES.handshake.label} · A shared moment</span><button className="social-button" onClick={() => { sendEmote({ action: 'cancel' }); canvas.current?.focus(); }}>Stop emote</button></div>}</div>}
      {!socialOpen && !selectedNeighbour && !panel && !casinoTable && !shopMode && !chatFocused && <div className="mobility-controls" aria-label="Movement actions"><button aria-label="Toggle sprint" aria-pressed={sprintEnabled} disabled={!!localPlayer?.seatId || !!localPlayer?.emoteId} onMouseDown={event => event.preventDefault()} onClick={() => { world.current?.setSprint(!sprintEnabled); canvas.current?.focus(); }}>Sprint <kbd>Shift</kbd></button><button aria-label="Jump" disabled={movementDisabled} onMouseDown={event => event.preventDefault()} onClick={() => { world.current?.jump(); canvas.current?.focus(); }}>Jump <kbd>Space</kbd></button></div>}
      <nav className="toolbar" aria-label="Town tools">
        <button title="Community memories" aria-label="Open community memories" aria-pressed={panel==='memory'} onClick={()=>{setSocialOpen(false);setPanel('memory');}}><Icon kind="people"/><span>Memories</span></button>
        <button title="Town chat (/)" aria-keyshortcuts="/" aria-label="Toggle town chat" aria-pressed={chatOpen} onClick={() => chatOpen ? closeChat() : openChat()}><Icon kind="chat"/><span>Chat</span></button>
        <button title="Wave" aria-label="Wave to neighbours" disabled={wave || movementDisabled} onClick={doWave}><Icon kind="wave"/><span>{wave ? 'Hello!' : 'Wave'}</span></button>
        <button title="Neighbours" aria-label="Open neighbours" aria-pressed={socialOpen} onClick={event => { event.currentTarget.focus(); setPanel(null); setSocialOpen(true); }}><Icon kind="people"/><span>Social</span></button>
        <button title="Town map" aria-label="Open town map" aria-pressed={panel === 'map'} onClick={() => setPanel(panel === 'map' ? null : 'map')}><Icon kind="map"/><span>Map</span></button>
        <button title="Recenter camera" aria-label="Recenter camera" onClick={() => world.current?.recenter()}><Icon kind="compass"/><span>View</span></button>
        <button title="Settings" aria-label="Open settings" aria-pressed={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Icon kind="settings"/><span>Settings</span></button>
      </nav>
      <div className="joystick" ref={joystick} role="group" aria-label="Touch movement control" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); moveStick(event); }} onPointerMove={moveStick} onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}><div className="stick-guide"/><div className="stick" style={{ transform: `translate(${stick.x * 35}px, ${stick.z * 35}px)` }}/></div>
      {error && <div role="alert" className="connection-alert">{error}</div>}
      {(panel === 'map' || panel === 'settings') && <div className="modal-backdrop" onClick={() => setPanel(null)}><section className="modal" role="dialog" aria-modal="true" aria-label={panel === 'map' ? 'Town map' : 'Settings'} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setPanel(null); if (e.key === 'Tab') { const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')]; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><button autoFocus className="close" aria-label="Close panel" onClick={() => setPanel(null)}><Icon kind="close"/></button><span className="eyebrow">SLOP CITY</span><h2>{panel === 'map' ? 'Get your bearings.' : 'Make it comfortable.'}</h2>{panel === 'map' ? <><TownMapSvg players={players} sessionId={room.current?.sessionId} labeled ariaLabel="Map of the square: casino north, clothing shop east, picture house west, fountain in the centre"/><p className="map-legend"><span className="live-dot"/> You are in {stats.district}.</p></> : <><div className="comfort-settings"><label className="setting"><span>Graphics quality<small id="graphics-quality-description">{GRAPHICS_DESCRIPTIONS[preferences.graphics]}</small></span><select aria-label="Graphics quality" aria-describedby="graphics-quality-description" value={preferences.graphics} onChange={e => { if (isGraphicsQuality(e.target.value)) updatePreferences({graphics:e.target.value}); }}>{GRAPHICS_QUALITIES.map(quality => <option key={quality} value={quality}>{GRAPHICS_LABELS[quality]}</option>)}</select></label><label className="setting"><span>Motion<small>Reduce decorative movement; keep game results visible.</small></span><select aria-label="Motion preference" value={preferences.motion} onChange={e=>updatePreferences({motion:e.target.value as Preferences['motion']})}><option value="system">Follow device</option><option value="reduced">Reduced</option><option value="full">Full</option></select></label><fieldset><legend>City sound</legend><label className="setting"><span>Sound effects <output>{Math.round(preferences.effects*100)}%</output></span><input aria-label="Sound effects volume" type="range" min="0" max="1" step="0.05" value={preferences.effects} onChange={e=>updatePreferences({effects:Number(e.target.value)})}/></label><label className="setting"><span>Fountain ambience <output>{Math.round(preferences.ambience*100)}%</output></span><input aria-label="Fountain ambience volume" type="range" min="0" max="1" step="0.05" value={preferences.ambience} onChange={e=>updatePreferences({ambience:Number(e.target.value)})}/></label><small>Slide to zero to mute. Saved for this browser.</small></fieldset></div><div className="setting"><span>Proximity voice<small>Join from Social. Your microphone starts muted.</small></span><Icon kind="mic"/></div><p className="diagnostics">Rendering at {stats.fps} fps · {players.size} connected<br/>Saved guest · Shared town</p><button className="secondary" onClick={() => { setPanel(null); void room.current?.leave(); }}>Leave the square</button></>}</section></div>}
    </>}
    {admission.dialog}
    {playing && entryDeadline > 0 && <div className="entry-check-reminder" role="status">The host requested a fresh entry check. Complete it within two minutes to stay in town.<button onClick={()=>void reverifyEntry()}>Complete entry check</button></div>}
    {(panel==='memory'||panel==='cinema'||panel==='submit'||panel==='admin') && <CommunityPanel initialView={panel==='memory'?'board':panel} onViewChange={communityViewChanged} guestAvailable={!!guest} onClose={()=>setPanel(null)}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(/^\/admin\/?$/.test(location.pathname)?<AdminPage/>:<App/>);
