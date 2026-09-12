import { useId, type ReactNode } from 'react';
import { SocialDialog } from './SocialDialog';
import './social.css';

export interface SocialPanelProps {
  open: boolean;
  onClose(): void;
  onInspect?(profileId: string, name: string): void;
  extra?: ReactNode;
  invitation?: ReactNode;
  voice: {
    status: 'off' | 'connecting' | 'connected' | 'error';
    micEnabled: boolean;
    playbackBlocked: boolean;
    error: string;
  };
  neighbours: Array<{
    sessionId: string;
    profileId: string;
    name: string;
    distance: number;
    muted: boolean;
    blocked: boolean;
    speaking: boolean;
  }>;
  blockedProfiles: Array<{ profileId: string; name: string }>;
  onJoinVoice(): void;
  onLeaveVoice(): void;
  onToggleMic(): void;
  onResumeAudio(): void;
  onMute(sessionId: string): void;
  onBlock(profileId: string): void;
  onUnblock(profileId: string): void;
}

function SocialIcon({ kind }: { kind: 'mic' | 'mic-off' | 'close' | 'sound' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'close' ? <path d="m6 6 12 12M6 18 18 6" /> : kind === 'sound' ? <>
      <path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </> : <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      {kind === 'mic-off' && <path d="m2 2 20 20" />}
    </>}
  </svg>;
}

export function SocialPanel({
  open, onClose, onInspect, extra, invitation, voice, neighbours, blockedProfiles,
  onJoinVoice, onLeaveVoice, onToggleMic, onResumeAudio, onMute, onBlock, onUnblock,
}: SocialPanelProps) {
  const titleId = useId();
  const voiceTitleId = useId();
  const neighboursTitleId = useId();
  const blockedTitleId = useId();
  const connected = voice.status === 'connected';
  const connecting = voice.status === 'connecting';

  if (!open) return null;

  const voiceLabel = connecting ? 'Joining voice…' : connected ? 'Voice connected' : voice.status === 'error' ? 'Voice unavailable' : 'Voice off';
  const voiceError = voice.error || (voice.status === 'error' ? 'Voice could not connect. Please try again.' : '');

  return <SocialDialog labelledBy={titleId} className="soft-corner-panel" onClose={onClose}>
      <header className="social-header">
        <div><span className="eyebrow">Life in the square</span><h2 id={titleId}>Your neighbours.</h2></div>
        <button autoFocus type="button" className="social-close" aria-label="Close neighbours panel" onClick={onClose}><SocialIcon kind="close" /></button>
      </header>
      <div className="social-content">
        {invitation}
        <section className="social-voice" aria-labelledby={voiceTitleId}>
          <div className="social-section-heading"><h3 id={voiceTitleId}>Proximity voice</h3><span className={`social-connection${connected ? ' is-connected' : ''}`} role="status">{voiceLabel}</span></div>
          <p className="social-copy">{connected ? 'Hear neighbours nearby. Voices fade as you move apart.' : 'Join to hear neighbours nearby. Your microphone starts off.'}</p>
          <div className={`social-microphone${voice.micEnabled ? ' is-on' : ''}`}>
            <span className="social-mic-icon"><SocialIcon kind={voice.micEnabled ? 'mic' : 'mic-off'} /></span>
            <div role="status"><strong>Microphone {voice.micEnabled ? 'on' : 'off'}</strong><span>{voice.micEnabled ? 'You can be heard nearby.' : 'Your voice is not being shared.'}</span></div>
          </div>
          <div className="social-voice-actions">
            {connected ? <>
              <button type="button" className={`social-button${voice.micEnabled ? '' : ' is-primary'}`} onClick={onToggleMic}>{voice.micEnabled ? 'Turn off microphone' : 'Enable microphone'}</button>
              <button type="button" className="social-button" onClick={onLeaveVoice}>Leave voice</button>
            </> : <button type="button" className="social-button is-primary" disabled={connecting} onClick={onJoinVoice}>{connecting ? 'Joining voice…' : voice.status === 'error' ? 'Try voice again' : 'Join voice'}</button>}
          </div>
          {connected && voice.playbackBlocked && <div className="social-audio-notice">
            <p>Your browser has paused voice audio.</p><button type="button" className="social-button" onClick={onResumeAudio}><SocialIcon kind="sound" />Enable sound</button>
          </div>}
          {voiceError && <p className="social-error" role="alert">{voiceError}</p>}
        </section>

        <section className="social-neighbours" aria-labelledby={neighboursTitleId}>
          <div className="social-section-heading"><h3 id={neighboursTitleId}>Neighbours nearby</h3><span className="social-count">{neighbours.length}</span></div>
          <p className="social-copy">Mute turns off a neighbour’s voice for you.</p>
          {neighbours.length === 0 ? <p className="social-empty">A little quiet here. Take a walk to find your neighbours.</p> : <ul className="social-list">
            {neighbours.map(neighbour => <li key={neighbour.sessionId} className="social-person">
              <span className={`social-person-mark${neighbour.speaking && !neighbour.muted && !neighbour.blocked ? ' is-speaking' : ''}`} aria-hidden="true">{neighbour.name.trim().slice(0, 1).toUpperCase() || '·'}</span>
              <div className="social-person-name">{onInspect ? <button className="friend-name" aria-label={`View ${neighbour.name}`} onClick={() => onInspect(neighbour.profileId, neighbour.name)}><strong>{neighbour.name}</strong></button> : <strong>{neighbour.name}</strong>}<span>{neighbour.blocked ? 'Blocked' : neighbour.muted ? 'Muted for you' : neighbour.speaking ? 'Speaking' : `${Math.max(0, Math.round(neighbour.distance))} m away`}</span></div>
              <div className="social-person-actions">
                <button type="button" className="social-button" aria-label={`Mute ${neighbour.name}`} aria-pressed={neighbour.muted} disabled={neighbour.blocked} onClick={() => onMute(neighbour.sessionId)}>{neighbour.muted ? 'Muted' : 'Mute'}</button>
                <button type="button" className="social-button" aria-label={`${neighbour.blocked ? 'Unblock' : 'Block'} ${neighbour.name}`} onClick={() => neighbour.blocked ? onUnblock(neighbour.profileId) : onBlock(neighbour.profileId)}>{neighbour.blocked ? 'Unblock' : 'Block'}</button>
              </div>
            </li>)}
          </ul>}
        </section>

        {extra}
        <section className="social-blocked" aria-labelledby={blockedTitleId}>
          <div className="social-section-heading"><h3 id={blockedTitleId}>Blocked guests</h3><span className="social-count">{blockedProfiles.length}</span></div>
          <p className="social-copy">A blocked guest’s chat and audio are hidden from you. Their avatar stays visible.</p>
          {blockedProfiles.length === 0 ? <p className="social-empty is-compact">No blocked guests.</p> : <ul className="social-list">
            {blockedProfiles.map(guest => <li key={guest.profileId} className="social-person social-blocked-person"><div className="social-person-name"><strong>{guest.name}</strong></div><button type="button" className="social-button" aria-label={`Unblock ${guest.name}`} onClick={() => onUnblock(guest.profileId)}>Unblock</button></li>)}
          </ul>}
        </section>
      </div>
      <footer className="social-footer">Make yourself at home. Stay in control.</footer>
  </SocialDialog>;
}
