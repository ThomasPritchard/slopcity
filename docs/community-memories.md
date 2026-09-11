# Community notices and memories

11 September 2026. The opening-day notice appears beside the main-menu town preview. It welcomes players to v0.1 and celebrates funny encounters, shared memories and the first player-made meme.

The same post is Memory 001 on a freestanding board southwest of the fountain, beside the arrival benches. Walk up and choose “Read the memories board”, or click its face. Both the menu image and square board open the same full-size image and story. Escape and the visible close button dismiss the viewer; keyboard focus returns to the opener. On small screens the menu and memory viewer scroll vertically.

`shared/memories.ts` owns the curated post and board position. `src/community/` presents the menu card and dialog; `src/world/memoriesBoard.ts` creates the physical board. Its dimensions feed the shared server/client collision rules, leaving the main square-to-casino route clear. No player upload flow or new database data is introduced.

`public/community/first-memory.png` is the original image supplied for publication by Tom in this session, copied without alteration. The post credits it as a player-made meme and preserves the attribution inside the image.

Verification: `tests/memories-board.test.ts` exercises sprint collision, hop rejection, approach space and the existing casino route. `scripts/community-browser-check.ts` covers the real menu, original image, portrait and landscape layouts, dialog dismissal/focus, onboarding, a walk to the square board and authoritative collision. Its local mode also clicks the physical board face. Screenshots and results are written to ignored `output/playwright/community/`.
