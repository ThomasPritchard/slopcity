import { useEffect, useRef, useState } from 'react';
import { BRIDGEMIND_TWITCH_CHANNEL, communitySlide, type Programme, type ScheduleEntry } from '../../shared/community';
import { CommunityDialog } from './CommunityDialog';

export function Schedule({ entries, nowMs = Date.now() }: { entries: ScheduleEntry[]; nowMs?: number }) {
 entries = entries.filter(entry => Date.parse(entry.startsAt) >= nowMs).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
 return <section className="community-schedule" aria-label="Cinema schedule"><span className="community-kicker">COMING UP AT THE PICTURE HOUSE</span>{entries.length ? <ol>{entries.map(entry => <li key={entry.id}><div><strong>{entry.title}</strong><span>{entry.platform === 'twitch' ? 'Twitch' : 'YouTube'}</span></div><time dateTime={entry.startsAt}>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(entry.startsAt))}</time></li>)}</ol> : <p>The next stream is to be announced.<br/>In the meantime, enjoy the community reel.</p>}</section>;
}

function source(programme: Programme) {
 if (programme.platform === 'twitch' && programme.twitchChannel === BRIDGEMIND_TWITCH_CHANNEL) return { name: 'Twitch', url: `https://www.twitch.tv/${programme.twitchChannel}`, embed: `https://player.twitch.tv/?channel=${encodeURIComponent(programme.twitchChannel)}&parent=${encodeURIComponent(location.hostname)}&autoplay=true&muted=true` };
 if (programme.platform === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(programme.youtubeVideoId)) return { name: 'YouTube', url: `https://www.youtube.com/watch?v=${programme.youtubeVideoId}`, embed: `https://www.youtube.com/embed/${programme.youtubeVideoId}?autoplay=1&mute=1&controls=1&playsinline=1` };
 return null;
}

export function CommunityWatch({ programme, onClose }: { programme: Programme; onClose(): void }) {
 const container = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 }), [failed, setFailed] = useState(false);
 const provider = source(programme);
 useEffect(() => { const node = container.current!; const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(node); return () => observer.disconnect(); }, []);
 const fits = programme.platform === 'twitch' ? size.width >= 400 && size.height >= 300 : size.width >= 200 && size.height >= 200;
 return <CommunityDialog title="Watch at The Bridge Picture House" className="community-watch" onClose={onClose}>
  <header className="community-watch-header"><h3>The Bridge Picture House</h3><button type="button" autoFocus aria-label="Close player" onClick={onClose}>×</button></header>
  <div className="community-player-space" ref={container}>
   {provider && fits && !failed ? <iframe title={`${provider.name} live player`} src={provider.embed} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(true)}/> : <div className="community-player-fallback"><span className="community-kicker">THE BRIDGE PICTURE HOUSE</span><h3>{failed ? 'The player could not load.' : provider ? 'A little more room for the show.' : 'The stream is not available.'}</h3><p>{provider && !failed ? `Rotate your phone to watch here, or open ${provider.name}.` : 'You can close this player and try again.'}</p>{provider && <a className="community-button" href={provider.url} target="_blank" rel="noopener noreferrer">Open on {provider.name} ↗</a>}</div>}
  </div>
  <footer className="community-watch-footer"><span>Starts muted · use the player’s sound controls.</span>{provider && <a href={provider.url} target="_blank" rel="noopener noreferrer">Open on {provider.name} ↗</a>}</footer>
 </CommunityDialog>;
}

export function CommunityCinema({ programme, serverTimeMs }: { programme: Programme | null; serverTimeMs: number }) {
 const [watching, setWatching] = useState(false);
 const key = programme ? `${programme.mode}:${programme.platform}:${programme.twitchChannel}:${programme.youtubeVideoId}` : '';
 useEffect(() => setWatching(false), [key]);
 const slide = programme ? communitySlide(programme, serverTimeMs) : null;
 return <div className="community-cinema"><div className="community-cinema-title"><span className="community-kicker">THE WESTERN GARDEN · SLOP CITY</span><h3>The Bridge<br/><em>Picture House</em></h3><p>A shared screen. A familiar crowd.</p></div>
  <div className="community-reel" aria-label="Current cinema programme">{programme?.mode === 'live' ? <div className="community-live-invitation"><span className="community-kicker">NOW SHOWING · {programme.platform.toUpperCase()}</span><h4>BridgeMind,<br/>together in the garden.</h4><p>Pull up a seat. Open the player when you’re ready.</p><button type="button" className="community-button" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setWatching(true); }} disabled={!source(programme)}>Watch together ↗</button></div> : slide?.kind === 'image' ? <figure><img src={slide.image.imageUrl} alt={slide.image.title}/><figcaption><span>{slide.image.title}</span>{slide.image.credit && <span>By {slide.image.credit}</span>}</figcaption></figure> : <Schedule entries={programme?.schedule ?? []} nowMs={serverTimeMs}/>}</div>
  <div className="community-cinema-bottom"><p><span className="community-kicker">{programme?.mode === 'live' ? 'LIVE PROGRAMME' : 'INTERMISSION'}</span><br/>{programme?.mode === 'live' ? 'Your player controls and sound stay yours.' : 'Memes, memories and notes from the neighbourhood.'}</p><Schedule entries={programme?.schedule ?? []} nowMs={serverTimeMs}/></div>
  {watching && programme?.mode === 'live' && <CommunityWatch programme={programme} onClose={() => setWatching(false)}/>}
 </div>;
}
