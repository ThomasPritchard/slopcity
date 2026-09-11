# Meridian expansion design

10 September 2026. Production implementation authorized after approval of the revised layout B foyer.

## Accepted direction

Tom selected layout B from the Blender study: central roulette islands, card tables on either side, peripheral slot banks and room for future game types. The casino should be substantially larger, with reception at square level and steps up to the main gaming floor.

Viewed from the square looking into the building, reception belongs on the **right**, turned sideways so its customer face points inward. An **ATM alcove belongs on the left**; it is a visual placeholder now, with functionality intended for a future task. The reception area should feel naturally narrower than the gaming hall.

Keep the town square's refined stylised direction and the Meridian's limestone, evergreen and bronze vocabulary. The expanded building projects behind its current frontage. Future ATM behaviour must be designed within the existing fictional-credit economy; this study adds no wallet actions or real-money features.

## Implemented dimensions

The implementation adopts these dimensions and station counts from the approved study:

| Element | Arrangement |
| --- | --- |
| Overall envelope | 40 x 42 m; frontage at current town z=14 |
| Public foyer | Approximately 14 m wide and 8 m deep, formed by side partitions and a lower ceiling |
| Reception | Right-side desk facing inward, with space behind it |
| ATM | Recessed left-side placeholder facing inward |
| Level transition | Five 0.18 m risers, 0.48 m treads, 12 m stair width; side ramp retained |
| Gaming hall | 40 x 30 m, 0.9 m above reception |
| Playable stations | Two roulette tables, six blackjack tables, 24 slots, one craps table and one six-seat poker table |
| Rear bays | Two 11 x 7 m bays; craps occupies the left, Texas Hold’em occupies the right |

The accepted choice is the spatial direction, not every prototype furnishing or material. The narrower foyer uses enclosed side wings; their future purpose is unspecified. The central route remains open, without a reception check-in requirement.

## Design evidence

Ignored local artifacts are under `output/playwright/meridian-expansion-study/`. The original comparison remains in `variant-a/` and `variant-b/`; the selected B reception revision is in `reception-v2/`, with actual Blender renders in `reception-v2/renders/`. These paths will not exist in a fresh clone. The local study sources are disposable design evidence, not production assets.

The project skill at [slop-city-blender-prototype](../.agents/skills/slop-city-blender-prototype/SKILL.md) captures the reusable workflow. It supports focused revisions without reopening approved choices.



## Implementation contract

Shared station definitions drive server admission, collision, seats and rendering. Each roulette island owns its own rounds, wagers and history. Existing station IDs remain stable; new IDs use the same persistence contract without changing wallet or settlement schemas. Private roulette bets identify their station.

The server continues to replicate planar positions. Both peers derive elevation from the same stairs/ramp surfaces, and movement rejects unwalkable edges. The north boundary follows the enlarged venue; the square and shop stay in place. The exterior roof and separate decorative ceiling remain visible during play. Camera clearance includes the canopy, ceilings, stair portal, side doorway and chandelier, while retaining the player's requested zoom when space opens up. Cleanly authored modular Blender assets replace the monolithic kit, with reusable upgraded roulette, blackjack, slots and chairs.

The exterior adds rounded marquee corners, red neon bands, warm underside bulbs and illuminated entrance columns, following Tom's supplied glamour-lighting reference. Eight bulb groups chase around the perimeter and three neon bands brighten sequentially on a four-second phrase anchored to the town's server-synchronised clock. Reduced motion keeps all groups steady. Emissive meshes carry the animation; the two paving lights and interior fill lights remain steady. The ATM remains a labelled future amenity.

The direct refinement requested after the expansion adds ivory and bronze ceiling coffers, warm coves and a central sunburst medallion over a four-tier chandelier at town `(0, 38)`. Its lowest pendant is 5.15 m above square level, leaving 4.25 m above the gaming floor. The foyer side walls continue to the top of the stairs, with enclosed stair sides and a portal whose underside is 3.8 m high. A framed side doorway at `x=7, z=20.7–22.3` preserves the ramp route. The hall ceiling opens up to approximately 8 m. These refinements use maintained Blender sources directly; no further prototype approval stage applies.

Validation covers shared traversal, independent roulette rounds/private bets, expanded station admission, existing casino persistence/network regressions, and headless desktop/mobile views with actual gameplay and asset inspection. No release or live-server restart is included.

## Verification

Implementation and dated verification are recorded in [implementation status](implementation-status.md#meridian-expansion--2026-09-10). Maintained asset contracts and regeneration commands are in [art-source/README.md](../art-source/README.md). Runtime captures and Blender inspection renders live in ignored `output/playwright/casino-expansion/`; the files distinguish `production-*` Blender renders from browser captures. `npm run test:casino-expansion` exercises the actual renderer and exports using synthetic game/player snapshots; the separate casino browser/network journeys exercise authoritative gameplay.
