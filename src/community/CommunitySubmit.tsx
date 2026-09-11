import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { COMMUNITY_LIMITS, type CommunitySubmission } from '../../shared/community';
import { communityError, communityRequest } from './api';

export function CommunitySubmit({ available, admin = false, onSubmitted }: { available: boolean; admin?: boolean; onSubmitted?(): void }) {
 const [title, setTitle] = useState(''), [credit, setCredit] = useState(''), [preview, setPreview] = useState('');
 const [fileName, setFileName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
 const [submissions, setSubmissions] = useState<CommunitySubmission[]>([]), [listError, setListError] = useState('');
 const refresh = useCallback(async () => {
  if (!available || admin) return;
  try { const data = await communityRequest<{ submissions: CommunitySubmission[] }>('/submissions'); setSubmissions(data.submissions); setListError(''); } catch (cause) { setListError(communityError(cause)); }
 }, [available, admin]);
 useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15_000); return () => clearInterval(timer); }, [refresh]);
 const choose = async (file: File | undefined) => {
  setError(''); setNotice(''); setPreview(''); setFileName('');
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a still JPEG, PNG or WebP image.'); return; }
  if (file.size > COMMUNITY_LIMITS.inputBytes) { setError('This image is too large. Choose a file smaller than 4 MiB.'); return; }
  try {
   const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('This file could not be read. Please select it again.')); reader.readAsDataURL(file); });
   setPreview(data); setFileName(file.name);
  } catch (cause) { setError(communityError(cause)); }
 };
 const submit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault(); if (!preview || busy) return;
  setBusy(true); setError(''); setNotice('');
  try {
   await communityRequest<CommunitySubmission>('/submissions', { method: 'POST', body: JSON.stringify({ title: title.trim(), credit: credit.trim(), imageBase64: preview.slice(preview.indexOf(',') + 1) }) });
   setNotice(admin ? 'Image added to the private review queue. Approve it when it is ready to show.' : 'Sent to Tom. Your image stays private until it is approved.');
   setTitle(''); setPreview(''); setFileName(''); await refresh(); onSubmitted?.();
  } catch (cause) { setError(communityError(cause)); }
  finally { setBusy(false); }
 };
 if (!available) return <div className="community-empty"><h3>Make yourself at home first.</h3><p>Join the square with your guest name, then come back to share a memory.</p></div>;
 return <div className="community-submit-layout"><section><div className="community-section-heading"><span className="community-kicker">{admin ? 'A NOTE FROM THE PICTURE HOUSE' : 'FOR TOM’S PRIVATE REVIEW QUEUE'}</span><h3>{admin ? 'Add a still or promo.' : 'Made a memory?'}</h3><p>{admin ? 'Upload a still image, then approve it in the queue below.' : 'Share a meme, a screenshot or a little piece of town life. Tom reviews everything before it appears on the board and cinema screen.'}</p></div>
  <form className="community-form" onSubmit={event => void submit(event)} aria-label={admin ? 'Upload a promo' : 'Submit a community image'}>
   <label className="community-upload"><span>Choose your image</span><input type="file" aria-label="Community image" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }}/><small>Still JPEG, PNG or WebP · up to 4 MiB · 12 megapixels</small></label>
   {preview && <figure className="community-upload-preview"><img src={preview} alt="Your submission preview"/><figcaption>{fileName}</figcaption></figure>}
   <label>Title<input required maxLength={100} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="Give this memory a name"/></label>
   <label>Creator credit <span className="community-optional">(optional)</span><input maxLength={80} value={credit} disabled={busy} onChange={event => setCredit(event.target.value)} placeholder="How should we credit you?"/></label>
   <p className="community-help">Only share images you have permission to use. Approved images are visible to everyone in Slop City.</p>
   {error && <p className="community-error" role="alert">{error}</p>}{notice && <p className="community-notice" role="status">{notice}</p>}
   <button className="community-button" type="submit" disabled={busy || !preview || !title.trim()}>{busy ? 'Sending image…' : error && preview ? 'Try sending again' : 'Send for review ↗'}</button>
  </form>
 </section>{!admin && <section className="community-submissions"><span className="community-kicker">JUST BETWEEN YOU AND TOM</span><h3>Your submissions</h3><p>Status follows your saved guest in this browser.</p>{listError && <p className="community-error" role="alert">{listError} <button type="button" onClick={() => void refresh()}>Retry</button></p>}{!submissions.length && !listError && <p className="community-empty-note">Nothing pinned yet. Your first submission will appear here.</p>}<ul>{submissions.map(submission => <li key={submission.id}><img src={submission.imageUrl} alt={submission.title}/><div><strong>{submission.title}</strong><span className={`community-status status-${submission.status}`}>{submission.status === 'pending' ? 'Waiting for review' : submission.status === 'approved' ? 'On the board' : 'Not approved'}</span><small>{new Date(submission.createdAt).toLocaleDateString()}</small></div></li>)}</ul></section>}</div>;
}
