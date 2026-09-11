# Community notices and memories

11 September 2026. The menu retains the original opening-day notice and first player-made meme. The square’s freestanding memories board is now a collection of Polaroids: examine the board, zoom with its controls, and click a photo to expand the complete uncropped image. Back/Escape closes the photo first and restores focus to its Polaroid; closing the board returns to the town.

The original `public/community/first-memory.png` stays unchanged, with its attribution inside the image. `shared/memories.ts` retains this seed and the board’s physical position/collision. Approved community submissions appear alongside it. The menu and physical board open the same gallery. Rejected and pending images are private to their submitting guest and the administrator.

`src/community/` owns the board, photo viewer, submissions, review desk and cinema watch view. `src/world/memoriesBoard.ts` shows a bounded selection of approved Polaroids on the physical board; the enlarged gallery exposes the complete collection. `shared/community.ts` owns the common programme and slide selection. Architecture, moderation limits, administrator setup and playback boundaries are recorded in [cinema-community-design.md](cinema-community-design.md).

`npm run test:community-browser` checks the actual menu, board, image expansion/focus, phone layouts and approach collision. `npm run test:cinema-render` checks the actual cinema asset and screen in daylight/night and phone layouts. The moderated-upload acceptance script `scripts/community-ui-check.ts` uses a disposable local preview; see its setup before running because it creates and moderates test submissions. Screenshots and results remain in ignored `output/playwright/`.
