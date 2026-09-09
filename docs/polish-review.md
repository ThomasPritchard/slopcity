# Phase 5 polish implementation

9 September 2026. Implements the approved backlog from the earlier polish assessment. The game remains loopback-only; the approved character face, guest identity, fictional-credit rules and casino interface are retained.

## Changes

| Area | Implemented behaviour | Evidence |
| --- | --- | --- |
| Phone controls | Chat starts collapsed on touch devices. Expanded chat stays clear of the joystick; focus alone does not move the send target. Keyboard space and safe-area offsets are considered. Character swatches, rotation/framing, chat and toolbar targets are at least 44px. | Headless WebKit at 320px/390px portrait and 844×390 landscape; actual chat taps and sends. |
| Render sizing | A deferred ResizeObserver plus ready-time resize follows layout. Normal mode caps render density at 1.75; Performance mode uses CSS resolution. | DPR3 390×844 phone now renders 682×1477 normally and 390×844 in Performance mode, versus the previous 182×393. No resize-loop errors in the final comfort check. |
| Camera and movement | Obstructions temporarily shorten the camera without overwriting requested zoom. Non-default orbit/zoom restore after casino and wardrobe; casino framing eases for 250ms. Gait follows achieved movement. Turning and animation changes blend. | Actual wall walkthrough returns to 7.5m from about 2m; blocked gait is Idle. Renderer fixture restores a non-default alpha −1.1, beta 1.2 and 9m radius after both views. Social and wave journeys pass. |
| Neighbours | First snapshot places arrivals directly. Remote models use distance/crowd-dependent detail with hysteresis, preserving rig pose and outfit. Local character/preview retain the full model. Owned materials are disposed during replacement. | First-snapshot, near/far, repeated replacement/material-count and animation checks in the real renderer. Blender export preserves rig, material names and all four clips. |
| Render cost | Fountain reflection list is limited to 56 nearby prop meshes and excludes citizens. Performance mode updates water every third frame. Neighbour shadows have a nearest-player budget; distant idle animation is paused. | Reproducible 1/16/32/64 rendered-avatar samples; see measurements below. |
| Comfort and sound | Browser-saved performance, motion and separate effects/ambience levels. Motion follows the device or an explicit preference. Reduced motion stops decorative water/casino/card motion while retaining results. Fountain, footstep, card/chip and neutral slot cues use local Web Audio synthesis. Gesture activation, background silence and duplicate-event suppression are included. Voice remains separate. | Preference parsing/event tests; actual browser storage restoration, media changes, running audio context, muted gains and footstep sources. No human listening claim. |
| Interaction and presentation | Nearest casino option is emphasized and marked on the 3D floor; equally close choices remain available, with hover/focus choosing the marker. Touch prompts clear the joystick. Warm casino fill is scoped away from clothing previews; nearby contact shadows are refined. | Source integration, renderer screenshots and complete casino/mobile journeys. |

## Verification

Final results and measurements are recorded in the project checkpoint and ignored `output/playwright/polish/`. Browser runs are headless and do not bring windows forward. Synthetic renderer fixtures are separate from real network journeys.

The main JavaScript bundle remains large; this pass does not claim public-release or physical-device readiness. Physical phones, native Windows, human listening/microphones and 64-person voice capacity remain unverified. The rendered-crowd benchmark runs in headless WebKit on this Mac, with synthetic snapshots and a 960×720 viewport; it is not a native-phone or 64-user end-to-end load test.

## Measured crowd rendering

Headless WebKit, 960×720, DPR1; 1.8-second settling and four-second frame samples per configuration. Baseline used a temporary copy of the pre-polish renderer and fully clothed citizens; that temporary source has been removed. Stationary avatars, with the same arrangement before and after:

| Avatars | Before normal fps | After normal fps | Before performance fps | After performance fps |
| --- | --- | --- | --- | --- |
| 1 | 60 | 60.1 | 60.1 | 60 |
| 16 | 31.4 | 59.9 | 27.4 | 59.7 |
| 32 | 17.7 | 47.4 | 16.9 | 50.8 |
| 64 | 9.6 | 27.3 | 9.7 | 28.2 |

A separate 64-citizen moving sample drove 63 remote Walk clips and changed their positions at 20Hz: **24 fps normal / 27.2 fps Performance**. These short samples show useful improvements, but dense crowds still fall below 60fps. Native-device profiling and further draw-call/material work remain appropriate before public deployment. The benchmark does not include 64 browser clients or voice streams.

## Checks completed in this implementation

- `npm test`: 39 tests, including sound-event deduplication and preference validation. HTTP tests require loopback socket permission.
- `npm run build`: strict TypeScript and Vite build. The existing large-chunk warning remains.
- Headless WebKit: comfort settings/mobile chat, original camera walkthrough, first-snapshot/LOD/material lifecycle and repeated-wave fixture, all three casino games, synthetic split/hit/dealer-card rendering, shop/wardrobe purchases and persistence, social/chat/block/bench journey, and the wave pose/interrupt check.
- Headless Chromium: startup, walking to roulette, an accepted wager, matching 3D chip and settlement.
- Background Blender: LOD export has 23,128 triangles versus 84,588 for all original character variants; node/material names, 16-bone skin and Idle/Walk/Wave/Sit channels match. Original source hash remains unchanged.

The broader PostgreSQL, 64-client protocol and synthetic voice checks remain earlier evidence; those server paths were not changed in this pass.

## Reproduce

With the local services running and Playwright browsers installed:

```sh
npm run test:polish
npm run test:crowd
CROWD_MOVING=1 npm run test:crowd
node --import tsx scripts/polish-audit.ts
```

Set `PLAYWRIGHT_BROWSERS_PATH=/tmp/slop-city-browsers` for this Mac's existing browser installation. Screenshots and JSON measurements are under ignored `output/playwright/polish/`, including `comfort-results.json`, `world-results.json`, `audit.json`, `crowd-baseline.json`, `crowd-polished.json`, and `crowd-polished-moving.json`.
