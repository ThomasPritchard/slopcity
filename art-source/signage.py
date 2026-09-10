"""Shared enamel plaque authoring, matching the approved town-square signpost.

Run in background Blender with factory startup. Each plaque has its own editable
source and self-contained GLB, centred at the origin, front -Y, Z up, metres.
"""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import reset, material, cube, ellipsoid, mesh, empty, select, lathe
from build_signpost import lettering_texture

ROOT = Path(__file__).resolve().parents[1]


def build_plaque(name, title, subtitle, width, height, title_size, mounting_depth, *,
                 hanging_drop=0, two_sided=False):
    reset()
    bpy.data.orphans_purge(do_recursive=True)
    face_width, face_height = width - .18, height - .14
    image = lettering_texture(title=title, subtitle=subtitle, width=face_width / face_height,
                              title_size=title_size, resolution_x=2048)
    root = empty(name)
    root['description'] = ('Original hanging enamel plaque' if hanging_drop else 'Original wall-mounted enamel plaque') + '; matches town-square signpost'
    finish = name.split('-')[0].capitalize() + ' signage'
    root['units'] = 'metres'
    # Same finish values as the approved signpost, including painted rather than bare metal.
    iron = material(f'{finish} evergreen powder coat', (.024, .049, .038), .48, .12)
    bronze = material(f'{finish} aged bronze', (.28, .22, .12), .43, .72)
    steel = material(f'{finish} stainless fixings', (.34, .36, .33), .35, .8)
    enamel = material(f'{name} enamel lettering', (1, 1, 1), .32, .05)
    node = enamel.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    enamel.node_tree.links.new(node.outputs['Color'], enamel.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

    cube('Rolled bronze perimeter', (0, 0, 0), (width, .10, height), bronze, .045, root)
    cube('Rear painted casing', (0, .048, 0), (width - .06, .018, height - .06), iron, .033, root)
    cube('Recessed enamel backing', (0, -.048, 0), (width - .06, .018, height - .06), iron, .033, root)
    for side in [-1, 1] if two_sided else [-1]:
        # Mirrored world X on the reverse face keeps the lettering readable from behind.
        vertices = [(-face_width / 2 * -side, .058 * side, -face_height / 2),
                    (face_width / 2 * -side, .058 * side, -face_height / 2),
                    (face_width / 2 * -side, .058 * side, face_height / 2),
                    (-face_width / 2 * -side, .058 * side, face_height / 2)]
        face = mesh('Readable enamel face' if side == -1 else 'Reverse enamel face',
                    vertices, [(0, 1, 2, 3)], enamel, root)
        uv = face.data.uv_layers.new(name='Enamel face')
        for loop, coordinate in zip(face.data.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            uv.data[loop.index].uv = coordinate
        for x in [-width / 2 + .065, width / 2 - .065]:
            for z in [-height / 2 + .15, height / 2 - .15]:
                ellipsoid('Domed face screw', (x, .061 * side, z), (.015, .008, .015), steel, root, 12, 6)
    if hanging_drop:
        top = height / 2
        for x in [-width / 3, width / 3]:
            rod = lathe('Bronze hanging stem', [(0, top - .025), (.014, top - .025),
                        (.014, top + hanging_drop - .01), (0, top + hanging_drop - .01)],
                        bronze, segments=12, parent=root)
            rod.location.x = x
            cube('Stem collar', (x, 0, top + .018), (.09, .09, .04), bronze, .012, root)
            cube('Canopy fixing plate', (x, 0, top + hanging_drop - .01), (.16, .13, .02), iron, .008, root)
            for dx in [-.052, .052]:
                ellipsoid('Canopy fixing screw', (x + dx, 0, top + hanging_drop - .023),
                          (.009, .009, .005), steel, root, 12, 6)
    else:
        for x in [-width / 2 + .42, width / 2 - .42]:
            for z in [-height / 2 + .15, height / 2 - .15]:
                cube('Wall standoff', (x, .052 + mounting_depth / 2, z),
                     (.14, mounting_depth, .12), iron, min(.012, mounting_depth / 3), root)
                cube('Wall fixing tab', (x, .052 + mounting_depth, z), (.22, .014, .16), iron, .01, root)

    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.context.scene.unit_settings.system = 'METRIC'
    select([root] + objects)
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_location = (0, 0, 0)
            area.spaces.active.region_3d.view_distance = width * 1.3
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / f'art-source/{name}.blend'))

    groups = {}
    for obj in objects:
        copy = obj.copy()
        copy.data = obj.data.copy()
        bpy.context.collection.objects.link(copy)
        groups.setdefault(copy.data.materials[0].name, []).append(copy)
    exported = []
    for material_name, group in groups.items():
        select(group)
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = material_name
        exported.append(obj)
    select([root] + exported)
    bpy.ops.export_scene.gltf(filepath=str(ROOT / f'public/models/{name}.glb'),
                              export_format='GLB', use_selection=True,
                              export_animations=False, export_yup=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / f'art-source/{name}.blend'))
    print(f'COMPLETE {name}', flush=True)
