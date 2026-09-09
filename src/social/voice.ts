import { Room, RoomEvent, RemoteAudioTrack, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from 'livekit-client';
import type { VoiceNeighbour } from '../../shared/voice';
export type VoiceState = { status: 'off' | 'connecting' | 'connected' | 'error'; micEnabled: boolean; playbackBlocked: boolean; error: string; speaking: string[] };
export const silentVoice: VoiceState = { status: 'off', micEnabled: false, playbackBlocked: false, error: '', speaking: [] };
export class ProximityVoice {
  private room: Room | null = null;
  private generation = 0;
  private micChanging = false;
  private targets = new Map<string, number>();
  private muted = new Set<string>();
  private audio = new Map<RemoteTrack, HTMLMediaElement>();
  private state: VoiceState = { ...silentVoice };
  constructor(private changed: (state: VoiceState) => void) {}
  private update(patch: Partial<VoiceState>) { this.state = { ...this.state, ...patch }; this.changed(this.state); }
  setTargets(targets: VoiceNeighbour[]) { this.targets = new Map(targets.map(target => [target.sessionId, target.gain])); this.reconcile(); }
  setMuted(ids: Set<string>) { this.muted = new Set(ids); this.reconcile(); }
  private reconcile() {
    const room = this.room; if (!room) return;
    // The server supplies eligible neighbours; publishers also restrict access to those identities.
    room.localParticipant.setTrackSubscriptionPermissions(false, [...this.targets.keys()].map(participantIdentity => ({ participantIdentity, allowAll: true })));
    for (const participant of room.remoteParticipants.values()) for (const publication of participant.audioTrackPublications.values()) {
      const allowed = this.targets.has(participant.identity) && !this.muted.has(participant.identity);
      publication.setSubscribed(allowed);
      if (publication.track instanceof RemoteAudioTrack) publication.track.setVolume(allowed ? this.targets.get(participant.identity)! : 0);
    }
  }
  async join() {
    if (this.room) return;
    const generation = ++this.generation;
    // Web Audio gain works on mobile browsers that ignore media-element volume.
    const room = new Room({ webAudioMix: true, disconnectOnPageLeave: true, adaptiveStream: false, dynacast: false, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, publishDefaults: { stopMicTrackOnMute: true } });
    this.room = room; this.update({ ...silentVoice, status: 'connecting' });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (this.room !== room || !(track instanceof RemoteAudioTrack)) return;
      const element = track.attach(); element.style.display = 'none'; document.body.append(element); this.audio.set(track, element);
      track.setVolume(this.muted.has(participant.identity) ? 0 : this.targets.get(participant.identity) ?? 0);
    });
    room.on(RoomEvent.TrackUnsubscribed, track => {
      // LiveKit may already have detached the element before delivering this event.
      const element = this.audio.get(track);
      if (element) { track.detach(element); element.remove(); this.audio.delete(track); }
    });
    room.on(RoomEvent.TrackPublished, () => this.reconcile());
    room.on(RoomEvent.ParticipantConnected, () => this.reconcile());
    room.on(RoomEvent.ActiveSpeakersChanged, speakers => { if (this.room === room) this.update({ speaking: speakers.map(speaker => speaker.identity) }); });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (this.room === room) this.update({ playbackBlocked: !room.canPlaybackAudio }); });
    room.on(RoomEvent.Reconnecting, () => { if (this.room === room) this.update({ status: 'connecting' }); });
    room.on(RoomEvent.Reconnected, () => { if (this.room !== room) return; this.reconcile(); this.update({ status: 'connected', micEnabled: room.localParticipant.isMicrophoneEnabled }); });
    room.on(RoomEvent.Disconnected, () => { if (this.room === room) { this.room = null; this.clearAudio(); this.update({ ...silentVoice, status: 'error', error: 'Voice disconnected. Join again when you are ready.' }); } });
    try {
      // Call from the explicit button gesture before any network waits.
      await room.startAudio();
      if (generation !== this.generation) return;
      const response = await fetch('/game/api/voice/token', { method: 'POST', credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Voice is unavailable right now.');
      if (generation !== this.generation) return;
      await room.connect(result.url, result.token, { autoSubscribe: false, rtcConfig: { iceServers: [] } });
      if (generation !== this.generation) { await room.disconnect(); return; }
      this.reconcile(); this.update({ status: 'connected', micEnabled: false, error: '', playbackBlocked: !room.canPlaybackAudio });
    } catch (error) {
      if (generation !== this.generation) return;
      this.room = null; await room.disconnect(); this.clearAudio();
      this.update({ ...silentVoice, status: 'error', error: error instanceof Error ? error.message : 'Voice could not connect. Town chat is still available.' });
    }
  }
  async toggleMicrophone() {
    const room = this.room; if (!room || this.state.status !== 'connected' || this.micChanging) return;
    if (!navigator.mediaDevices?.getUserMedia) { this.update({ micEnabled: false, error: 'Microphone access needs HTTPS on other devices. You can still listen and use town chat on this LAN address.' }); return; }
    this.micChanging = true;
    try {
      this.reconcile();
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      if (this.room === room) this.update({ micEnabled: room.localParticipant.isMicrophoneEnabled, error: '' });
      else await room.localParticipant.setMicrophoneEnabled(false);
    } catch { if (this.room === room) this.update({ micEnabled: false, error: 'Microphone access was not available. Check your browser permission; you can keep listening or use chat.' }); }
    finally { this.micChanging = false; }
  }
  async resumeAudio() { try { await this.room?.startAudio(); this.update({ playbackBlocked: !(this.room?.canPlaybackAudio ?? true) }); } catch { this.update({ playbackBlocked: true }); } }
  private clearAudio() { for (const [track, element] of this.audio) { track.detach(element); element.remove(); } this.audio.clear(); }
  async leave() {
    ++this.generation;
    const room = this.room; this.room = null;
    this.clearAudio(); this.update({ ...silentVoice });
    await room?.disconnect(true);
  }
}
