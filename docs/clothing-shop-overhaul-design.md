# Form & Thread overhaul

11 September 2026. Tom selected layout B, the connected departments, for the shop rebuild: it feels more characteristic to him. Implementation of the first scope is authorized.

## Direction and first scope

Develop Form & Thread as a warm flagship boutique: oak, ivory plaster, brushed brass and sage upholstery. Give the shop a finished architectural shell, recessed entrance, display windows, fabric awnings, considered lighting, detailed retail furniture and a spacious fitting lounge. Preserve the shop name and the character's established identity.

The first scope is the building, interior, lighting, displays and fitting lounge. Use the selected connected-department layout, including its broad openings and rear central display. Adopt the study's 20 m frontage and 16 m depth, extending east behind the current entrance. The shop remains level with the square.

Complete-outfit preview, displays that open catalogue categories, garment thumbnails and additional clothing are proposed follow-on work. They are not functional features of this architectural study. Existing fictional credits, private try-on, separate purchase/equip and ownership rules remain binding.

## Study and implementation boundary

Disposable sources, matched Blender renders and measurements live under ignored `output/playwright/shop-overhaul-study/`. `study.md` describes the comparison and evidence; the builder and saved scenes are experimental assets. They must not be copied into maintained production asset paths.

The study's local axes are X across the frontage to the viewer's right, Y into the shop, and Z up. Its town mapping is `town x = 18 + local Y`, `town z = -2 - local X`; the envelope is town x=18–34 and z=-12–8. Surrounding square geometry is simplified context.

The production rebuild updates maintained Blender source/export pairs, shared shop geometry and furniture collision, the eastern admission boundary, purchase eligibility, district/map bounds and fitting-room camera/mirror placement together. Preserve the casino and unrelated work. Verify the finished architecture in the browser, including phone portrait/landscape, and run the affected movement, shop and economy checks. Blender renders alone do not establish any of those runtime behaviours. Publishing or a production restart is outside this approval.

## First comparison

The local comparison page is `output/playwright/shop-overhaul-study/index.html`. It switches between matched cutaway, full-plan and 1.8 m entrance views, and includes the shared exterior and a fitting-bay detail. The two saved sources are `variant-a/study.blend` and `variant-b/study.blend`, authored in Blender 5.2.1 LTS. These ignored artifacts are unavailable in a fresh clone.

A keeps the central display on an open floor with perimeter rails. The selected B moves that display towards the rear and divides browsing into connected departments. Both retain six rails, four window mannequins, one checkout, a shoe display and two 3.3 × 3.5 m fitting bays. B's more characteristic room arrangement is the accepted design; the earlier preference for A is superseded.

Saved-scene checks cover the 20 × 16 m footprint, 4.8 m ceiling, 3.7 m clear entrance, 1.8 m figures, matching shared geometry/cameras/lights, unclipped plans and representative routes to the checkout and fitting bay against simplified furniture bounds. The capture manifests tie the eight renders to those verified source files. The HTML gallery is checked in headless Chromium at desktop and 390 px widths. These checks apply to the design study only; production implementation followed the selection of B.

## Local implementation and evidence — 11 September 2026

The maintained `build_shop.py` now authors a separate shell, complete roof/ceiling and furnished interior. Connected departments have broad framed openings, with the central display towards the rear, six rails, a shoe wall, folded stock, checkout, waiting bench and two curtained fitting bays. Four window mannequins wear existing catalogue outfits through the current citizen LOD. The original enamel fascia and checkout plaque remain reusable assets. Three steady fill lights illuminate shop meshes and current occupants, and the two fitting mirrors share a separate reflection texture from onboarding.

`shared/shop-layout.json` supplies the main dimensions, furniture and presentation anchors to both the builder and the runtime wrapper. Babylon placement is `(18, 0, -2)` with Y rotation `-Math.PI / 2`; imported axis markers verify the handedness conversion. Shared walking bounds extend only inside the shop to town x=34. Walls, portal jambs and furniture block movement; overhead bounds constrain the camera and body clearance. The map and purchase/voice district use the expanded finite bounds. The fitting preview is at `(32.1, .067, -6.475)`, with its mirror at x=33.518. Its orbit stays within the aisle; separate turn controls retain full character inspection.

The existing shop and wardrobe flow is preserved. A short-landscape correction uses the hidden HUD's space to keep the purchase action visible beside the character while the catalogue scrolls. Outfit building, category interactions on physical displays, new thumbnails and additional clothes remain follow-on scope.

Evidence is local and stored under ignored `output/playwright/`:

- Maintained-source reopen checks verify dimensions, mirror normals, markers, applied modifiers, source/export hashes and independent GLB counts; six actual Blender views were inspected (`shop-rebuild/asset-verification.json`, `asset-capture-manifest.json`).
- `npm test`: 119 passed, four database-dependent tests skipped because plain `npm test` does not load `.env`. Frontend and compiled-server builds pass. The compiled Node 24 server imports the copied JSON layout successfully.
- `npm run test:economy` passes against an isolated schema on the local database; `npm run test:network` passes the isolated 64-client protocol regression. This verifies protocol admission and behavior, not rendering or voice capacity.
- `npm run test:shop` passes in headless WebKit: real walking through the department aisle to the expanded rear, private try-on, ambiguous purchase-response recovery and retry, separate equip, remote outfit replication, affordability, wardrobe/reload persistence and presence accrual. Purchase controls and visible previews were checked at 390×844 portrait and 844×390 landscape (`shop-mobile-portrait.png`, `shop-mobile-landscape.png`, `economy-webkit-results.json`).
- `npm run test:shop-signage` verifies both relocated plaques in the actual renderer, including visible enamel pixels and desktop/emulated phone normal/performance views (`shop-signage/results.json`).
- `npm run test:shop-render` passes in headless Chromium against the final exports: imported axes/anchors, four catalogue outfits, mirror plane, bounded lighting, geometry budgets, day/night views and desktop/phone fitting captures. The fitting orbit clears the shared walls, rails, floor and ceiling (`shop-rebuild/renderer-results.json`).

No publication or production restart was performed. Physical phone/Windows performance, public-network behavior and live voice media remain outside these checks.
