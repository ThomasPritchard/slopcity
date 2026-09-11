"""Generate a distant-crowd citizen without modifying the authored Blender source.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art-source/build_citizen_lod.py
"""
import hashlib
import json
from pathlib import Path
import struct

import bpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art-source/citizen.blend'
ORIGINAL = ROOT / 'public/models/citizen.glb'
OUTPUT = ROOT / 'public/models/citizen-lod.glb'
STATS = ROOT / 'art-source/citizen-lod.stats.json'


def inspect_glb(path):
    data = path.read_bytes()
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4E4F534A, 'Expected glTF JSON chunk'
    doc = json.loads(data[20:20 + length])
    accessors = doc['accessors']
    meshes = doc['meshes']
    return {
        'bytes': len(data),
        'triangles': sum(accessors[p['indices']]['count'] // 3 for mesh in meshes for p in mesh['primitives']),
        'vertices': sum(accessors[p['attributes']['POSITION']]['count'] for mesh in meshes for p in mesh['primitives']),
        'mesh_count': len(meshes),
        'materials': sorted(m['name'] for m in doc['materials']),
        'nodes': sorted(n['name'] for n in doc['nodes']),
        'animations': sorted(a['name'] for a in doc['animations']),
        'animation_channels': {a['name']: len(a['channels']) for a in doc['animations']},
        'animation_durations': {a['name']: round(max(accessors[s['input']]['max'][0] for s in a['samplers'])
            - min(accessors[s['input']]['min'][0] for s in a['samplers']), 6) for a in doc['animations']},
        'skins': [[doc['nodes'][index]['name'] for index in skin['joints']] for skin in doc['skins']],
        'all_primitives_skinned': all('JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes'] for mesh in meshes for p in mesh['primitives']),
    }


source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
assert len(rigs) == 1, 'Expected one citizen skeleton'
rig = rigs[0]
# Decimate the undeformed mesh, retaining its vertex groups. Restore the armature
# modifier afterward so export still emits skin weights and animation channels.
rig.data.pose_position = 'REST'
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
reductions = []
for obj in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    material = obj.data.materials[0].name.lower()
    ratio = .22 if material.startswith('wear_') else .32
    if any(part in material for part in ('eye', 'iris', 'pupil')):
        ratio = .5
    before = len(obj.data.polygons)
    armatures = [mod for mod in obj.modifiers if mod.type == 'ARMATURE']
    assert len(armatures) == 1, f'Missing deformation modifier: {obj.name}'
    obj.modifiers.remove(armatures[0])
    decimate = obj.modifiers.new('Distant crowd reduction', 'DECIMATE')
    decimate.ratio = ratio
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    # Collapse can leave degenerate loops in disconnected ribbing details.
    obj.data.validate(clean_customdata=False)
    obj.data.update()
    deform = obj.modifiers.new('Citizen deformation', 'ARMATURE')
    deform.object = rig
    reductions.append({'object': obj.name, 'material': material, 'ratio': ratio, 'polygons_before': before, 'triangles_after': len(obj.data.polygons)})
rig.data.pose_position = 'POSE'
bpy.ops.object.select_all(action='DESELECT')
for obj in [rig] + meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
    export_animations=True, export_yup=True, export_apply=False)
original, lod = inspect_glb(ORIGINAL), inspect_glb(OUTPUT)
for key in ('mesh_count', 'materials', 'nodes', 'animations', 'animation_channels', 'animation_durations', 'skins', 'all_primitives_skinned'):
    assert original[key] == lod[key], f'LOD changed character contract: {key}'
assert lod['animations'] == ['HandshakeA', 'HandshakeB', 'HugA', 'HugB', 'Idle', 'Jump', 'Run', 'Sit', 'Walk', 'Wave']
assert lod['animation_durations'] == {'HandshakeA': 3.2, 'HandshakeB': 3.2, 'HugA': 3.6, 'HugB': 3.6,
    'Idle': 2., 'Jump': .6, 'Run': .6, 'Sit': 2., 'Walk': 1., 'Wave': 2.8}
assert lod['all_primitives_skinned']
retained = lod['triangles'] / original['triangles']
assert .20 <= retained <= .30, f'Unexpected triangle retention: {retained}'
assert source_hash == hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'Source changed'
STATS.write_text(json.dumps({'source_sha256': source_hash, 'original': original, 'lod': lod,
    'triangle_retention': retained, 'reductions': reductions}, indent=2) + '\n')
print(f'LOD VERIFIED: {original["triangles"]} -> {lod["triangles"]} triangles ({retained:.1%}); {lod["bytes"]} bytes', flush=True)
