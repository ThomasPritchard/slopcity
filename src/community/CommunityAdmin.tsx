import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BRIDGEMIND_TWITCH_CHANNEL, type CommunitySubmission, type Programme, type ProgrammeSettings, type ScheduleEntry } from '../../shared/community';
import { CommunityApiError, communityError, communityRequest } from './api';
import { CommunitySubmit } from './CommunitySubmit';
import { CommunityPhoto } from './CommunityBoard';
import { CommunityCinema } from './CommunityCinema';
import { TownSafety } from '../admin/TownSafety';

type AdminData = { images: CommunitySubmission[]; programme: Programme; configured: boolean };
type AdminTab = 'queue' | 'programme' | 'upload' | 'preview' | 'safety';

function ProgrammeEditor({ programme, onSaved }: { programme: Programme; onSaved(): void }) {
 const [settings, setSettings] = useState<ProgrammeSettings>(() => ({ mode: programme.mode, platform: programme.platform, twitchChannel: programme.twitchChannel, youtubeVideoId: programme.youtubeVideoId, schedule: programme.schedule }));
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
 const field = <K extends keyof ProgrammeSettings>(key: K, value: ProgrammeSettings[K]) => { setSettings(current => ({ ...current, [key]: value })); setNotice(''); };
 const updateSchedule = (id: string, value: Partial<ScheduleEntry>) => field('schedule', settings.schedule.map(entry => entry.id === id ? { ...entry, ...value } : entry));
 const save = async (event: FormEvent) => {
  event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
  try { await communityRequest<Programme>('/admin/programme', { method: 'PUT', body: JSON.stringify({ ...settings, expectedRevision: programme.revision }) }); setNotice('Programme saved for the whole town.'); onSaved(); }
  catch (cause) { setError(communityError(cause)); }
  finally { setBusy(false); }
 };
 return <form className="community-form community-programme-form" onSubmit={event => void save(event)} aria-label="Edit cinema programme"><div className="community-section-heading"><span className="community-kicker">THE SHARED SCREEN</span><h3>Tonight’s programme</h3><p>Choose what the town sees. Saving starts the community reel from the beginning.</p></div><fieldset disabled={busy}>
  <div className="community-form-row"><label>Screen mode<select aria-label="Screen mode" value={settings.mode} onChange={event => field('mode', event.target.value as Programme['mode'])}><option value="intermission">Intermission · community reel</option><option value="live">Live · invitation to watch</option></select></label><label>Live platform<select aria-label="Live platform" value={settings.platform} onChange={event => field('platform', event.target.value as Programme['platform'])}><option value="twitch">Twitch</option><option value="youtube">YouTube</option></select></label></div>
  <div className="community-form-row"><label>BridgeMind Twitch channel<input value={BRIDGEMIND_TWITCH_CHANNEL} readOnly/></label><label>BridgeMind YouTube video ID<input value={settings.youtubeVideoId} maxLength={11} pattern={'[a-zA-Z0-9_\\-]{11}'} placeholder="11-character video ID" onChange={event => field('youtubeVideoId', event.target.value)}/></label></div>
  <div className="community-schedule-editor"><div className="community-section-heading"><h4>Schedule</h4><p>Enter every time in UTC. Viewers see their local time and timezone.</p></div>{settings.schedule.map((entry, index) => <div className="community-schedule-row" key={entry.id}><label>Event {index + 1}<input required maxLength={100} value={entry.title} onChange={event => updateSchedule(entry.id, { title: event.target.value })}/></label><label>Starts at (UTC)<input required type="datetime-local" value={entry.startsAt.slice(0, 16)} onChange={event => updateSchedule(entry.id, { startsAt: event.target.value ? `${event.target.value}:00.000Z` : '' })}/></label><label>Platform<select aria-label="Event platform" value={entry.platform} onChange={event => updateSchedule(entry.id, { platform: event.target.value as ScheduleEntry['platform'] })}><option value="twitch">Twitch</option><option value="youtube">YouTube</option></select></label><button type="button" aria-label={`Remove event ${index + 1}`} onClick={() => field('schedule', settings.schedule.filter(item => item.id !== entry.id))}>Remove</button></div>)}<button type="button" className="community-secondary" disabled={settings.schedule.length >= 20} onClick={() => field('schedule', [...settings.schedule, { id: crypto.randomUUID(), title: '', startsAt: '', platform: settings.platform }])}>+ Add a scheduled stream</button></div>
 </fieldset>{error && <p role="alert" className="community-error">{error} <button type="button" onClick={onSaved}>Reload saved programme</button></p>}{notice && <p role="status" className="community-notice">{notice}</p>}<button className="community-button" disabled={busy} type="submit">{busy ? 'Saving programme…' : 'Save programme'}</button></form>;
}

function ReviewImage({ image, onUpdated }: { image: CommunitySubmission; onUpdated(): void }) {
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(false), [confirmRemove, setConfirmRemove] = useState(false), [order, setOrder] = useState(String(image.sortOrder));
 const change = async (patch: { status?: 'approved' | 'rejected'; featured?: boolean; sortOrder?: number } | null) => {
  setBusy(true); setError('');
  try { await communityRequest(`/admin/images/${encodeURIComponent(image.id)}`, patch ? { method: 'PATCH', body: JSON.stringify(patch) } : { method: 'DELETE' }); onUpdated(); }
  catch (cause) { setError(communityError(cause)); }
  finally { setBusy(false); }
 };
 return <article className="community-review-image"><button className="community-review-preview" type="button" aria-label={`Preview submission: ${image.title}`} onClick={event => { event.currentTarget.focus(); setPreview(true); }}><img src={image.imageUrl} alt={image.title}/><span>View full image ↗</span></button><div><span className={`community-status status-${image.status}`}>{image.status}</span><h4>{image.title}</h4>{image.credit && <p>By {image.credit}</p>}<small>{new Date(image.createdAt).toLocaleString()}</small><div className="community-review-actions"><button type="button" className="community-button" disabled={busy || image.status === 'approved'} onClick={() => void change({ status: 'approved' })}>Approve</button><button type="button" className="community-secondary" disabled={busy || image.status === 'rejected'} onClick={() => void change({ status: 'rejected' })}>Reject</button><button type="button" className="community-secondary" aria-pressed={image.featured} disabled={busy} onClick={() => void change({ featured: !image.featured })}>{image.featured ? '★ Featured' : '☆ Feature'}</button></div><div className="community-order-row"><label>Display order<input type="number" min="0" max="10000" value={order} disabled={busy} onChange={event => setOrder(event.target.value)}/></label><button type="button" className="community-secondary" disabled={busy || order === '' || !Number.isInteger(Number(order)) || Number(order) < 0 || Number(order) > 10000 || Number(order) === image.sortOrder} onClick={() => void change({ sortOrder: Number(order) })}>Set order</button><button type="button" className="community-text-button" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button></div>{confirmRemove && <div className="community-remove-confirm"><p>Remove this image and its submission permanently?</p><button type="button" disabled={busy} onClick={() => void change(null)}>Remove image</button><button type="button" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep image</button></div>}{busy && <p role="status">Saving…</p>}{error && <p className="community-error" role="alert">{error}</p>}</div>{preview && <CommunityPhoto image={image} backLabel="Back to review" onClose={() => setPreview(false)}/>}</article>;
}

export function CommunityAdmin({ onChanged, initialTab = 'queue' }: { onChanged(): void; initialTab?: AdminTab }) {
 const [data, setData] = useState<AdminData | null>(null), [password, setPassword] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
 const [tab, setTab] = useState<AdminTab>(initialTab), [filter, setFilter] = useState('pending');
 const adminRequest = useRef<AbortController | null>(null);
 const sessionExpired = useCallback(() => {
  adminRequest.current?.abort(); setData(null); setPassword(''); setLoading(false);
  setError('Your admin session expired. Sign in again to refresh private activity.');
 }, []);
 const refresh = useCallback(async () => {
  adminRequest.current?.abort(); const controller = new AbortController(); adminRequest.current = controller;
  try { const value = await communityRequest<AdminData>('/admin', { signal: controller.signal }); if (!controller.signal.aborted) { setData(value); setError(''); } }
  catch (cause) { if (controller.signal.aborted) return; if (cause instanceof CommunityApiError && cause.status === 401) { setData(null); setError(cause.configured === false ? 'The review desk is not configured yet. Set the server admin password before signing in.' : ''); } else setError(communityError(cause)); }
  finally { if (!controller.signal.aborted) setLoading(false); }
 }, []);
 useEffect(() => { void refresh(); return () => adminRequest.current?.abort(); }, [refresh]);
 const changed = () => { void refresh(); onChanged(); };
 const login = async (event: FormEvent) => {
  event.preventDefault(); setBusy(true); setError('');
  try { await communityRequest('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); await refresh(); }
  catch (cause) { setError(communityError(cause)); }
  finally { setBusy(false); }
 };
 const logout = async () => { setBusy(true); adminRequest.current?.abort(); try { await communityRequest('/admin/logout', { method: 'POST' }); setData(null); setError(''); } catch (cause) { if (cause instanceof CommunityApiError && cause.status === 401) sessionExpired(); else setError(communityError(cause)); } finally { setBusy(false); } };
 if (loading) return <p className="community-empty" role="status">Opening the private review desk…</p>;
 if (!data) return <div className="community-admin-login"><span className="community-kicker">SLOP CITY · PRIVATE DESK</span><h3>Hello, Tom.</h3><p>Sign in to manage town safety, review the queue and set the programme.</p><form className="community-form" onSubmit={event => void login(event)}><label>Admin password<input type="password" required value={password} autoComplete="current-password" onChange={event => setPassword(event.target.value)} disabled={busy}/></label>{error && <p className="community-error" role="alert">{error}</p>}<button className="community-button" type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Open the review desk'}</button></form></div>;
 const images = data.images.filter(image => filter === 'all' || image.status === filter);
 return <div className="community-admin"><div className="community-admin-toolbar"><nav aria-label="Review desk"><button type="button" aria-pressed={tab === 'queue'} onClick={() => setTab('queue')}>Review queue <span>{data.images.filter(image => image.status === 'pending').length}</span></button><button type="button" aria-pressed={tab === 'programme'} onClick={() => setTab('programme')}>Programme</button><button type="button" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>Upload promo</button><button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Display preview</button><button type="button" aria-pressed={tab === 'safety'} onClick={() => setTab('safety')}>Town safety</button></nav><button type="button" className="community-text-button" disabled={busy} onClick={() => void logout()}>Sign out</button></div>{error && <p className="community-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Refresh</button></p>}
  {tab === 'queue' && <><div className="community-review-heading"><div><h3>From the neighbourhood</h3><p>Approved images join the board and the cinema reel. Lower display order goes first.</p></div><label className="community-filter">Show<select aria-label="Show" value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">Waiting for review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All submissions</option></select></label></div>{images.length ? images.map(image => <ReviewImage key={`${image.id}:${image.status}:${image.featured}:${image.sortOrder}`} image={image} onUpdated={changed}/>) : <p className="community-empty-note">No {filter === 'all' ? '' : filter} submissions here.</p>}<p className="community-help">The original first memory stays permanently on the board.</p></>}
  {tab === 'programme' && <ProgrammeEditor key={data.programme.revision} programme={data.programme} onSaved={changed}/>}
  {tab === 'upload' && <CommunitySubmit available admin onSubmitted={changed}/>}
  {tab === 'preview' && <><p className="community-preview-note">Public display preview · the saved programme</p><CommunityCinema programme={data.programme} serverTimeMs={data.programme.serverNowMs}/></>}
  {tab === 'safety' && <TownSafety onSessionExpired={sessionExpired}/>}
 </div>;
}
