import express, { type Application } from 'express';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { authenticateGuest, isAllowedOrigin, type SessionRegistry } from './guest.ts';
import type { GuestRepository } from './persistence/guests.ts';
export class VoiceService {
  private url = process.env.LIVEKIT_URL;
  private key = process.env.LIVEKIT_API_KEY;
  private secret = process.env.LIVEKIT_API_SECRET;
  private client = this.url && this.key && this.secret ? new RoomServiceClient(this.url.replace(/^ws/, 'http'), this.key, this.secret) : null;
  async token(roomId: string, sessionId: string) {
    if (!this.client || !this.key || !this.secret) throw new Error('Voice unavailable');
    await this.client.listRooms([roomId]);
    const token = new AccessToken(this.key, this.secret, { identity: sessionId, ttl: '60s' });
    token.addGrant({ roomJoin: true, room: roomId, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
    return { url: this.url!, token: await token.toJwt() };
  }
  async remove(roomId: string, sessionId: string) { try { await this.client?.removeParticipant(roomId, sessionId); } catch { /* Already absent or voice unavailable; town leave must still complete. */ } }
}
export function mountVoiceRoutes(app: Application, guests: GuestRepository, sessions: SessionRegistry, voice: VoiceService, hasParticipant: (roomId: string, sessionId: string) => boolean) {
  app.post('/api/voice/token', express.json({ limit: '1kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAllowedOrigin(req.headers.origin)) { res.status(403).json({ error: 'Origin not allowed' }); return; }
    try {
      const profile = await authenticateGuest(req.headers.cookie, guests);
      if (!profile) { res.status(401).json({ error: 'Guest authentication required' }); return; }
      const active = sessions.get(profile.id);
      if (!active || !hasParticipant(active.roomId, active.sessionId)) { res.status(409).json({ error: 'Join the town before joining voice' }); return; }
      const grant = await voice.token(active.roomId, active.sessionId);
      if (sessions.get(profile.id)?.sessionId !== active.sessionId) { res.status(409).json({ error: 'Your town session has ended' }); return; }
      res.json({ ...grant, url: process.env.LIVEKIT_PUBLIC_URL || `${req.headers.origin!.replace(/^http/, 'ws')}/voice` });
    } catch { res.status(503).json({ error: 'Voice is unavailable right now. You can still use town chat.' }); }
  });
}
