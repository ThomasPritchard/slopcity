import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { EMOTE_POSES, type SharedEmoteKind } from '../../shared/emotePoses';
import { EMOTE_REACH, type EmoteCommand, type EmoteInbox } from '../../shared/emotes';
import { GIFT_DISTANCE, MAX_GIFT_CREDITS, type FriendAction, type SocialPerson, type SocialSnapshot } from '../../shared/playerSocial';
import type { PendingGift } from './usePlayerSocial';
import './player-interactions.css';

export type SelectedNeighbour = { profileId: string; name: string };
export function EmotePrompt({ inbox, onCommand }: { inbox: EmoteInbox; onCommand: (command: EmoteCommand) => void }) {
  const incoming = inbox.incoming, outgoing = inbox.outgoing;
  if (!incoming && !outgoing) return null;
  return <div className="emote-prompt" role="region" aria-label="Shared emote invitation">
    {incoming ? <><p><strong>{incoming.fromName}</strong> invites you to {incoming.kind === 'hug' ? 'a hug' : 'a handshake'}.</p><span>Only if you feel like it. This invitation expires shortly.</span><div><button className="social-button is-primary" onClick={() => onCommand({ action: 'accept', id: incoming.id })}>Accept {incoming.kind}</button><button className="social-button" onClick={() => onCommand({ action: 'decline', id: incoming.id })}>Decline</button></div></> : <><p>Waiting for <strong>{outgoing!.toName}</strong> to accept {outgoing!.kind === 'hug' ? 'your hug' : 'your handshake'}.</p><button className="social-button" onClick={() => onCommand({ action: 'cancel' })}>Cancel invitation</button></>}
  </div>;
}

export function FriendsList({ snapshot, busy, error, notice, pending, onOpen, onFriend, onRetry }: { snapshot: SocialSnapshot | null; busy: boolean; error: string; notice: string; pending: PendingGift | null; onOpen: (person: SelectedNeighbour) => void; onFriend: (targetId: string, action: FriendAction) => void; onRetry: () => void }) {
  const render = (people: SocialPerson[], kind: 'friends' | 'incoming' | 'outgoing') => <ul className="social-list">{people.map(person => <li className="social-person friend-person" key={person.profileId}><button className="friend-name" onClick={() => onOpen(person)} aria-label={`View ${person.name}`}><strong>{person.name}</strong><span>{person.online ? 'In town' : 'Away'}</span></button><div className="social-person-actions">{kind === 'incoming' ? <><button className="social-button is-primary" disabled={busy} onClick={() => onFriend(person.profileId, 'accept')} aria-label={`Accept friend request from ${person.name}`}>Accept</button><button className="social-button" disabled={busy} onClick={() => onFriend(person.profileId, 'decline')} aria-label={`Decline friend request from ${person.name}`}>Decline</button></> : kind === 'outgoing' ? <button className="social-button" disabled={busy} onClick={() => onFriend(person.profileId, 'cancel')} aria-label={`Cancel friend request to ${person.name}`}>Cancel</button> : <button className="social-button" onClick={() => onOpen(person)} aria-label={`Open friend card for ${person.name}`}>View</button>}</div></li>)}</ul>;
  return <section className="social-neighbours friends-section" aria-label="Friends">
    <div className="social-section-heading"><h3>Friends</h3><span className="social-count">{snapshot?.friends.length ?? 0}</span></div>
    {error && <p className="social-error" role="alert">{error} <button className="social-button" onClick={onRetry}>Refresh</button></p>}
    {notice && <p className="social-copy" role="status">{notice}</p>}
    {!snapshot ? <p className="social-copy">Loading your friends…</p> : <>
      {snapshot.incoming.length > 0 && <><h4>Friend requests</h4>{render(snapshot.incoming, 'incoming')}</>}
      {snapshot.friends.length ? render(snapshot.friends, 'friends') : <p className="social-empty">Someone you enjoy spending time with? Open their card to add them.</p>}
      {snapshot.outgoing.length > 0 && <><h4>Requests sent</h4>{render(snapshot.outgoing, 'outgoing')}</>}
    </>}
    {pending && <button className="social-button pending-gift-link" onClick={() => onOpen({ profileId: pending.targetId, name: pending.targetName })}>Check pending gift to {pending.targetName}</button>}
    <p className="social-copy">Saved with this browser’s guest profile. Clearing cookies loses access.</p>
  </section>;
}

type Props = {
  person: SelectedNeighbour; online: boolean; distance: number; blocked: boolean; muted: boolean; available: boolean;
  snapshot: SocialSnapshot | null; balance: number; busy: boolean; error: string; notice: string; pending: PendingGift | null;
  invitation?: ReactNode; canInvite: boolean;
  onClose(): void; onMute(): void; onBlock(): void; onFriend(action: FriendAction): void; onEmote(kind: SharedEmoteKind): void;
  onGift(amount: number): Promise<boolean>;
};
export function PlayerCard({ person, online, distance, blocked, muted, available, snapshot, balance, busy, error, notice, pending, invitation, canInvite, onClose, onMute, onBlock, onFriend, onEmote, onGift }: Props) {
  const panel = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null), title = useId();
  const [view, setView] = useState<'actions' | 'gift' | 'confirm'>('actions');
  const [amount, setAmount] = useState('50');
  const [removeFriend, setRemoveFriend] = useState(false);
  const isFriend = snapshot?.friends.some(p => p.profileId === person.profileId), incoming = snapshot?.incoming.some(p => p.profileId === person.profileId), outgoing = snapshot?.outgoing.some(p => p.profileId === person.profileId);
  const maximum = Math.max(0, Math.min(balance, snapshot?.giftingAllowance ?? 0, MAX_GIFT_CREDITS));
  const number = Number(amount), validAmount = /^\d+$/.test(amount) && Number.isSafeInteger(number) && number > 0 && number <= maximum;
  const ownPending = pending?.targetId === person.profileId ? pending : null;
  const canGive = online && !blocked && distance <= GIFT_DISTANCE;
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target)) close.current?.focus({ preventScroll: true }); };
    document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('focusin', focus); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else document.getElementById('world')?.focus({ preventScroll: true }); };
  }, []);
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter(e => e.getClientRects().length);
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
  return <div className="social-backdrop player-card-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) event.preventDefault(); }}>
    <section ref={panel} className="social-panel player-card" role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={key}>
      <header className="social-header"><div><span className="eyebrow">A FACE IN THE SQUARE</span><h2 id={title}>{person.name}</h2><p className="player-presence">{blocked ? 'Blocked for you' : !online ? 'Not in this town right now' : `${Math.round(distance)} m away`}{isFriend && !blocked ? ' · Your friend' : ''}</p></div><button ref={close} className="social-close" aria-label="Close player card" onClick={onClose}>×</button></header>
      <div className="social-content player-card-content">
        {invitation}
        {error && <p className="social-error" role="alert">{error}</p>}
        {notice && <p className="player-receipt" role="status">{notice}</p>}
        {ownPending ? <div className="gift-pending"><h3>Check your gift</h3><p>The result of your {ownPending.amount.toLocaleString()}-credit gift to {person.name} is awaiting confirmation.</p><button className="social-button is-primary" disabled={busy} onClick={() => void onGift(ownPending.amount)}>{busy ? 'Checking…' : 'Check gift result'}</button><p className="social-copy">This checks the original gift. It cannot send it twice.</p></div> : view !== 'actions' ? <form className="gift-form" onSubmit={event => { event.preventDefault(); if (view === 'gift' && validAmount) setView('confirm'); else if (view === 'confirm' && validAmount && canGive) void onGift(number).then(ok => { if (ok) setView('actions'); }); }}>
          <button className="player-back" type="button" onClick={() => setView(view === 'confirm' ? 'gift' : 'actions')}>← {view === 'confirm' ? 'Change amount' : 'Player actions'}</button>
          <h3>{view === 'confirm' ? 'Confirm your gift' : 'Give a little something.'}</h3>
          {view === 'gift' ? <><label htmlFor={`${title}-amount`}>Credits for {person.name}</label><input id={`${title}-amount`} autoFocus type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={amount} onChange={event => setAmount(event.target.value)} /><p className="social-copy">You can give up to {maximum.toLocaleString()} credits right now.</p><p className="social-copy">Each 100-credit salary payment unlocks 100 credits of gifts. Starting credits and gifts you receive add no allowance.</p></> : <><p className="gift-confirm-amount">{number.toLocaleString()} <span>credits</span></p><p>To <strong>{person.name}</strong></p><p className="social-copy">Your wallet afterwards: {(balance - number).toLocaleString()} credits.</p></>}
          {!canGive && <p className="social-copy">Stand within {GIFT_DISTANCE} m of this neighbour to give credits.</p>}
          <button className="social-button is-primary" disabled={!validAmount || busy || !canGive} type="submit">{view === 'confirm' ? busy ? 'Sending…' : `Send ${number.toLocaleString()} credits` : 'Review gift'}</button>
        </form> : <>
          <section className="player-action-section" aria-label="Shared emotes"><h3>Share a moment</h3><p className="social-copy">Send an invitation. They choose whether to join.</p><div className="player-emotes">{(['handshake', 'hug'] as const).map(kind => <button key={kind} className="social-button" disabled={!online || blocked || !available || !canInvite || distance > EMOTE_REACH} onClick={() => onEmote(kind)}><span aria-hidden="true">{kind === 'handshake' ? '↔' : '♡'}</span>{EMOTE_POSES[kind].label}</button>)}</div>{online && !blocked && (!available || distance > EMOTE_REACH) && <p className="social-copy">Both stand within {EMOTE_REACH} m in a clear, level space.</p>}</section>
          <section className="player-action-section" aria-label="Friendship"><h3>{isFriend ? 'A familiar face' : 'Keep in touch'}</h3>
            {incoming ? <div className="player-emotes"><button className="social-button is-primary" disabled={busy || blocked} onClick={() => onFriend('accept')}>Accept friend request</button><button className="social-button" disabled={busy || blocked} onClick={() => onFriend('decline')}>Decline request</button></div> : outgoing ? <button className="social-button" disabled={busy || blocked} onClick={() => onFriend('cancel')}>Cancel friend request</button> : isFriend ? removeFriend ? <div className="player-emotes"><button className="social-button" disabled={busy} onClick={() => { onFriend('remove'); setRemoveFriend(false); }}>Confirm remove friend</button><button className="social-button" onClick={() => setRemoveFriend(false)}>Keep friend</button></div> : <button className="social-button" disabled={busy} onClick={() => setRemoveFriend(true)}>Remove friend</button> : <button className="social-button" disabled={busy || blocked || !snapshot || !online} onClick={() => onFriend('request')}>Add friend</button>}
          </section>
          <section className="player-action-section"><button className="social-button gift-entry" disabled={!canGive || !snapshot || maximum < 1 || !!pending} onClick={() => { setAmount(String(Math.min(50, maximum))); setView('gift'); }}>Give credits <span aria-hidden="true">→</span></button><p className="social-copy">{pending ? `Check your pending gift to ${pending.targetName} first.` : maximum < 1 ? 'Your next salary payment unlocks more credits to give.' : `Up to ${maximum.toLocaleString()} credits available to give.`}</p></section>
        </>}
        <div className="player-safety"><button className="social-button" disabled={!online || blocked} aria-pressed={muted} onClick={onMute}>{muted ? 'Unmute voice' : 'Mute voice'}</button><button className="social-button" onClick={onBlock}>{blocked ? 'Unblock player' : 'Block player'}</button></div>
      </div>
      <footer className="social-footer">Your balance stays private. Every shared emote is by invitation.</footer>
    </section>
  </div>;
}
