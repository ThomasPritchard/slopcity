import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { COMMUNITY_LIMITS, type CommunitySubmission } from '../../shared/community';
import type { VerificationConfig } from '../../shared/account';
import { SUBMISSION_PROTECTION, type SubmissionPauseReason } from '../../shared/submissionProtection';
import { useAccount } from '../account/AccountProvider';
import { AccountButton } from '../account/AccountButton';
import { useVerification } from '../account/useVerification';
import { communityError, communityRequest } from './api';

type UploadStatus = { eligible: boolean; challenge: VerificationConfig; paused: boolean; reasons: SubmissionPauseReason[]; pending: number; retryAt: number | null; cooldownUntil: number | null; trialUntil: number | null };
type UploadAttempt = { requestId: string; title: string; credit: string; imageBase64: string };

function pauseMessage(status: UploadStatus, admin: boolean): string {
 if (status.pending >= COMMUNITY_LIMITS.pendingGlobal) return `The review queue is full (${COMMUNITY_LIMITS.pendingGlobal} images). Images need to be reviewed before more can be sent.`;
 if (admin) return '';
 const messages: string[] = [];
 if (status.reasons.includes('manual')) messages.push('Tom has paused player submissions. Please check back later.');
 if (status.reasons.includes('backlog')) messages.push(`The review queue is busy. Submissions reopen when ${SUBMISSION_PROTECTION.backlogResume} or fewer images are waiting.`);
 if (status.reasons.includes('spam')) messages.push(`Submissions are paused while unusual upload activity settles.${status.retryAt ? ` The next check is at ${new Date(status.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}`);
 if (status.cooldownUntil && status.cooldownUntil > Date.now()) messages.push(`Uploads from your account or connection are taking a break. Try again after ${new Date(status.cooldownUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
 if (!messages.length && status.paused) messages.push('Player submissions are temporarily paused. Please check back shortly.');
 return messages.join(' ');
}

export function CommunitySubmit({ available, admin = false, onSubmitted }: { available: boolean; admin?: boolean; onSubmitted?(): void }) {
 const account = useAccount();
 const [title, setTitle] = useState(''), [credit, setCredit] = useState(''), [preview, setPreview] = useState('');
 const [fileName, setFileName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false);
 const [submissions, setSubmissions] = useState<CommunitySubmission[]>([]), [listError, setListError] = useState('');
 const [status, setStatus] = useState<UploadStatus | null>(null), [statusError, setStatusError] = useState('');
 const lastAttempt = useRef<UploadAttempt | null>(null), statusRequest = useRef(0), choiceRequest = useRef(0);
 const verification = useVerification('community_upload', status?.challenge ?? { enabled: true, siteKey: '' });
 const refreshStatus = useCallback(async () => {
  const request = ++statusRequest.current;
  try { const next = await communityRequest<UploadStatus>('/submission-status'); if (request === statusRequest.current) { setStatus(next); setStatusError(''); } }
  catch (cause) { if (request === statusRequest.current) { setStatus(null); setStatusError(communityError(cause)); } }
 }, []);
 const refreshHistory = useCallback(async () => {
  if (!available || admin) return;
  try { const data = await communityRequest<{ submissions: CommunitySubmission[] }>('/submissions'); setSubmissions(data.submissions); setListError(''); } catch (cause) { setListError(communityError(cause)); }
 }, [available, admin]);
 useEffect(() => { void refreshStatus(); const timer = setInterval(() => void refreshStatus(), 15_000); return () => { clearInterval(timer); statusRequest.current++; }; }, [refreshStatus, account.status?.kind]);
 useEffect(() => { void refreshHistory(); const timer = setInterval(() => void refreshHistory(), 15_000); return () => clearInterval(timer); }, [refreshHistory]);
 const choose = async (file: File | undefined) => {
  const request = ++choiceRequest.current;
  lastAttempt.current = null; setError(''); setNotice(''); setPreview(''); setFileName('');
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a still JPEG, PNG or WebP image.'); return; }
  if (file.size > COMMUNITY_LIMITS.inputBytes) { setError('This image is too large. Choose a file smaller than 4 MiB.'); return; }
  setChoosing(true);
  try {
   const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('This file could not be read. Please select it again.')); reader.readAsDataURL(file); });
   if (request === choiceRequest.current) { setPreview(data); setFileName(file.name); }
  } catch (cause) { if (request === choiceRequest.current) setError(communityError(cause)); }
  finally { if (request === choiceRequest.current) setChoosing(false); }
 };
 const paused = status ? pauseMessage(status, admin) : '';
 const blocked = !status?.eligible || Boolean(paused) || !status || (!admin && !available);
 const submit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault(); if (!preview || busy || choosing || blocked) return;
  setBusy(true); setError(''); setNotice('');
  try {
   const payload = { title: title.trim(), credit: credit.trim(), imageBase64: preview.slice(preview.indexOf(',') + 1) };
   const previous = lastAttempt.current;
   const attempt = previous && previous.title === payload.title && previous.credit === payload.credit && previous.imageBase64 === payload.imageBase64 ? previous : { ...payload, requestId: crypto.randomUUID() };
   lastAttempt.current = attempt;
   const turnstileToken = await verification.requestToken();
   await communityRequest<CommunitySubmission>('/submissions', { method: 'POST', body: JSON.stringify({ ...attempt, turnstileToken }) });
   lastAttempt.current = null;
   setNotice(admin ? 'Image added to the private review queue. Approve it when it is ready to show.' : 'Sent to Tom. Your image stays private until it is approved.');
   setTitle(''); setPreview(''); setFileName(''); await refreshHistory(); onSubmitted?.();
  } catch (cause) { setError(communityError(cause)); }
  finally { setBusy(false); void refreshStatus(); }
 };
 return <><div className="community-submit-layout"><section><div className="community-section-heading"><span className="community-kicker">{admin ? 'A NOTE FROM THE PICTURE HOUSE' : 'FOR TOM’S PRIVATE REVIEW QUEUE'}</span><h3>{admin ? 'Add a still or promo.' : 'Made a memory?'}</h3><p>{admin ? 'Upload a still image, then approve it in the review queue.' : 'Share a meme, a screenshot or a little piece of town life. Tom reviews everything before it appears on the board and cinema screen.'}</p></div>
  {!status && !statusError && <p className="submission-eligibility" role="status">Checking whether submissions are open…</p>}
  {statusError && <p className="community-error" role="alert">{statusError} <button type="button" onClick={() => void refreshStatus()}>Retry</button></p>}
  {status && !status.eligible && <div className="submission-eligibility"><h4>Save your account to share.</h4><p>Image submissions are open to players with a verified email account. {available ? 'Keep your guest’s credits, clothing and friends when you add an email.' : 'Join the town as a guest to get started, or sign in to your existing account.'}</p><AccountButton className="community-button">{available ? 'Save your progress or sign in' : 'Sign in'}</AccountButton></div>}
  {status?.eligible && <>
   {paused && <p className="community-notice submission-eligibility" role="status">{paused}</p>}
   {!admin && !paused && status.trialUntil && status.trialUntil > Date.now() && <p className="community-notice submission-eligibility">Submissions are reopening gradually, with up to two player images per minute. If the queue is busy, wait a moment and try again.</p>}
   {admin && status.reasons.length > 0 && !paused && <p className="community-help submission-eligibility">Player submissions are paused. You can still add a promo for review.</p>}
   <form className="community-form" onSubmit={event => void submit(event)} aria-label={admin ? 'Upload a promo' : 'Submit a community image'}>
    <label className="community-upload"><span>Choose your image</span><input type="file" aria-label="Community image" accept="image/jpeg,image/png,image/webp" disabled={busy || choosing || blocked} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }}/><small>Still JPEG, PNG or WebP · up to 4 MiB · 12 megapixels</small></label>
    {choosing && <p role="status">Preparing your image…</p>}
    {preview && <figure className="community-upload-preview"><img src={preview} alt="Your submission preview"/><figcaption>{fileName}</figcaption></figure>}
    <label>Title<input required maxLength={100} value={title} disabled={busy || blocked} onChange={event => { if (event.target.value.trim() !== title.trim()) lastAttempt.current = null; setTitle(event.target.value); }} placeholder="Give this memory a name"/></label>
    <label>Creator credit <span className="community-optional">(optional)</span><input maxLength={80} value={credit} disabled={busy || blocked} onChange={event => { if (event.target.value.trim() !== credit.trim()) lastAttempt.current = null; setCredit(event.target.value); }} placeholder="How should we credit you?"/></label>
    <p className="community-help">Only share images you have permission to use. Approved images are visible to everyone in Slop City. Each image needs a fresh verification check.</p>
    {error && <p className="community-error" role="alert">{error}</p>}{notice && <p className="community-notice" role="status">{notice}</p>}
    <button className="community-button" type="submit" disabled={busy || choosing || blocked || !preview || !title.trim()}>{busy ? 'Sending image…' : error && preview ? 'Try sending again' : 'Send for review ↗'}</button>
   </form>
  </>}
 </section>{!admin && available && <section className="community-submissions"><span className="community-kicker">JUST BETWEEN YOU AND TOM</span><h3>Your submissions</h3><p>Status follows your saved profile.</p>{listError && <p className="community-error" role="alert">{listError} <button type="button" onClick={() => void refreshHistory()}>Retry</button></p>}{!submissions.length && !listError && <p className="community-empty-note">Nothing pinned yet. Your first submission will appear here.</p>}<ul>{submissions.map(submission => <li key={submission.id}><img src={submission.imageUrl} alt={submission.title}/><div><strong>{submission.title}</strong><span className={`community-status status-${submission.status}`}>{submission.status === 'pending' ? 'Waiting for review' : submission.status === 'approved' ? 'On the board' : 'Not approved'}</span><small>{new Date(submission.createdAt).toLocaleDateString()}</small></div></li>)}</ul></section>}</div>{verification.dialog}</>;
}
