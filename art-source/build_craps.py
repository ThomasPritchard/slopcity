"""Build only the maintained Meridian craps table, in metres with a floor origin.

Run in a separate Blender --background --factory-startup process. Importing the
casino helpers does not invoke their builders or write the shared asset registry.
Blender (x, y, z) maps to town (x, z, y) after the runtime root rotation of pi.
Optional --render produces source inspection views under ignored output/playwright.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_casino as casino
from mathutils import Vector

bpy = casino.bpy
NAME = 'craps-table'
FELT_Z = 1.04
POINTS = list(zip([-1.5, -.9, -.3, .3, .9, 1.5], [4, 5, 6, 8, 9, 10]))
INSPECTION = casino.ROOT / 'output/playwright/craps'


def profiled_ring(name, profiles, mat, smooth=True):
    """Closed rounded ring from an ordered radial cross section; no filled top."""
    loops = [casino.rounded(w, d, r, 12) for w, d, r, z in profiles]
    n = len(loops[0])
    verts = [(x, y, profile[3]) for profile, loop in zip(profiles, loops) for x, y in loop]
    faces = []
    for row in range(len(loops)):
        nxt = (row + 1) % len(loops)
        for i in range(n):
            j = (i + 1) % n
            faces.append((row*n+i, row*n+j, nxt*n+j, nxt*n+i))
    obj = casino.mesh(name, verts, faces, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def ink(label, x, y, size, heading=0):
    # Printed markings have no relief that could visually obstruct a rolling die.
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


def printed_outline(name, w, d, radius, x, y, width=.005):
    outer = casino.rounded(w, d, radius, 8, x=x, y=y)
    inner = casino.rounded(w-2*width, d-2*width, max(.005, radius-width), 8, x=x, y=y)
    n = len(outer)
    verts = [(px, py, FELT_Z+.001) for outline in [outer, inner] for px, py in outline]
    return casino.mesh(name, verts, [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)], casino.ivory)


def rebound_diamonds():
    """One economical mesh of low relief rubber pyramids, clear of the race."""
    verts = []
    faces = []

    def diamond(cx, cy, cz, tangent, inward):
        start = len(verts)
        # A closed base is unnecessary on the opaque inner wall.
        verts.extend([(cx-tangent[0]*.028, cy-tangent[1]*.028, cz),
                      (cx, cy, cz-.031),
                      (cx+tangent[0]*.028, cy+tangent[1]*.028, cz),
                      (cx, cy, cz+.031),
                      (cx+inward[0]*.018, cy+inward[1]*.018, cz)])
        for i in range(4):
            faces.append((start+i, start+(i+1)%4, start+4))

    for side in [-1, 1]:
        for row, z in enumerate([1.083, 1.15]):
            for i in range(77):
                diamond(-2.375+i*.062+(row%2)*.015, side*1.101, z, (side, 0), (0, -side))
            for i in range(28):
                diamond(side*2.548, -.85+i*.062+(row%2)*.015, z, (0, -side), (-side, 0))
    obj = casino.mesh('Sculpted diamond rubber rebound walls', verts, faces, casino.leather)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def build():
    casino.start()
    bpy.context.scene['asset_contract'] = '5.6 x 2.7 m; felt 1.04 m; rail <= 1.30 m; no static game pieces'
    for x in [-1.66, 1.66]:
        casino.prism('Bronze trestle shoe', casino.rounded(.82, 1.54, .24, x=x), 0, .095, casino.bronze, .018)
        casino.loft('Shaped walnut trestle', [(x, 0, .08, .35, .65), (x, 0, .18, .31, .58),
                    (x, 0, .58, .23, .46), (x, 0, .82, .34, .65), (x, 0, .94, .40, .72)], casino.wood, 40)
        casino.loft('Bronze trestle collar', [(x, 0, .785, .325, .628), (x, 0, .81, .339, .65)], casino.bronze, 40)
    casino.cube('Walnut under-table stretcher', (0, 0, .37), (3.34, .18, .19), casino.wood, .036)
    for x in [-1.67, 1.67]:
        casino.tube('Swept foot rail bracket', [(x, -.53, .28), (x, -.98, .19), (x, -1.11, .24)], .024, casino.bronze, sides=8)
    casino.tube('Player bronze footrest', [(-2.20, -1.11, .255), (2.20, -1.11, .255)], .029, casino.bronze, sides=12)

    casino.prism('Walnut table foundation', casino.rounded(5.40, 2.50, .32, 12), .855, 1.022, casino.wood, .018)
    profiled_ring('Shaped walnut apron', [(5.36, 2.46, .30, .84), (5.49, 2.59, .36, .91),
                  (5.49, 2.59, .36, 1.19), (5.13, 2.23, .17, 1.19), (5.13, 2.23, .17, .91)], casino.wood)
    for z in [.885, 1.158]:
        casino.rim('Apron bronze reveal', casino.rounded(5.496, 2.596, .36, 12), z, .010, casino.bronze, sides=6)
    casino.prism('Flat evergreen craps felt', casino.rounded(5.14, 2.24, .16, 12), 1.018, FELT_Z, casino.felt)
    profiled_ring('Evergreen rubber inner rebound wall', [(5.106, 2.206, .143, FELT_Z),
                  (5.106, 2.206, .143, 1.215), (5.16, 2.26, .17, 1.22), (5.16, 2.26, .17, FELT_Z)], casino.leather)
    rebound_diamonds()
    profiled_ring('Rounded padded evergreen rail', [(5.52, 2.62, .38, 1.18),
                  (5.59, 2.69, .40, 1.215), (5.60, 2.70, .405, 1.25),
                  (5.57, 2.67, .395, 1.28), (5.49, 2.59, .365, 1.30),
                  (5.35, 2.45, .295, 1.30), (5.22, 2.32, .225, 1.28),
                  (5.12, 2.22, .155, 1.245), (5.106, 2.206, .143, 1.205)], casino.leather)
    casino.rim('Padded rail tailored welt', casino.rounded(5.47, 2.57, .355, 12), 1.297, .0028, casino.bronze, sides=5)

    # Only these two outlined areas are bets. Numbers above are point indicators.
    printed_outline('Pass line printed field', 4.38, .19, .070, 0, -.68)
    printed_outline('Dont pass printed field', 4.38, .19, .070, 0, -.88)
    ink('PASS LINE', 0, -.68, .132)
    ink("DON'T PASS / BAR 12", 0, -.88, .109)
    for y in [-.68, -.88]:
        ink('1:1', -1.86, y, .078)
        ink('1:1', 1.86, y, .078)
    for x, point in POINTS:
        printed_outline('Point '+str(point)+' printed circle', .29, .29, .145, x, .70, .004)
        ink(str(point), x, .70, .125)
        casino.marker('point-'+str(point), (x, .70, FELT_Z+.01))
    ink('T H E  M E R I D I A N', 0, .305, .077)
    ink('C R A P S', 0, .16, .092)

    # An empty rack sits entirely on the far padded rim, below the 1.30 m crown.
    casino.prism('Empty recessed dealer rack', casino.rounded(1.14, .15, .035, 8, y=1.225), 1.283, 1.294, casino.black)
    for i in range(11):
        casino.cube('Dealer rack divider', (-.50+i*.10, 1.225, 1.295), (.006, .125, .008), casino.bronze, .0015)
    for x in [-2.10, -1.92, 1.92, 2.10]:
        obj = casino.cube('Apron bronze diamond', (x, -1.301, 1.015), (.047, .009, .047), casino.bronze, .003)
        obj.rotation_euler.y = math.pi/4
    casino.text('M E R I D I A N', (0, -1.300, 1.005), .102, casino.bronze)
    casino.marker('felt-origin', (0, 0, FELT_Z))
    casino.marker('pass-line', (0, -.68, FELT_Z+.01))
    casino.marker('dont-pass-line', (0, -.88, FELT_Z+.01))

    validate_source()
    casino.finish(NAME)
    stats = casino.STATS[NAME]
    assert stats['triangles'] < 25000, stats
    assert stats['runtimeMaterialMeshes'] <= 7, stats
    stats['contract'] = {'outerWidth': 5.6, 'outerDepth': 2.7, 'railMaximumHeight': 1.30,
                         'feltHeight': FELT_Z, 'clearRaceHalfExtents': [2.4, .98],
                         'rollStripHalfDepth': .40, 'runtimeDieEdge': .14,
                         'sourceValidated': True}
    (casino.SOURCE/'craps-assets.stats.json').write_text(json.dumps({NAME: stats}, indent=2)+'\n')
    # The saved source retains editable parts; leave this process on that clean file.
    bpy.ops.wm.open_mainfile(filepath=str(casino.SOURCE/(NAME+'.blend')))
    assert not bpy.data.is_dirty


def validate_source():
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    points = [o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    assert all(math.isfinite(c) for p in points for c in p)
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    assert all(abs(a-b) < .00001 for a, b in zip(low, [-2.8, -1.35, 0])), low
    assert all(abs(a-b) < .00001 for a, b in zip(high, [2.8, 1.35, 1.3])), high
    felt = bpy.data.objects['Flat evergreen craps felt']
    assert abs(max(v.co.z for v in felt.data.vertices)-FELT_Z) < .00001
    # Every corner of the rectangular race lies inside the rounded inner wall.
    half_width, half_depth, radius = 5.106/2, 2.206/2, .143
    assert math.hypot(max(0, 2.4-(half_width-radius)), max(0, .98-(half_depth-radius))) < radius
    rebound = bpy.data.objects['Sculpted diamond rubber rebound walls']
    assert all(abs(v.co.x) > 2.4 or abs(v.co.y) > .98 for v in rebound.data.vertices)
    for name, expected in {'felt-origin': (0, 0, 1.04), 'pass-line': (0, -.68, 1.05),
                           'dont-pass-line': (0, -.88, 1.05)}.items():
        assert (bpy.data.objects[name].location-Vector(expected)).length < .00001
    print('CRAPS_SOURCE_VALIDATED', json.dumps({'min': low, 'max': high, 'finite': True}), flush=True)


def render_inspection():
    """Render only the saved editable source in this disposable background scene."""
    import render_casino as render
    render.OUT = INSPECTION
    INSPECTION.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The shared reset helper expects a World even for an initially empty file.
    bpy.context.scene.world = bpy.data.worlds.new('Craps inspection world')
    scene = render.reset()
    render.backdrop()
    render.asset(NAME)
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.cycles.samples = 32
    render.camera((6.8, -8, 7), (0, 0, .65), 7.1)
    render.area((1, -4, 7), (0, 0, .6), 1200, 5)
    render.area((-4, 3, 6), (0, 0, .6), 1000, 4)
    render.render('craps-table-perspective')
    render.camera((0, 0, 9), (0, 0, 0), 6.2)
    render.render('craps-table-layout')
    bpy.ops.wm.open_mainfile(filepath=str(casino.SOURCE/(NAME+'.blend')))
    assert not bpy.data.is_dirty
    print('CRAPS_SOURCE_RELOADED_CLEAN', flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if any(arg != '--render' for arg in args):
        raise ValueError('Only --render is supported')
    build()
    if '--render' in args:
        render_inspection()
