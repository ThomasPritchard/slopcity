import { useEffect } from 'react';
import { CommunityAdmin } from '../community/CommunityAdmin';
import '../community/community.css';
import './town-safety.css';

const noChange = () => {};

export function AdminPage() {
 useEffect(() => {
  document.getElementById('startup')?.remove();
  const previous = document.title;
  document.title = 'Town administration · Slop City';
  return () => { document.title = previous; };
 }, []);
 return <div className="town-admin-page">
  <a className="town-admin-skip" href="#town-admin-content">Skip to administration</a>
  <header className="town-admin-header"><div><span className="community-kicker">SLOP CITY · PRIVATE DESK</span><h1>Town administration</h1><p>Community, cinema and town safety.</p></div><a className="community-secondary town-admin-return" href="/">← Return to town</a></header>
  <main id="town-admin-content" tabIndex={-1} className="town-admin-content"><CommunityAdmin initialTab="safety" onChanged={noChange}/></main>
  <footer className="town-admin-footer"><span>Slop City administration</span><a href="/">Return to town ↗</a></footer>
 </div>;
}
