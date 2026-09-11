"""Reopen and inspect the maintained shop sources; never save over an input.
Run Blender --background --factory-startup --python-exit-code 1 --python
art-source/render_shop.py. Optional view names after --; output stays ignored.
The window pedestals are intentionally empty here; runtime owns Citizen models.
"""
import bpy
import json
import math
import sys
import hashlib
import struct
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'playwright' / 'shop-rebuild'
OUT.mkdir(parents=True, exist_ok=True)
LAYOUT = json.loads((ROOT/'shared/shop-layout.json').read_text())
NAMES = ['form-thread-shell', 'form-thread-roof', 'clothing-shop']
CACHE, REPORT = {}, {}


def verify():
    stats = json.loads((ROOT/'art-source/shop-assets.stats.json').read_text())['assets']
    for name in NAMES:
        path = ROOT/'art-source'/(name+'.blend')
        assert hashlib.sha256(path.read_bytes()).hexdigest() == stats[name]['sourceSha256']
        bpy.ops.wm.open_mainfile(filepath=str(path))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        assert len(meshes) == stats[name]['sourceMeshes']
        assert all(not obj.modifiers for obj in meshes)
        assert all(math.isfinite(v) for obj in meshes for vertex in obj.data.vertices for v in vertex.co)
        assert bpy.context.scene.unit_settings.scale_length == 1
        assert tuple(bpy.data.objects['shop-axis-depth'].location) == (0, 1, 0)
        if name == 'form-thread-shell':
            glazing = [o for o in meshes if o.name.startswith('Clear display pane')]
            assert len(glazing) == 6
            assert abs(glazing[0].data.materials[0].diffuse_color[3]-.13) < 1e-5
        if name == 'form-thread-roof':
            slab = bpy.data.objects['Complete ceiling slab']
            zmin = min((slab.matrix_world @ Vector(corner)).z for corner in slab.bound_box)
            assert abs(zmin-4.8) < 1e-5
        if name == 'clothing-shop':
            mirrors = [o for o in meshes if o.name.startswith('Fitting mirror plane')]
            assert len(mirrors) == 2
            for mirror in mirrors:
                assert mirror.data.materials[0].name == 'Shop mirror'
                assert all(abs((mirror.matrix_world @ v.co).y-LAYOUT['preview']['mirrorY']) < 1e-5 for v in mirror.data.vertices)
                assert mirror.data.polygons[0].normal.y < -.999
            for index, mannequin in enumerate(LAYOUT['mannequins']):
                p = bpy.data.objects['shop-mannequin-'+str(index+1)].location
                assert abs(p.z-mannequin['height']) < 1e-5
            assert abs(bpy.data.objects['shop-fitting-center-1'].location.z-LAYOUT['preview']['height']) < 1e-5
            for item in LAYOUT['partitions']:
                obj = bpy.data.objects[item['name']]
                assert abs(obj.dimensions.x-item['w']) < 1e-4
                assert abs(obj.dimensions.y-item['d']) < 1e-4
            assert len([o for o in bpy.context.scene.objects if o.name.startswith('shop-rail-')]) == 6
        # Verify GLB exported counts and finite accessors independently of source.
        data = (ROOT/'public/models'/(name+'.glb')).read_bytes()
        length, kind = struct.unpack_from('<II', data, 12)
        assert kind == 0x4e4f534a
        gltf = json.loads(data[20:20+length])
        triangles = sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'])
        assert triangles == stats[name]['triangles']
        assert len(gltf['meshes']) == stats[name]['runtimeMaterialMeshes']
        REPORT[name] = {'sourceSha256': stats[name]['sourceSha256'], 'exportSha256': hashlib.sha256(data).hexdigest(),
                        'editableMeshes': len(meshes), 'runtimeMeshes': len(gltf['meshes']), 'triangles': triangles,
                        'savedSourceReopened': True, 'modifiersApplied': True}
        assert REPORT[name]['exportSha256'] == stats[name]['exportSha256']
    (OUT/'asset-verification.json').write_text(json.dumps(REPORT, indent=2)+'\n')


def asset(name, pos=(0, 0, 0)):
    if name not in CACHE:
        with bpy.data.libraries.load(str(ROOT/'art-source'/(name+'.blend')), link=False) as (source, target):
            target.objects = list(source.objects)
        CACHE[name] = [o for o in target.objects if o and o.type == 'MESH']
    result = []
    transform = Matrix.Translation(pos)
    for source in CACHE[name]:
        obj = source.copy()
        obj.data = source.data
        obj.name = name+'/'+source.name
        bpy.context.collection.objects.link(obj)
        obj.matrix_world = transform @ source.matrix_basis
        result.append(obj)
    return result


def area(pos, target, power, size):
    bpy.ops.object.light_add(type='AREA', location=pos)
    obj = bpy.context.object
    obj.data.energy, obj.data.shape, obj.data.size = power, 'DISK', size
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z', 'Y').to_euler()


def camera(pos, target, ortho=None, lens=26):
    bpy.ops.object.camera_add(location=pos)
    obj = bpy.context.object
    obj.name = 'Inspection camera'
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        obj.data.type, obj.data.ortho_scale = 'ORTHO', ortho
    obj.data.lens = lens
    bpy.context.scene.camera = obj


def render(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples, scene.cycles.use_denoising = 20, True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1400, 1000, 100
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.31, .35, .34, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .42
    scene.view_settings.view_transform = 'AgX'
    shell, interior = asset('form-thread-shell'), asset('clothing-shop')
    roof = asset('form-thread-roof')
    for key, model in [('fascia', 'shop-sign'), ('tagline', 'shop-tagline')]:
        p = LAYOUT['signs'][key]
        objs = asset(model, (p['x'], p['y'], p['height']))
        if key == 'fascia':
            shell.extend(objs)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.035))
    mat = bpy.data.materials.new('Inspection ground')
    mat.diffuse_color = (.25, .28, .26, 1)
    bpy.context.object.data.materials.append(mat)
    if name in ['cutaway', 'plan']:
        for obj in roof:
            obj.hide_render = True
        if name == 'cutaway':
            for obj in shell:
                local = obj.name.split('/', 1)[-1]
                keep = local.startswith(('left shell', 'rear shell', 'Rear interior oak', 'Rear exterior stone', 'Entrance limestone threshold')) or (local.startswith('Interior side oak') and obj.location.x < 0)
                obj.hide_render = not keep
            camera((25, -28, 32), (0, 8, 1.0), 31.5)
        else:
            camera((0, 8, 32), (0, 8, 0), 28)
        area((0, 6, 18), (0, 8, 0), 3600, 18)
        area((-10, -5, 12), (0, 8, 0), 2400, 12)
    else:
        # Room-level lights supplement the authored opal fixtures for offline
        # inspection; browser lighting is verified independently by the parent.
        for x, y in [(-6, 4), (6, 4), (0, 7), (-6, 11), (6, 11), (0, 14)]:
            area((x, y, 4.45), (x, y, 0), 180, 4)
        area((0, -6, 12), (0, 5, 0), 2000, 12)
        if name == 'exterior':
            camera((22, -27, 15), (0, 6, 2.2), 33)
            area((-15, 5, 15), (0, 8, 1), 1900, 12)
        elif name == 'arrival':
            camera((0, 1.85, 1.80), (0, 12, 1.90), lens=23)
        elif name == 'fitting':
            camera((3.55, 12.50, 1.9), (4.72, 15.28, 1.5), lens=23)
        elif name == 'checkout':
            camera((-3.75, 11.8, 2.15), (-6.4, 14.6, 1.6), lens=26)
        else:
            raise ValueError('Unknown view '+name)
    scene.render.filepath = str(OUT/('asset-'+name+'.png'))
    bpy.ops.render.render(write_still=True)
    manifest_path = OUT/'asset-capture-manifest.json'
    captures = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    captures[name] = {
        'image': str(Path(scene.render.filepath).relative_to(ROOT)),
        'imageSha256': hashlib.sha256(Path(scene.render.filepath).read_bytes()).hexdigest(),
        'sources': {asset_name: hashlib.sha256((ROOT/'art-source'/(asset_name+'.blend')).read_bytes()).hexdigest()
                    for asset_name in NAMES+['shop-sign', 'shop-tagline']},
        'cameraPosition': list(scene.camera.location), 'cameraRotation': list(scene.camera.rotation_euler),
        'cameraType': scene.camera.data.type, 'lens': scene.camera.data.lens,
        'orthoScale': scene.camera.data.ortho_scale, 'resolution': [1400, 1000], 'cyclesSamples': 20,
        'hiddenObjects': [o.name for o in scene.objects if o.type == 'MESH' and o.hide_render],
    }
    manifest_path.write_text(json.dumps(captures, indent=2)+'\n')
    print('SHOP_RENDER', name, flush=True)


if __name__ == '__main__':
    verify()
    requested = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['cutaway', 'plan', 'exterior', 'arrival', 'fitting', 'checkout']
    if requested != ['verify']:
        # Leave the reopened source before assembling it as a library input.
        bpy.ops.wm.read_factory_settings(use_empty=False)
        for view in requested:
            render(view)
