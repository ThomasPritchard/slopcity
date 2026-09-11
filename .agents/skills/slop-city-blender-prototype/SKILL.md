---
name: slop-city-blender-prototype
description: Build and revise disposable Blender prototypes of Slop City buildings, interiors and world assets, with measured scale and actual rendered views for design decisions. Use when exploring spatial layouts or architectural form before production, or when refining an existing prototype.
---

# Slop City Blender prototypes

Turn the user's spatial idea into a small, editable Blender scene they can judge from actual renders. Match the amount of detail to the decision: circulation and proportions need readable architectural masses, materials and scale figures; decorative polish can follow once the arrangement works.

## Establish the current brief

- Read the applicable project instructions and inspect the working tree. Locate any existing prototype, latest user decisions and relevant game geometry before building.
- Carry approved choices forward. Revise the selected scene when the user requests a change; do not regenerate rejected alternatives or require another general interview. Compare variants only when a consequential choice remains open.
- Make routine dimensions provisional and state them. Ask only about missing requirements that would materially change the result; continue independent work while awaiting answers.
- Read `shared/world.ts` for world bounds, walls and paths; `shared/casino.ts` for game anchors; `src/world/scene.ts` for visible placement and camera behaviour; and `art-source/README.md` for asset conventions. Consult only the files relevant to the surface.
- If the requested architecture changes level heights, footprint or interactions, identify the corresponding runtime work. A Blender model alone does not change movement, authoritative collision, seating or gameplay.

## Keep the experiment separate

Work beneath `output/playwright/<study-name>/`, which is ignored by Git. A short `study.md` plus the builder, saved `.blend` and rendered images is enough for a simple study. Separate `shared/`, named variants and revision folders when that makes comparisons or continuity clearer.

Record the design question, agreed choices, provisional dimensions, coordinate convention, owned inputs/outputs and evidence limits once. Preserve an earlier reviewed source when creating a new revision. When a decision needs to survive an ignored output folder, use one relevant document under `docs/` and link to it instead of duplicating the brief across files.

Mark experimental geometry and scene/build scripts as disposable; do not copy them into production asset paths. Retain approved renders and measurements as reference evidence. Keep game exports and unrelated Blender documents intact. Do not import project builder modules without checking their top-level side effects.

## Author in Blender

Use a separate process:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python output/playwright/<study-name>/build.py
```

Resolve the installed executable if this path is unavailable. Check the tool version once for the run and record it inside the scene or result. Follow the runtime's approval mechanism if Blender cannot start in its sandbox; do not modify the user's open document or substitute another installation silently.

- Model in metres. Declare the study's axes. Existing ground sources use Blender -Y for runtime +Z; other assets may have a runtime rotation. A study may use +Y as town north for readability, but record that conversion and never assume every asset shares it.
- Reuse the last valid scene and keep unaffected geometry fixed. For a comparison, hold cameras, equipment counts, scale, materials, lighting and context constant except for the variables under review.
- Use simple recognisable proxies and 1.8 m scale figures where helpful. Label future features as placeholders; the proxy does not authorize implementing them.
- Include enough surrounding square/building context to judge fit. Clearly identify simplified context instead of presenting it as the exact existing town.
- Preserve unused materials needed after save/reopen with a fake user or an actual reference. Otherwise Blender may discard them.
- Use named cameras and a named list of roof/ceiling objects, e.g. `scene['roof_objects']`, so cuts can be reproduced without altering geometry.

## Render and inspect

Select the views that answer the question: an overall cutaway, a complete plan, an entrance view near player eye height, and a close view of the changed area are often useful. A façade change may need only street and oblique views. Keep comparison cameras matched; add a clearly identified detail camera when a revision needs it.

Use `scripts/render_views.py` to render named cameras from a saved prototype without saving over the source. It writes PNGs and a source/camera/hash manifest. Pass a JSON file containing the requested views:

```json
{
  "resolution": [1400, 1000],
  "samples": 20,
  "views": [
    {"name": "arrival", "camera": "Arrival"},
    {"name": "cutaway", "camera": "Cutaway", "hide_scene_property": "roof_objects"}
  ]
}
```

From the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python .agents/skills/slop-city-blender-prototype/scripts/render_views.py -- --scene output/playwright/<study-name>/study.blend --views output/playwright/<study-name>/views.json --output output/playwright/<study-name>/renders
```

Optional `hide_objects` and `hide_collections` lists apply to one view only. Missing camera/hide targets fail before rendering. Inputs and outputs stay within this repository's `output/playwright/` tree. The helper is a capture tool; it does not validate the design or game compatibility.

Inspect the actual images. Check that plans include the full footprint, roofs/near walls do not conceal the question, side-facing furniture faces the intended direction, and coplanar duplicate faces have not caused dark patches. For an orthographic view, account for aspect ratio: fitting the width alone can crop the top and bottom. Show the user actual images with absolute paths.

## Present substantial spatial choices

Tom endorsed the Form & Thread study and its presentation on 11 September 2026. Use that style as the preferred starting point when a spatial choice benefits from comparison:

- Build enough architectural and furnishing detail to communicate character, materials, lighting and use, while keeping study geometry disposable. Include measured scale figures and surrounding context; a bare blockout may not communicate the choice.
- When alternatives are useful, show meaningfully different arrangements with the same envelope, inventory, materials, lighting and matched cameras. Do not introduce a compulsory variant count or reopen an already selected layout.
- Present the actual Blender renders in a small local comparison page under the study directory. A shared view selector should switch all alternatives together between cutaway, full floor plan and entrance views. Show common frontage or detail views separately rather than duplicating them across every option.
- Give each option a short name and a concrete spatial trade-off. Mark the recommendation clearly, and explain it briefly. The user's preference takes precedence: Form & Thread's connected departments were selected for their character even though the open layout was recommended for visibility.
- Keep full-size images and editable source links accessible. Label provisional dimensions, roof/wall cuts, simplified context and placeholder figures. Include one useful comparison image and an absolute link to the page in the response so the user can assess the work without searching output folders.
- Check the page in a headless browser: view controls must switch every intended image and full-size link, actual images must finish loading, and desktop/narrow layouts must remain readable. Gallery checks are not game or physical-device evidence.

Scale this presentation to the decision. A focused revision can use the selected scene and a few changed views; it does not need another comparison page, variant vote or approval stage. Carry existing implementation authorization forward once the remaining design choice is resolved.

## Verify the claim and present the choice

Reopen the saved scene when verifying its actual dimensions or contents. Check meaningful invariants for the revision: for example, the retained gaming layout, right/left placement viewed from the entrance, desk facing, clear passage, or stair rise. Use source hashes when proving that an approved base or production input stayed unchanged. Check corrections; do not expand this into a full game test run for an isolated prototype.

Report the spatial result, provisional dimensions, consequential trade-offs and remaining runtime work. Label Blender renders as design evidence, and distinguish them from browser, multiplayer or physical-device proof. Ask for a specific design preference only when needed; an approved refinement needs no fresh variant vote.

For future production, author maintained assets in the project's source/export workflow and verify the affected game behaviour. Keep that implementation within the user's authorized scope.
