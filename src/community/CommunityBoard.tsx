import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { communityImages, type CommunityImage } from '../../shared/community';
import { FIRST_MEMORY } from '../../shared/memories';
import { CommunityDialog } from './CommunityDialog';

export function CommunityPhoto({ image, onClose, backLabel = 'Back to board' }: { image: CommunityImage; onClose(): void; backLabel?: string }) {
 const [zoom, setZoom] = useState(1);
 return <CommunityDialog title={image.title} className="community-photo-dialog" onClose={onClose}>
  <header className="community-photo-header"><button type="button" autoFocus onClick={onClose}>← {backLabel}</button><span>THE WHOLE PICTURE</span><button type="button" aria-label="Close photo" onClick={onClose}>×</button></header>
  <div className="community-photo-scroll" tabIndex={0} aria-label="Full image. Scroll to explore when zoomed.">
   <img src={image.imageUrl} alt={image.id === 'first-memory' ? FIRST_MEMORY.alt : image.title} width={image.width} height={image.height} style={{ '--photo-zoom': zoom } as CSSProperties}/>
  </div>
  <footer className="community-photo-footer"><div><h3>{image.title}</h3>{image.credit && <p>By {image.credit}</p>}</div><div className="community-zoom"><button type="button" disabled={zoom <= 1} aria-label="Zoom photo out" onClick={() => setZoom(value => Math.max(1, value - .5))}>−</button><output aria-label="Photo zoom">{Math.round(zoom * 100)}%</output><button type="button" disabled={zoom >= 3} aria-label="Zoom photo in" onClick={() => setZoom(value => Math.min(3, value + .5))}>+</button></div></footer>
 </CommunityDialog>;
}

export function CommunityBoard({ images, onSubmit }: { images: CommunityImage[]; onSubmit(): void }) {
 const [selected, setSelected] = useState<CommunityImage | null>(null), [zoom, setZoom] = useState(1);
 const viewport = useRef<HTMLDivElement>(null);
 const photos = communityImages(images);
 useEffect(() => {
  const node = viewport.current!;
  const wheel = (event: WheelEvent) => { if (event.ctrlKey) { event.preventDefault(); setZoom(value => Math.max(1, Math.min(2, value + (event.deltaY < 0 ? .1 : -.1)))); } };
  node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
 }, []);
 return <>
  <div className="community-board-intro"><div><p className="community-kicker">SMALL TOWN. GOOD STORIES.</p><h3>A little piece of Slop City.</h3><p>Take a closer look. Every photo opens in full.</p></div><div className="community-zoom"><button type="button" aria-label="Zoom board out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .25))}>−</button><output aria-label="Board zoom">{Math.round(zoom * 100)}%</output><button type="button" aria-label="Zoom board in" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}>+</button></div></div>
  <div ref={viewport} className="community-board-scroll" tabIndex={0} aria-label="Memories board. Use zoom controls to enlarge photos.">
   <div className={`community-polaroids${photos.length === 1 ? ' is-first-memory' : ''}`} style={{ '--board-zoom': zoom } as CSSProperties}>
    {photos.map((photo, index) => <button type="button" key={photo.id} className="community-polaroid" style={{ '--photo-angle': `${[-2, 1.5, -.8, 2.2][index % 4]}deg` } as CSSProperties} aria-label={`Open photo: ${photo.title}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); setSelected(photo); }}><span className="community-tape" aria-hidden="true"/><span className="community-polaroid-image"><img src={photo.imageUrl} width={photo.width} height={photo.height} alt={photo.id === 'first-memory' ? FIRST_MEMORY.alt : ''} loading="lazy"/></span><span className="community-polaroid-caption"><strong>{photo.title}</strong><small>{photo.credit ? `By ${photo.credit}` : photo.id === 'first-memory' ? 'Our first player-made meme' : 'From the neighbourhood'}</small></span>{photo.featured && <span className="community-featured">★ Featured</span>}</button>)}
    {photos.length === 1 && <div className="community-board-note"><span className="community-kicker">THE FIRST OF MANY</span><h3>Already making<br/>memories.</h3><p>{FIRST_MEMORY.message}</p><p className="community-handwritten">{FIRST_MEMORY.invitation}</p><button type="button" className="community-button" onClick={onSubmit}>Pin your next memory ↗</button></div>}
   </div>
  </div>
  {selected && photos.some(image => image.id === selected.id) && <CommunityPhoto image={photos.find(image => image.id === selected.id)!} onClose={() => setSelected(null)}/>}
 </>;
}
