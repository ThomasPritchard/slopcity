# Original Slop City assets

Authored in Blender 5.2.1 LTS through the included Python scripts. These meshes, materials, rig, animations, HDR lighting and ripple normals were created for this project; no downloaded character or environment asset pack is used.

The character direction is deliberately endearing: the original fixed, wide-eyed stare and a neutral mouth. Keep that identity while improving clothing and environmental detail.

- `citizen.blend`: rigged citizen, modular jackets/knitwear, trousers, sneakers/boots/loafers; Idle, Walk, Wave and Sit clips. `clothing.py` supplies the additional garments.
- `street-kit.blend`: fountain, bench, lamp, planter and olive tree, staged apart for inspection.
- `changing-room.blend`: room, timber floor/slats, mirror, lighting strips, curtains, rail, stool and platform.
- `clothing-shop.blend`: timber interior, clothing rails/hangers, folded stock, checkout, paper bags, shoe display and fitting alcove.
- `casino-kit.blend`: walnut/brass roulette and blackjack tables, ten blackjack chairs, six slot cabinets/stools, lounge chairs, carpet and wall lighting.
- `roulette-wheel.blend`: separate numbered 37-pocket rotor, spindle and dividers for runtime animation.
- `build_citizen_lod.py`: derives `citizen-lod.glb` from the unchanged citizen source; `citizen-lod.stats.json` records mesh/rig/animation checks and triangle reduction.
- `../public/models/*.glb`: runtime exports.
- `../public/textures/`: original generated lighting environment and water normal map.

Regenerate from the repository root with a separate background Blender process:

```sh
blender --background --factory-startup --python art-source/build_assets.py
blender --background --factory-startup --python art-source/build_environment.py
blender --background --factory-startup --python art-source/build_textures.py
blender --background --factory-startup --python art-source/build_shop.py
blender --background --factory-startup --python art-source/build_casino.py
blender --background --factory-startup --python art-source/build_citizen_lod.py
```

On this Mac the executable is `/Applications/Blender.app/Contents/MacOS/Blender`. Factory startup and owned output paths preserve any unrelated document open in Blender's UI. The optional `render_character.py` produces an offline character inspection image under `output/playwright/`.

Models are exported in metres. Babylon's glTF handedness conversion means the studio and front-facing preview are rotated by pi around Y. Runtime animation and water rendering belong to the browser integration. The sources are intentionally editable; a rigged crowd LOD is included; texture atlases and a broader face/body/clothing catalogue remain future work.
