# Public-channel cinema setup

11 September 2026. Public sources: [BridgeMind on Twitch](https://www.twitch.tv/bridgemindai) and [BridgeMind on YouTube](https://www.youtube.com/@bridgemindai). Video `kP31sQPAJm0` is a playback test reference, not the permanent channel configuration.

## Twitch developer app

This is a Slop City application registered with Tom's Twitch account. BridgeMind does not need to sign in, share a stream key or grant access to his account.

1. Sign in to the [Twitch developer console](https://dev.twitch.tv/console/apps). Verify your Twitch email and enable two-factor authentication if the console requires it.
2. Choose **Register Your Application**. Use a unique name such as **Slop City Cinema** and the category that describes the game integration. If offered a client type, select **Confidential**, because the server keeps the client secret.
3. Enter `https://slopcity.fun` as the OAuth redirect URL and add it. Remove any extra empty URL row if it shows a validation error. This application uses the server's client-credentials flow, so it does not actually redirect a broadcaster or player through a login flow and needs no callback page.
4. Create the application, open **Manage**, copy its **Client ID**, then choose **New Secret** and save the secret privately. Generating another secret invalidates the previous one.
5. Add these entries to the ignored local `.env` file, replacing the placeholders:

   ```dotenv
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   ```

Keep both server-side; do not use `VITE_` prefixes, commit the file or paste the secret into chat. Local configuration does not configure production. Production uses its separate private game environment file and a separately authorised release/restart.

Restart the local game server after saving credentials. The `server/twitchLive.ts` detector starts with the server and checks only `bridgemindai`, about every 30 seconds. It obtains its own app token, handles renewal, and requires two successful offline checks before declaring the stream finished. A failed check preserves the previous confirmed state. Missing credentials are reported as unconfigured in the review desk's Programme tab.

A confirmed live Twitch stream takes priority over the saved programme. When offline, the town returns to the approved reel, unless Tom has explicitly selected a curated YouTube video between Twitch streams. Public programme polling adds up to 15 seconds after server detection. Live transitions do not write settings, increment their revision or restart the shared reel clock. The administrator edits saved settings separately from the current detected playback state.

The configured app successfully obtained and validated a token and returned BridgeMind live from Get Streams during the 11 September local check. This establishes public status detection, not in-world video playback. Credentials remain in the ignored local environment.

References: [register an application](https://dev.twitch.tv/docs/authentication/register-app/), [client-credentials grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow), [Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams).

## YouTube comparison

A known public video can use the official embedded player without a developer API key, provided the owner allows embedding. Automatic discovery across changing stream URLs is separate: use the public channel handle `@bridgemindai` to resolve its channel ID, then query for live broadcasts from that channel. This requires a Slop City Google Cloud project with **YouTube Data API v3** enabled and a server-side API key; it does not require BridgeMind's account access.

To prepare a key, create a project in [Google Cloud Console](https://console.cloud.google.com/), enable **YouTube Data API v3**, then create an **API key** under **APIs & Services → Credentials**. Restrict that key to **YouTube Data API v3**. Server requests use IP restrictions when a stable outbound IP is available, rather than website-referrer restrictions. Do not add a key to the browser bundle. YouTube detection is not implemented yet.

Google's current default allocation is **100 search calls per day**. Searching continuously every 16 minutes uses 90 calls per day before retries or restarts; discovering an unscheduled new stream can consequently take up to that interval, plus search indexing delay. Checking an already-known video is cheaper, but cannot discover a new video ID by itself. A larger search quota or a more involved discovery strategy is needed for frequent checks throughout the day.

References: [API setup](https://developers.google.com/youtube/v3/getting-started), [channel handles](https://developers.google.com/youtube/v3/docs/channels/list#forHandle), [live search](https://developers.google.com/youtube/v3/docs/search/list#eventType), [current quota allocation](https://developers.google.com/youtube/v3/determine_quota_cost).

## The physical screen

Both public providers use their official browser player. The 960×540 iframe is aligned to the physical screen with perspective. A depth-tested transparent screen material lets the iframe show through the canvas while foreground scenery and characters remain in front. No provider video is captured, extracted or rebroadcast.

Playback is available while roaming; there is no seating, ramp, projected-size or whole-screen visibility gate. Once mounted, the same player survives walking and camera changes. Leaving the game view, opening a full panel or switching source releases it. Hiding the browser tab keeps the player and current volume; live programme checks continue in the background. Offline detection restores the approved reel.

Twitch volume is based on horizontal character distance from the screen: full through 8 metres, smoothly fading to silence at 30 metres. Camera zoom does not change volume. Native mute is preserved; a sound-enable control appears when the playing stream is muted. Autoplay requests use Twitch's official API, with a bounded muted retry and no forced restart after a viewer pauses.

The provider iframe itself remains 960×540; its perspective projection becomes smaller farther away. Twitch documents a 400×300 embed minimum, while YouTube documents 200×200. Their documentation does not explicitly qualify this custom world-compositing approach; local rendering evidence is not provider approval. Native ads, controls, embedding restrictions and browser autoplay decisions still apply. In local Chromium tests, the plain player autoplayed, but the scaled player and the player beneath a transparent canvas required a native play click. An external button using the official play API did not remove this restriction. Do not promise automatic initial video playback in this world view. Browser/OS background-media suspension remains outside the game's control. Direct `http://localhost:5178` is the tested local origin; Twitch failed through the HTTP Orca alias during the earlier check. Production uses HTTPS.

References: [Twitch requirements](https://dev.twitch.tv/docs/embed/), [Twitch player dimensions](https://dev.twitch.tv/docs/embed/video-and-clips/), [YouTube player dimensions](https://developers.google.com/youtube/player_parameters), [YouTube player visibility](https://developers.google.com/youtube/terms/required-minimum-functionality).
