"""Render saved disposable prototypes without modifying their .blend source.

Run inside Blender with --python-exit-code 1; see the adjacent skill instructions.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import bpy


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_root():
    # Locate a checkout, including when exercising a staged copy of this helper.
    for parent in Path(__file__).resolve().parents:
        if (parent / 'package.json').is_file() and (parent / 'shared/world.ts').is_file():
            return parent
    raise ValueError('Run this helper from a Slop City checkout.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', required=True, type=Path)
    parser.add_argument('--views', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    allowed = (project_root() / 'output/playwright').resolve()
    for path in [args.scene, args.views, args.output]:
        if not path.resolve().is_relative_to(allowed):
            raise ValueError(f'Path must stay beneath {allowed}: {path}')
    if args.scene.suffix != '.blend' or not args.scene.is_file():
        raise ValueError('The source must be an existing .blend prototype.')
    spec = json.loads(args.views.read_text())
    resolution = spec.get('resolution', [1400, 1000])
    samples = spec.get('samples', 20)
    views = spec['views']
    if len(resolution) != 2 or any(type(v) is not int or not 64 <= v <= 8192 for v in resolution):
        raise ValueError('Resolution must contain two integer dimensions between 64 and 8192.')
    if type(samples) is not int or not 1 <= samples <= 4096 or not isinstance(views, list) or not views:
        raise ValueError('Provide a nonempty views list and a valid sample count.')
    source_hash = sha256(args.scene)
    bpy.ops.wm.open_mainfile(filepath=str(args.scene.resolve()))
    scene = bpy.context.scene
    prepared = []
    names = set()
    for view in views:
        name = view['name']
        if not isinstance(name, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', name) or name in names:
            raise ValueError('View names must be unique simple file names.')
        names.add(name)
        camera = scene.objects.get(view['camera'])
        if camera is None or camera.type != 'CAMERA':
            raise ValueError(f'Missing camera: {view["camera"]}')
        hidden_names = list(view.get('hide_objects', []))
        if view.get('hide_scene_property'):
            hidden_names += list(scene[view['hide_scene_property']])
        hidden = [scene.objects[name] for name in hidden_names]
        collections = [bpy.data.collections[name] for name in view.get('hide_collections', [])]
        prepared.append((view, camera, hidden, collections))
    # Validate all views before creating any output.
    args.output.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.use_file_extension = True
    if scene.render.engine == 'CYCLES':
        scene.cycles.samples = samples
    manifest = {'source': str(args.scene.resolve()), 'source_sha256': source_hash,
                'blender': bpy.app.version_string, 'build': bpy.app.build_hash.decode(),
                'engine': scene.render.engine, 'resolution': resolution,
                'cycles_samples': scene.cycles.samples if scene.render.engine == 'CYCLES' else None,
                'runtime_tested': False, 'views': []}
    for view, camera, hidden, collections in prepared:
        states = [(item, item.hide_render) for item in [*hidden, *collections]]
        try:
            for item, _ in states:
                item.hide_render = True
            scene.camera = camera
            output = args.output / f'{view["name"]}.png'
            scene.render.filepath = str(output.resolve())
            print('RENDER', view['name'], flush=True)
            bpy.ops.render.render(write_still=True)
            manifest['views'].append({'name': view['name'], 'file': output.name,
                'sha256': sha256(output), 'bytes': output.stat().st_size,
                'camera': camera.name, 'matrix_world': [list(row) for row in camera.matrix_world],
                'type': camera.data.type, 'lens': camera.data.lens, 'ortho_scale': camera.data.ortho_scale,
                'hidden_objects': [item.name for item in hidden],
                'hidden_collections': [item.name for item in collections]})
        finally:
            for item, state in reversed(states):
                item.hide_render = state
    if sha256(args.scene) != source_hash:
        raise RuntimeError('Prototype source changed during capture.')
    (args.output / 'capture-manifest.json').write_text(json.dumps(manifest, indent=2))
    print('CAPTURE COMPLETE', len(prepared), 'views; source unchanged', flush=True)


if __name__ == '__main__':
    main()
