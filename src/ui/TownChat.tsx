import { useEffect, useRef, type FormEvent, type RefObject } from 'react';
import './town-chat.css';

export type ChatLine = { id: string; system?: boolean; profileId?: string; name?: string; body: string };
type Props = {
  messages: ChatLine[]; message: string; name: string; colour: string; population: number;
  silenced: boolean; silencedSeconds: number; inputRef: RefObject<HTMLInputElement | null>;
  onChange(value: string): void; onSubmit(event: FormEvent): void;
  onFocus(): void; onBlur(): void; onClose(): void;
};
export function TownChat({ messages, message, name, colour, population, silenced, silencedSeconds, inputRef, onChange, onSubmit, onFocus, onBlur, onClose }: Props) {
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [messages]);
  return <section className="chat-panel" aria-label="Town chat" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="chat-title"><span className="live-dot"/><span className="chat-title-label">TOWN CHAT</span>
      {silenced && <i className="chat-silenced">Silenced · {silencedSeconds}s</i>}
      <span className="chat-identity"><span className="identity-dot" aria-hidden="true" style={{ background: colour }}/><b>{name}</b><small>NEW NEIGHBOUR</small><span className="identity-status">IN TOWN</span></span>
      <span className="chat-population">{population} in town</span><button type="button" className="chat-close" aria-label="Close town chat" onClick={onClose}>×</button>
    </div>
    <div ref={history} className="chat-history" role="log" aria-live="polite">
      {messages.length === 0 && <p className="chat-empty">A simple hello goes a long way.</p>}
      {messages.map((line,index) => line.system ? <p className="chat-system" key={`${line.id}:${index}`}>[SYSTEM] {line.body}</p> : <p key={`${line.id}:${index}`}><strong>{line.name}</strong> {line.body}</p>)}
    </div>
    <form onSubmit={onSubmit}><input ref={inputRef} aria-label="Message to town" placeholder={silenced ? 'Silenced for a moment…' : 'Say something…'} disabled={silenced} value={message} maxLength={240} onFocus={onFocus} onBlur={onBlur} onChange={event => onChange(event.target.value)}/><button aria-label="Send message" onMouseDown={event => event.preventDefault()} disabled={!message.trim() || silenced}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></form>
  </section>;
}
