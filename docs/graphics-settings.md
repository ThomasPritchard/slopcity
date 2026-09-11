# Graphics settings

Graphics quality is an explicit choice saved in this browser. **High is the default on desktop and phones**, preserving the previous normal appearance. No device detection or frame-rate rule silently lowers it. Existing Performance mode users migrate to **Medium**, which preserves that mode's settings; everyone else migrates to High.

| Preset | Intended result |
| --- | --- |
| Low | Lowest rendering cost, with softer resolution, simpler shadows, less decorative planting and lighter fountain effects. |
| Medium | Former Performance mode: CSS resolution, lighter shadows and less frequent water reflections. |
| High | Previous normal appearance, including full decorative planting, glow and water effects. |
| Ultra | Sharper rendering and shadows, more nearby character shadows, and detailed characters farther away. |

All choices retain players, their selected outfits and colours, the local character's full model, actual town lights and gameplay. The changing-room preview stays fully detailed. Lower presets select the existing simplified character model sooner for distant neighbours. Cinema video quality remains controlled by its provider; these presets do not change the video's stream quality.

## Renderer budgets

The authoritative values live in [`src/settings/graphics.ts`](../src/settings/graphics.ts). Each resolution value is render pixels per CSS pixel, capped by device density except Medium, which retains its previous fixed CSS resolution. Interface text keeps the browser's normal sharpness.

| Setting | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Render density cap | 0.75× | 1× fixed | 1.75× | 2× |
| Shadow map | 512² | 1024² | 2048² | 4096² |
| Shadow update interval | Every 2 frames | Every 2 frames | Every frame | Every frame |
| Shadow filtering | Simple | Simple | Detailed | Detailed |
| Neighbour shadow limit / range | 2 / 8 m | 4 / 10 m | 8 / 15 m | 12 / 20 m |
| Detailed neighbour range | 5 m | 7 m | 10 m | 14 m |
| Detailed range with 32+ avatars | 3 m | 4 m | 6 m | 9 m |
| Moving / idle animation range | 24 / 5 m | 30 / 6 m | 45 / 12 m | 55 / 16 m |
| Water reflection/refraction map | 256² | 512² | 512² | 512² |
| Water reflection/refraction interval | Every 4 frames | Every 3 frames | Every frame | Every frame |
| Water normal animation interval | Every 4 frames | Every 2 frames | Every frame | Every frame |
| Visible fountain spray density | 20% | 45% | 100% | 100% |
| Decorative grass / seed heads | Off / off | Off / on | On / on | On / on |
| Decorative glow | Off | Off | On | On |

The local character retains its shadow. Neighbour detail switches use the existing ±2 m hysteresis to avoid repeatedly swapping models at a boundary. Animation distance limits retain the existing exceptions for local movement, jumps, interactions and transitions. Reduced motion remains independent of graphics quality. Water still pauses in the changing room and focused casino views, and resumes at the chosen quality afterwards.

Ultra's larger shadow map uses four times as many texels as High. Low and Medium trade visible detail for lower work; choosing them does not guarantee a particular frame rate. Quality-preserving optimisations, such as rejecting cinema pointer positions outside the projected screen before geometry picking, apply to every preset.

## Verification

- `npm test`: preference migration, all-preset persistence, render-density rules and cinema pointer geometry/routing boundaries.
- `npm run test:graphics-render`: headless Chromium and WebKit, all presets, repeated switches with 32 synthetic avatars, preserved outfit surfaces/colours, local full detail, shadow budgets, material disposal and water restoration. Requires the development client at `http://localhost:5173`.
- `npm run test:graphics-browser`: actual settings, saved choice after reload, touch targets and layout at 390×844, 320×740 and 844×390, plus the existing chat and audio journey. Uses a disposable PostgreSQL schema and loopback server; only the admission provider is simulated.
- `npm run test:cinema-pointer`: actual Babylon renderer with a static provider fixture, pointer rejection, occlusion, mouse/touch access and iframe retention.

During implementation, fixed Chromium town-square captures for High and Medium matched the previous normal and Performance images pixel for pixel, in portrait and landscape at day and night. Captures and results are kept under ignored `output/playwright/graphics-presets/`, `output/playwright/polish/` and `output/playwright/cinema-pointer/`.

These checks establish rendering behaviour and browser integration on this Mac. They do not establish physical-phone frame rates, real video decoding cost or multiplayer capacity. The next performance comparison should use the same physical phone, camera route and player population around the square, with cinema playback both active and inactive.
