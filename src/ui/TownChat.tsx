import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { CASINO_ANCHORS, type CasinoTableId } from '../../shared/casino';
import type { ChatMessage } from '../../shared/chat';
import './town-chat.css';

export type ChatLine = ChatMessage | { id: string; sentAt: number; system: true; body: string; profileId?: never; channel?: never };
export type ChatTab = 'all' | 'town' | 'table' | 'whisper';
export type ChatPerson = { profileId: string; name: string };
export const isSystemLine = (line: ChatLine): line is Extract<ChatLine, { system: true }> => 'system' in line;
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
function savedChat() {
  try { const p = JSON.parse(localStorage.getItem('slop-city-chat') || '{}'); return { tall: p.tall === true, font: [14, 16, 18].includes(p.font) ? p.font as number : 14 }; }
  catch { return { tall: false, font: 14 }; }
}
type Props = {
  messages: ChatLine[]; message: string; name: string; colour: string; population: number; profileId: string;
  tab: ChatTab; tableId: CasinoTableId | null; target: ChatPerson | null; people: ChatPerson[];
  active: boolean; unread: Record<ChatTab, number>; silenced: boolean; silencedSeconds: number; inputRef: RefObject<HTMLInputElement | null>;
  onChange(value: string): void; onSubmit(event: FormEvent): void;
  onTab(tab: ChatTab): void; onTarget(person: ChatPerson | null): void; onInspect(person: ChatPerson): void;
  onRead(ids: string[]): void; onFocus(): void; onBlur(): void; onClose(): void; onHelp(): void;
};
export function TownChat({ messages, message, name, colour, population, profileId, tab, tableId, target, people, unread, active, silenced, silencedSeconds, inputRef, onChange, onSubmit, onTab, onTarget, onInspect, onRead, onFocus, onBlur, onClose, onHelp }: Props) {
  const history = useRef<HTMLDivElement>(null), following = useRef(true);
  const [atBottom, setAtBottom] = useState(true), [options, setOptions] = useState(savedChat);
  const [visible, setVisible] = useState(!document.hidden);
  const sentDrafts = useRef<string[]>([]), draftIndex = useRef(-1), draftBeforeHistory = useRef('');
  const tableName = CASINO_ANCHORS.find(table => table.id === tableId)?.name;
  const lines = useMemo(() => messages.filter(line => isSystemLine(line) || tab === 'all' || (line.channel === tab && (tab !== 'table' || line.tableId === tableId))), [messages, tab, tableId]);
  const destination = tab === 'whisper' ? target ? `Whisper to ${target.name}` : 'Choose a neighbour to whisper' : tab === 'table' ? tableName || 'Open a casino table to chat' : 'Town';
  const unavailable = silenced || tab === 'table' && !tableId || tab === 'whisper' && (!target || !people.some(person => person.profileId === target.profileId));
  useEffect(() => { try { localStorage.setItem('slop-city-chat', JSON.stringify(options)); } catch { /* Works for this visit without storage. */ } }, [options]);
  useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  useEffect(() => { following.current = true; setAtBottom(true); if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [tab, tableId]);
  useLayoutEffect(() => { if (following.current && history.current) history.current.scrollTop = history.current.scrollHeight; }, [options]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (following.current && history.current) history.current.scrollTop = history.current.scrollHeight; });
    if (history.current) observer.observe(history.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (following.current && history.current) history.current.scrollTop = history.current.scrollHeight;
    if (atBottom && visible && active) onRead(lines.map(line => line.id));
  }, [lines, atBottom, visible, active, onRead]);
  function latest() { following.current = true; setAtBottom(true); if (history.current) history.current.scrollTop = history.current.scrollHeight; }
  function submit(event: FormEvent) {
    if (message.trim()) { sentDrafts.current = [message, ...sentDrafts.current.filter(draft => draft !== message)].slice(0, 20); draftIndex.current = -1; }
    latest(); onSubmit(event);
  }
  const empty = tab === 'whisper' ? 'Choose a neighbour above, or use /w "Name" message.' : tab === 'table' ? tableId ? 'Only neighbours at this table receive table messages.' : 'Open a casino table nearby to join its chat.' : 'A simple hello goes a long way.';
  return <section className={`chat-panel chat-qol${options.tall ? ' chat-tall' : ''}`} style={{ '--chat-font': `${options.font}px` } as React.CSSProperties} aria-label="Town chat" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="chat-title"><span className="live-dot"/><span className="chat-title-label">CHAT</span>
      <span className="chat-identity"><span className="identity-dot" aria-hidden="true" style={{ background: colour }}/><b>{name}</b></span>
      <span className="chat-population">{population} in town</span>
      <div className="chat-tools">
        <button type="button" className="chat-desktop-tool" aria-label="Change chat text size" title={`Chat text: ${options.font}px`} onClick={() => setOptions(p => ({ ...p, font: p.font === 18 ? 14 : p.font + 2 }))}>A<span aria-hidden="true">a</span></button>
        <button type="button" className="chat-desktop-tool" aria-label={options.tall ? 'Reduce chat height' : 'Expand chat height'} aria-pressed={options.tall} title="Resize chat" onClick={() => setOptions(p => ({ ...p, tall: !p.tall }))}>{options.tall ? '↙' : '↗'}</button>
        <button type="button" aria-label="Chat help" onClick={onHelp}>?</button>
        <button type="button" className="chat-close" aria-label="Close town chat" onClick={onClose}>×</button>
      </div>
    </div>
    <div className="chat-tabs" role="group" aria-label="Chat channels">
      {(['all', 'town', 'table', 'whisper'] as const).map(channel => <button key={channel} type="button" aria-pressed={tab === channel} onClick={() => onTab(channel)}>{channel === 'whisper' ? 'Whispers' : channel[0].toUpperCase() + channel.slice(1)}{unread[channel] > 0 && <span className="chat-badge" aria-label={`${unread[channel]} unread`}>{unread[channel] > 99 ? '99+' : unread[channel]}</span>}</button>)}
    </div>

    <div className="chat-scroll-area">
      <div ref={history} className="chat-history" role="log" aria-label="Chat messages" aria-live="polite" tabIndex={0} onScroll={() => {
        const node = history.current!; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24; setAtBottom(following.current);
      }}>
        {lines.length === 0 && <p className="chat-empty">{empty}</p>}
        {lines.map(line => <p className={isSystemLine(line) ? 'chat-system' : `chat-line chat-${line.channel}`} key={line.id}>
          <time dateTime={new Date(line.sentAt).toISOString()} title={new Date(line.sentAt).toLocaleString()}>[{timeFormat.format(line.sentAt)}]</time>{' '}
          {isSystemLine(line) ? <><span className="chat-channel-tag">[System]</span> {line.body}</> : <>
            <span className="chat-channel-tag">[{line.channel === 'table' ? CASINO_ANCHORS.find(table => table.id === line.tableId)?.name || 'Table' : line.channel === 'whisper' ? line.profileId === profileId ? 'To' : 'From' : 'Town'}]</span>{' '}
            {(() => { const person = line.channel === 'whisper' && line.profileId === profileId ? { profileId: line.toProfileId!, name: line.toName! } : { profileId: line.profileId, name: line.name }; return person.profileId === profileId ? <strong>{person.name}:</strong> : <button type="button" className="chat-speaker" title={line.channel === 'whisper' ? `Reply to ${person.name}` : `View ${person.name}`} onClick={() => line.channel === 'whisper' ? onTarget(person) : onInspect(person)}>{person.name}:</button>; })()}{' '}
            <span>{line.body}</span>
          </>}
        </p>)}
      </div>
      {!atBottom && <button type="button" className="chat-latest" onClick={latest}>{unread[tab] ? `${unread[tab]} new · ` : ''}Jump to latest ↓</button>}
    </div>
    {silenced && <p className="chat-silenced" role="status">Silenced · {silencedSeconds}s</p>}
    <form onSubmit={submit}>
      <label className={`chat-destination${tab === 'whisper' ? ' is-repeated' : ''}`} htmlFor="chat-message">{destination}</label>
    {tab === 'whisper' && <label className="chat-recipient">To <select aria-label="Whisper recipient" value={target?.profileId || ''} onFocus={onFocus} onBlur={onBlur} onChange={event => onTarget(people.find(person => person.profileId === event.target.value) || null)}><option value="">Choose a neighbour…</option>{target && !people.some(person => person.profileId === target.profileId) && <option value={target.profileId}>{target.name} · unavailable</option>}{people.map(person => <option key={person.profileId} value={person.profileId}>{person.name}</option>)}</select></label>}
      <div className="chat-compose-row"><input id="chat-message" ref={inputRef} aria-label={tab === 'whisper' ? 'Whisper message' : tab === 'table' ? 'Message to table' : 'Message to town'} placeholder={silenced ? 'Silenced for a moment…' : unavailable ? 'Choose an available destination…' : 'Say something…'} disabled={unavailable} value={message} maxLength={320} onFocus={onFocus} onBlur={onBlur} onChange={event => { draftIndex.current = -1; onChange(event.target.value); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowUp' && (draftIndex.current >= 0 || event.currentTarget.selectionStart === 0)) {
          event.preventDefault(); if (draftIndex.current === -1) draftBeforeHistory.current = message;
          draftIndex.current = Math.min(sentDrafts.current.length - 1, draftIndex.current + 1); if (draftIndex.current >= 0) onChange(sentDrafts.current[draftIndex.current]);
        } else if (event.key === 'ArrowDown' && draftIndex.current >= 0) { event.preventDefault(); draftIndex.current--; onChange(draftIndex.current < 0 ? draftBeforeHistory.current : sentDrafts.current[draftIndex.current]); }
      }}/><button aria-label="Send message" onMouseDown={event => event.preventDefault()} disabled={!message.trim() || unavailable}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></div>
    </form>
  </section>;
}
