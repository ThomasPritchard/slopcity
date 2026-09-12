import { useEffect, useRef } from 'react';
import { FIRST_MEMORY } from '../../shared/memories';
import './community.css';

export function CommunityNews({ onOpen }: { onOpen(): void }) {
 return <aside className="community-news" aria-labelledby="community-news-title">
  <div className="news-board-label">The notice board</div>
  <article className="news-post">
   <span className="news-pin" aria-hidden="true"/>
   <span className="news-tag">v0.1 · Now open</span>
   <h2 id="community-news-title">Welcome to Slop City!</h2>
   <button className="news-photo" aria-label="Open our first community memory" onClick={event => { event.currentTarget.focus({ preventScroll: true }); onOpen(); }}><img src={FIRST_MEMORY.image} width="1122" height="1402" alt={FIRST_MEMORY.alt}/><span>Our first player-made meme <b aria-hidden="true">↗</b></span></button>
   <p>We’ve barely opened the gates and someone’s already made a meme. Here’s to odd encounters and new friends.</p>
  </article>
 </aside>;
}

export function MemoryPostDialog({ onClose }: { onClose(): void }) {
 const dialog = useRef<HTMLDialogElement>(null);
 useEffect(() => {
  const node = dialog.current!, previous = document.activeElement; node.showModal();
  return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else document.getElementById('world')?.focus({ preventScroll: true }); };
 }, []);
 return <dialog ref={dialog} className="memory-dialog" aria-labelledby="memory-title" onCancel={event => { event.preventDefault(); onClose(); }}>
  <button autoFocus type="button" className="memory-close" aria-label="Close memory" onClick={onClose}>×</button>
  <div className="memory-photo"><img src={FIRST_MEMORY.image} width="1122" height="1402" alt={FIRST_MEMORY.alt}/></div>
  <div className="memory-story"><span className="eyebrow">SLOP CITY MEMORIES · 001</span><h2 id="memory-title">{FIRST_MEMORY.title}</h2><p>{FIRST_MEMORY.message}</p><p className="memory-signoff">{FIRST_MEMORY.invitation}</p></div>
 </dialog>;
}
