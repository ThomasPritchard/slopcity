"""Build only the maintained six-seat Meridian poker table, in metres.

Run in a separate Blender --background --factory-startup process. Imported casino
helpers have guarded entry points; no other assets or registries are regenerated.
The floor-origin source maps Blender (x, y, z) to town (x, z, y) after runtime's
root rotation of pi. Optional --render writes disposable inspection views.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_casino as casino
from mathutils import Vector

bpy = casino.bpy
NAME = 'poker-table'
FELT_Z = 1.10
CARD_Z = 1.107
FELT_OUTLINE = (4.44, 2.32, .95)
SEATS = [(0, -1.95), (-2.45, -1.1), (-2.45, 1.1), (0, 1.95), (2.45, 1.1), (2.45, -1.1)]
INSPECTION = casino.ROOT/'output/playwright/poker-assets'


def profiled_ring(name, profiles, mat, smooth=True):
    """Hollow rounded ring from a closed radial cross section."""
    loops = [casino.rounded(w, d, radius, 16) for w, d, radius, z in profiles]
    n = len(loops[0])
    verts = [(x, y, profile[3]) for profile, loop in zip(profiles, loops) for x, y in loop]
    faces = []
    for row in range(len(loops)):
        nxt = (row+1) % len(loops)
        for i in range(n):
            j = (i+1) % n
            faces.append((row*n+i, row*n+j, nxt*n+j, nxt*n+i))
    obj = casino.mesh(name, verts, faces, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def ink(label, x, y, size, heading=0):
    data = bpy.data.curves.new(label, 'FONT')
    data.body = label
    data.align_x = data.align_y = 'CENTER'
    data.size = size
    data.extrude = 0
    data.resolution_u = 3
    obj = bpy.data.objects.new('Printed '+label, data)
    bpy.context.collection.objects.link(obj)
    obj.location = (x, y, FELT_Z+.001)
    obj.rotation_euler.z = heading
    data.materials.append(casino.ivory)
    casino.select([obj])
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def printed_outline(name, w, d, radius, x, y, line=.003):
    outer = casino.rounded(w, d, radius, 6, x=x, y=y)
    inner = casino.rounded(w-2*line, d-2*line, radius-line, 6, x=x, y=y)
    n = len(outer)
    verts = [(px, py, FELT_Z+.001) for points in [outer, inner] for px, py in points]
    return casino.mesh(name, verts, [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)], casino.ivory)


def in_rounded(x, y, width, depth, radius, margin=0):
    width -= 2*margin
    depth -= 2*margin
    radius -= margin
    if abs(x) > width/2 or abs(y) > depth/2:
        return False
    return math.hypot(max(0, abs(x)-(width/2-radius)), max(0, abs(y)-(depth/2-radius))) <= radius


def rail_position(seat):
    x, y = SEATS[seat]
    low, high = 0, 1
    for _ in range(40):
        mid = (low+high)/2
        if in_rounded(x*mid, y*mid, 4.62, 2.52, 1.04):
            low = mid
        else:
            high = mid
    return x*low, y*low


def hole_card(seat, card):
    """Mirrors shared/pokerLayout.ts including the north/south clearance fix."""
    x, y = SEATS[seat]
    heading = math.atan2(-x, -y)
    radius = .46 if seat in [0, 3] else .62
    offset = (card-.5)*.27
    return x*radius+math.cos(heading)*offset, y*radius-math.sin(heading)*offset, heading


def cupholder(rail, seat):
    x, y = rail_position(seat)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.067, depth=.30, location=(x, y, 1.17))
    cutter = bpy.context.object
    cutter.name = 'Temporary cupholder cutting tool'
    mod = rail.modifiers.new('Recessed cupholder '+str(seat+1), 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    casino.select([rail])
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    cup = casino.lathe('Cupholder dark recessed lining '+str(seat+1),
                       [(0, 1.127), (.052, 1.127), (.060, 1.142), (.063, 1.192),
                        (.063, 1.196), (.059, 1.196), (.056, 1.146), (.049, 1.132), (0, 1.132)], casino.black, 32)
    cup.location = (x, y, 0)
    casino.ring('Cupholder bronze rolled lip '+str(seat+1), x, y, 1.196, .063, .003, casino.bronze, 32)
    casino.marker('cupholder-'+str(seat), (x, y, 1.196))


def build():
    casino.start()
    bpy.context.scene['asset_contract'] = 'Six seats; 4.8 x 2.7 m; felt 1.10 m; rail 1.20 m; runtime game pieces'
    for x in [-1.23, 1.23]:
        casino.prism('Bronze poker trestle shoe', casino.rounded(.76, 1.36, .25, 12, x=x), 0, .09, casino.bronze, .017)
        casino.loft('Sculpted walnut poker trestle', [(x, 0, .07, .31, .56), (x, 0, .18, .28, .52),
                    (x, 0, .61, .21, .40), (x, 0, .84, .30, .57), (x, 0, .92, .37, .63)], casino.wood, 40)
        casino.loft('Bronze poker trestle collar', [(x, 0, .81, .287, .545), (x, 0, .84, .303, .575)], casino.bronze, 40)
    casino.cube('Walnut poker under-table stretcher', (0, 0, .37), (2.46, .20, .19), casino.wood, .035)
    casino.rim('Continuous bronze player footrest', casino.rounded(4.10, 1.88, .81, 16), .265, .024, casino.bronze, sides=10)
    for x in [-1.22, 1.22]:
        for side in [-1, 1]:
            casino.tube('Swept poker footrail bracket', [(x, side*.48, .31), (x, side*.81, .22), (x, side*.94, .265)], .020, casino.bronze, sides=8)

    casino.prism('Rounded walnut poker table foundation', casino.rounded(4.59, 2.49, .99, 16), .875, 1.077, casino.wood, .018)
    profiled_ring('Rounded walnut poker apron', [(4.46, 2.36, .935, .875), (4.61, 2.51, 1.01, .945),
                  (4.64, 2.54, 1.025, 1.095), (4.40, 2.30, .905, 1.095), (4.40, 2.30, .905, .925)], casino.wood)
    for z, w, d, r in [(.912, 4.55, 2.45, .98), (1.075, 4.641, 2.541, 1.025)]:
        casino.rim('Poker apron bronze reveal', casino.rounded(w, d, r, 16), z, .009, casino.bronze, sides=6)
    casino.prism('Flat rich evergreen poker felt', casino.rounded(*FELT_OUTLINE, 16), 1.071, FELT_Z, casino.felt)
    rail = profiled_ring('Soft rounded evergreen poker rail', [(4.66, 2.56, 1.03, 1.077),
                  (4.77, 2.67, 1.085, 1.11), (4.80, 2.70, 1.10, 1.15),
                  (4.75, 2.65, 1.075, 1.185), (4.68, 2.58, 1.04, 1.20),
                  (4.56, 2.46, .99, 1.20), (4.47, 2.37, .96, 1.18),
                  (4.44, 2.32, .95, 1.14), (4.44, 2.32, .95, 1.091)], casino.leather)
    for seat in range(6):
        cupholder(rail, seat)
    # Boolean cutters can add unused material slots. Keep the editable rail in
    # the single-material batching contract used by the casino export helper.
    rail.data.materials.clear()
    rail.data.materials.append(casino.leather)
    for polygon in rail.data.polygons:
        polygon.material_index = 0
    casino.rim('Poker rail outer tailored welt', casino.rounded(4.775, 2.675, 1.0875, 16), 1.163, .0025, casino.bronze, sides=5)

    for index, x in enumerate([-.60, -.30, 0, .30, .60]):
        printed_outline('Community card outline '+str(index+1), .282, .402, .018, x, 0)
        casino.marker('community-card-'+str(index), (x, 0, CARD_Z))
    ink('T H E  M E R I D I A N', 0, .47, .071)
    ink("T E X A S  H O L D ' E M", 0, -.43, .061)
    for x in [-.68, .68]:
        obj = casino.cube('Small poker felt diamond', (x, -.43, FELT_Z+.0005), (.026, .026, .001), casino.ivory, 0)
        obj.rotation_euler.z = math.pi/4
    # Two restrained front plaques retain the table's identity at seated height.
    casino.text('M E R I D I A N', (0, -1.258, .981), .090, casino.bronze)
    casino.text('M E R I D I A N', (0, 1.258, .981), .090, casino.bronze, heading=math.pi)
    casino.marker('felt-origin', (0, 0, FELT_Z))
    for seat in range(6):
        for card in range(2):
            x, y, heading = hole_card(seat, card)
            marker = casino.marker('hole-seat-'+str(seat)+'-card-'+str(card), (x, y, CARD_Z))
            marker.rotation_euler.z = -heading

    validate_source()
    casino.finish(NAME)
    stats = casino.STATS[NAME]
    assert stats['triangles'] < 25000, stats
    assert stats['runtimeMaterialMeshes'] <= 6, stats
    stats['contract'] = {'outerWidth': 4.8, 'outerDepth': 2.7, 'feltHeight': FELT_Z,
                         'railHeight': 1.20, 'cardHeight': CARD_Z, 'cardWidth': .26,
                         'cardDepth': .38, 'feltRoundedOutline': list(FELT_OUTLINE),
                         'seats': 6, 'chairsInExport': False, 'staticGamePieces': False,
                         'sourceValidated': True}
    (casino.SOURCE/'poker-assets.stats.json').write_text(json.dumps({NAME: stats}, indent=2)+'\n')
    bpy.ops.wm.open_mainfile(filepath=str(casino.SOURCE/(NAME+'.blend')))
    assert not bpy.data.is_dirty


def validate_source():
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    assert all(len(o.data.materials) == 1 for o in meshes), 'Every mesh must participate in export batching'
    vertices = [o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    assert all(math.isfinite(c) for p in vertices for c in p)
    low = [min(p[i] for p in vertices) for i in range(3)]
    high = [max(p[i] for p in vertices) for i in range(3)]
    assert all(abs(a-b) < .00001 for a, b in zip(low, [-2.4, -1.35, 0])), low
    assert all(abs(a-b) < .00001 for a, b in zip(high, [2.4, 1.35, 1.2])), high
    felt = bpy.data.objects['Flat rich evergreen poker felt']
    assert abs(max(v.co.z for v in felt.data.vertices)-FELT_Z) < .00001
    for seat in range(6):
        for card in range(2):
            x, y, heading = hole_card(seat, card)
            for dx in [-.13, .13]:
                for dy in [-.19, .19]:
                    px = x+math.cos(heading)*dx+math.sin(heading)*dy
                    py = y-math.sin(heading)*dx+math.cos(heading)*dy
                    assert in_rounded(px, py, *FELT_OUTLINE, margin=.01), (seat, card, px, py)
    assert (bpy.data.objects['felt-origin'].location-Vector((0, 0, FELT_Z))).length < .00001
    print('POKER_SOURCE_VALIDATED', json.dumps({'min': low, 'max': high, 'finite': True,
          'holeCardCornersInsideFelt': True, 'holeCardEdgeMarginMinimum': .01}), flush=True)


def render_inspection():
    import render_casino as render
    render.OUT = INSPECTION
    INSPECTION.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.world = bpy.data.worlds.new('Poker inspection world')
    scene = render.reset()
    render.backdrop()
    render.asset(NAME)
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.cycles.samples = 32
    render.camera((6.2, -7.7, 7.3), (0, 0, .62), 6.6)
    render.area((1, -4, 7), (0, 0, .6), 1150, 5)
    render.area((-4, 3, 6), (0, 0, .6), 950, 4)
    render.render('poker-table-perspective')
    render.camera((0, 0, 9), (0, 0, 0), 5.8)
    render.render('poker-table-layout')
    for x, y in SEATS:
        render.asset('casino-chair', (x, y, 0), -math.atan2(-x, -y))
    render.camera((6.2, -7.7, 7.8), (0, 0, .62), 7.8)
    render.render('poker-six-seat-context')
    # Import the actual runtime export once as well, so material batching and
    # source-only geometry cannot silently differ from the inspected model.
    scene = render.reset()
    render.backdrop()
    bpy.ops.import_scene.gltf(filepath=str(casino.OUT/(NAME+'.glb')))
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.cycles.samples = 32
    render.camera((6.2, -7.7, 7.3), (0, 0, .62), 6.6)
    render.area((1, -4, 7), (0, 0, .6), 1150, 5)
    render.area((-4, 3, 6), (0, 0, .6), 950, 4)
    render.render('poker-table-export')
    bpy.ops.wm.open_mainfile(filepath=str(casino.SOURCE/(NAME+'.blend')))
    assert not bpy.data.is_dirty
    print('POKER_SOURCE_RELOADED_CLEAN', flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if any(arg != '--render' for arg in args):
        raise ValueError('Only --render is supported')
    build()
    if '--render' in args:
        render_inspection()
