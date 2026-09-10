"""Original civic signpost; metres, Z up, front -Y. Run with factory-startup.

Only signpost.blend / signpost.glb are owned. The lettering is rendered with
Blender's bundled Bfont, packed into the source and embedded in the GLB.
"""
import math
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import reset, material, cube, lathe, ellipsoid, mesh, empty, select

ROOT = Path(__file__).resolve().parents[1]


def lettering_texture(*, title='TOWN SQUARE', subtitle='S L O P  C I T Y', width=4, title_size=.36, resolution_x=1536):
    """Render an original enamel face in a temporary native Blender scene."""
    source_scene = bpy.context.scene
    scene = bpy.data.scenes.new('Lettering bake')
    bpy.context.window.scene = scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.resolution_x = resolution_x
    scene.render.resolution_y = round(resolution_x / width)
    scene.render.resolution_percentage = 100
    scene.render.dither_intensity = 0
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.world = bpy.data.worlds.new('Lettering world')
    scene.world.color = (0, 0, 0)

    def ink(name, colour):
        mat = material(name, colour)
        nodes = mat.node_tree.nodes
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        emission = nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (*colour, 1)
        mat.node_tree.links.new(emission.outputs[0], output.inputs['Surface'])
        return mat

    green = ink('Bake evergreen', (.035, .075, .058))
    cream = ink('Bake warm ivory', (.81, .77, .61))
    cube('Enamel background', (0, 0, -.02), (width, 1, .01), green, 0)

    def text(body, y, size, spacing=1):
        curve = bpy.data.curves.new(body, 'FONT')
        curve.body = body
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.size = size
        curve.space_character = spacing
        curve.resolution_u = 12
        obj = bpy.data.objects.new(body, curve)
        scene.collection.objects.link(obj)
        obj.location = (0, y, .005)
        obj.data.materials.append(cream)

    text(subtitle, .29, .095)
    text(title, -.04, title_size, 1.08)
    for y in [-.34, .39]:
        cube('Fine enamel keyline', (0, y, 0), (width - .35, .009, .003), cream, 0)
    for x in [-width / 2 + .16, width / 2 - .16]:
        cube('Fine enamel keyline', (x, .025, 0), (.009, .73, .003), cream, 0)

    camera = bpy.data.cameras.new('Lettering orthographic')
    camera.type = 'ORTHO'
    camera.ortho_scale = width
    obj = bpy.data.objects.new('Lettering orthographic', camera)
    scene.collection.objects.link(obj)
    obj.location = (0, 0, 5)
    scene.camera = obj
    with tempfile.TemporaryDirectory(prefix='slop-signpost-') as folder:
        scene.render.filepath = str(Path(folder) / 'sign-face.png')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(scene.render.filepath)
        image.name = f'Original {title.lower()} enamel lettering'
        image.pack()
    bpy.context.window.scene = source_scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(scene)
    return image


def face(root, mat, side):
    # Both faces have outward winding and their own readable UV orientation.
    verts = [(-1.335, side * .056, 1.855), (1.335, side * .056, 1.855),
             (1.335, side * .056, 2.505), (-1.335, side * .056, 2.505)]
    indices = (0, 1, 2, 3) if side == -1 else (1, 0, 3, 2)
    obj = mesh('Front enamel' if side == -1 else 'Back enamel', verts, [indices], mat, root)
    uv = obj.data.uv_layers.new(name='Sign face')
    for loop, coordinate in zip(obj.data.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop.index].uv = coordinate
    return obj


def build():
    reset()
    image = lettering_texture()
    root = empty('Town square signpost')
    root['description'] = 'Original painted cast-metal post with two-sided enamel panel'
    root['units'] = 'metres'
    iron = material('Signpost evergreen powder coat', (.024, .049, .038), .48, .12)
    edge = material('Signpost aged bronze', (.28, .22, .12), .43, .72)
    steel = material('Signpost stainless fixings', (.34, .36, .33), .35, .8)
    enamel = material('Signpost enamel lettering', (1, 1, 1), .32, .05)
    node = enamel.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    enamel.node_tree.links.new(node.outputs['Color'], enamel.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

    # Cast pedestal, round shaft and domed finial: closed lathed profile.
    profile = [(0, 0), (.16, 0), (.16, .038), (.14, .055), (.13, .08),
               (.13, .14), (.105, .18), (.085, .36), (.079, .4),
               (.061, .43), (.055, .48), (.055, 2.64), (.076, 2.65),
               (.076, 2.68), (.057, 2.71), (0, 2.71)]
    lathe('Cast pedestal and post', profile, iron, 32, root)
    ellipsoid('Domed finial', (0, 0, 2.736), (.075, .075, .08), iron, root, 24, 12)
    for height in [.43, 1.66, 2.63]:
        obj = lathe('Cast collar', [(0, 0), (.066, 0), (.07, .009), (.07, .028), (.066, .035), (0, .035)], edge, 24, root)
        obj.location.z = height
    cube('Ground mounting flange', (0, 0, .018), (.38, .32, .036), iron, .025, root)
    for x in [-.137, .137]:
        for y in [-.107, .107]:
            obj = lathe('Base anchor bolt', [(0, 0), (.015, 0), (.015, .014), (0, .014)], steel, 6, root)
            obj.location = (x, y, .038)

    # A manufactured panel with a rolled perimeter and a recessed enamel face.
    cube('Rolled bronze panel rim', (0, 0, 2.18), (2.85, .095, .79), edge, .045, root)
    for side in [-1, 1]:
        cube('Inset enamel backing', (0, side * .045, 2.18), (2.78, .02, .72), iron, .034, root)
        face(root, enamel, side)
        for x in [-1.365, 1.365]:
            for z in [1.925, 2.435]:
                ellipsoid('Domed panel screw', (x, side * .06, z), (.014, .008, .014), steel, root, 12, 6)

    # Rear clamp hardware remains visible from an oblique/back view.
    for z in [1.835, 2.525]:
        cube('Rear mounting rail', (0, .093, z), (.75, .068, .078), iron, .012, root)
        cube('Clamping saddle', (0, .135, z), (.19, .028, .095), iron, .015, root)
        for x in [-.074, .074]:
            obj = lathe('Clamp hex nut', [(0, 0), (.018, 0), (.018, .022), (0, .022)], steel, 6, root)
            obj.rotation_euler.x = math.pi / 2
            obj.location = (x, .167, z)

    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    # Source keeps editable components. Merge copies by material for the export.
    bpy.context.scene.unit_settings.system = 'METRIC'
    select([root] + objects)
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 4.8
            area.spaces.active.region_3d.view_location = (0, 0, 1.4)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art-source/signpost.blend'))
    groups = {}
    for obj in objects:
        copy = obj.copy()
        copy.data = obj.data.copy()
        bpy.context.collection.objects.link(copy)
        groups.setdefault(copy.data.materials[0].name, []).append(copy)
    exported = []
    for name, group in groups.items():
        select(group)
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name
        exported.append(obj)
    select([root] + exported)
    bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/signpost.glb'),
                              export_format='GLB', use_selection=True,
                              export_animations=False, export_yup=True)
    # Reload the authored source to leave the check process on the exact saved artifact.
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'art-source/signpost.blend'))
    print('SIGNPOST SOURCE AND GLB COMPLETE', flush=True)


if __name__ == '__main__':
    build()
