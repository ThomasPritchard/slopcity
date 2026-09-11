import { useEffect, useState } from 'react';
import { CommunityDialog } from './CommunityDialog';
import { CommunityBoard } from './CommunityBoard';
import { CommunityCinema } from './CommunityCinema';
import { CommunitySubmit } from './CommunitySubmit';
import { CommunityAdmin } from './CommunityAdmin';
import { useCommunity } from './useCommunity';
import './community.css';

export type CommunityView = 'board' | 'cinema' | 'submit' | 'admin';
export function CommunityPanel({ initialView = 'board', onClose, guestAvailable, onViewChange }: { initialView?: CommunityView; onClose(): void; guestAvailable: boolean; onViewChange?(view: CommunityView): void }) {
 const [view, setView] = useState<CommunityView>(initialView);
 useEffect(() => { onViewChange?.(view); }, [view, onViewChange]);
 const community = useCommunity();
 return <CommunityDialog title={view === 'cinema' ? 'The Bridge Picture House' : view === 'admin' ? 'Community review desk' : 'Slop City memories'} onClose={onClose}>
  <header className="community-header"><div><span className="community-kicker">OUR LITTLE CORNER OF TOWN</span><h2>{view === 'cinema' ? 'The Picture House' : view === 'admin' ? 'The review desk' : 'Slop City memories'}</h2></div><button type="button" autoFocus className="community-close" aria-label="Close community" onClick={onClose}>×</button></header>
  <nav className="community-nav" aria-label="Community"><button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Memories board</button><button type="button" aria-pressed={view === 'cinema'} onClick={() => setView('cinema')}>Picture house</button><button type="button" aria-pressed={view === 'submit'} onClick={() => setView('submit')}>Share a memory</button></nav>
  <div className="community-content">
   {community.error && view !== 'admin' && <div className="community-refresh" role="status"><span>{community.error}{community.programme ? ' Showing the last programme for up to one minute.' : ''}</span><button type="button" disabled={community.loading} onClick={community.refresh}>Refresh</button></div>}
   {community.loading && !community.programme && view !== 'admin' && <p className="community-loading" role="status">Opening the community board…</p>}
   {view === 'board' && <CommunityBoard images={community.programme?.images ?? []} onSubmit={() => setView('submit')}/>}
   {view === 'cinema' && <CommunityCinema programme={community.programme} serverTimeMs={community.serverTimeMs}/>}
   {view === 'submit' && <CommunitySubmit available={guestAvailable}/>}
   {view === 'admin' && <CommunityAdmin onChanged={community.refresh}/>}
  </div>
  <footer className="community-footer"><span>Made by the neighbourhood. Reviewed by Tom.</span><button type="button" aria-pressed={view === 'admin'} onClick={() => setView('admin')}>Tom’s review desk ↗</button></footer>
 </CommunityDialog>;
}
