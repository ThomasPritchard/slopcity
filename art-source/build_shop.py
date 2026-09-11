"""Maintained Form & Thread sources, authored fresh from production measurements.

Run in a separate Blender --background --factory-startup process. No prototype
scene, geometry or builder is imported. Metres: X viewer-right, Y into shop, Z up.
Default glTF Y-up export; runtime owns parent placement and Citizen displays.
"""
import sys
import math
import json
import hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import (bpy, ROOT, OUT, reset, material, mesh, cube, tube,
                          loft, ellipsoid, bevel, select, export, join_by_material, empty)
from mathutils import Vector, Matrix

LAYOUT_PATH = ROOT / 'shared' / 'shop-layout.json'
LAYOUT = json.loads(LAYOUT_PATH.read_text())
SOURCE = ROOT / 'art-source'
STATS, M = {}, {}
FLOOR = LAYOUT['floor']


def box(name, pos, size, mat, radius=.012):
    obj = cube(name, pos, size, mat, 0)
    if radius:
        bevel(obj, radius, 2)
    return obj


def emissive(name, color, power=1.5):
    mat = material(name, color, .32)
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Emission Color'].default_value = (*color, 1)
    node.inputs['Emission Strength'].default_value = power
    return mat


def start():
    reset()
    for data in list(bpy.data.meshes):
        if data.users == 0:
            bpy.data.meshes.remove(data)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    M.clear()
    for key, name, color, rough, metal in [
        ('plaster', 'Shop ivory plaster', (.79, .755, .66), .92, 0),
        ('stone', 'Shop honed limestone', (.77, .725, .62), .67, 0),
        ('oak', 'Shop white oak', (.48, .30, .145), .62, 0),
        ('edge', 'Shop oak end grain', (.285, .16, .071), .73, 0),
        ('brass', 'Shop brushed brass', (.47, .31, .125), .38, .72),
        ('sage', 'Shop sage linen', (.30, .39, .26), .98, 0),
        ('forest', 'Shop forest enamel', (.065, .145, .105), .55, 0),
        ('curtain', 'Shop ivory curtain', (.76, .72, .59), .99, 0),
        ('mirror', 'Shop mirror', (.69, .75, .72), .08, .96),
        ('charcoal', 'Shop charcoal hardware', (.026, .033, .028), .57, .25),
        ('roof', 'Shop roof weathering', (.25, .27, .235), .93, 0),
        ('ink', 'Shop display ink knit', (.07, .13, .19), .96, 0),
        ('oat', 'Shop display oat knit', (.56, .49, .34), .96, 0),
        ('rust', 'Shop display rust bomber', (.39, .13, .07), .84, 0),
        ('moss', 'Shop display moss cargo', (.16, .21, .12), .96, 0),
        ('leather', 'Shop display brown leather', (.28, .14, .07), .56, 0),
    ]:
        M[key] = material(name, color, rough, metal)
    M['glow'] = emissive('Shop warm opal glow', (.96, .83, .61), 1.4)
    M['mirror_glow'] = emissive('Shop mirror edge glow', (.96, .89, .73), 1.7)
    glass = material('Shop clear display glazing', (.80, .91, .85), .18)
    glass.diffuse_color = (.80, .91, .85, .13)
    glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value = .13
    glass.surface_render_method = 'DITHERED'
    glass.use_backface_culling = False
    M['glass'] = glass
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    bpy.context.scene['asset_axes'] = 'X viewer-right across frontage; Y into shop; Z up; metres'
    bpy.context.scene['layout_sha256'] = hashlib.sha256(LAYOUT_PATH.read_bytes()).hexdigest()
    bpy.context.scene['blender_version'] = bpy.app.version_string


def marker(name, position):
    obj = empty(name)
    obj.location = position
    obj.empty_display_size = .15
    return obj


def cylinder(name, x, y, z, radius, depth, mat, sides=32):
    return loft(name, [(x, y, z-depth/2, radius, radius),
                       (x, y, z+depth/2, radius, radius)], mat, sides)


def label(value, pos, size, mat):
    data = bpy.data.curves.new('Retail label '+value, 'FONT')
    data.body, data.align_x, data.align_y = value, 'CENTER', 'CENTER'
    data.size, data.extrude, data.resolution_u = size, .0006, 2
    obj = bpy.data.objects.new('Retail label '+value, data)
    bpy.context.collection.objects.link(obj)
    obj.location, obj.rotation_euler = pos, (math.pi/2, 0, 0)
    obj.data.materials.append(mat)
    select([obj])
    bpy.ops.object.convert(target='MESH')


def finish(name):
    for suffix, pos in [('origin', (0, 0, 0)), ('axis-right', (1, 0, 0)),
                        ('axis-depth', (0, 1, 0)), ('axis-up', (0, 0, 1))]:
        marker('shop-'+suffix, pos)
    objects = [o for o in bpy.context.scene.objects if o.type in {'MESH', 'EMPTY'}]
    meshes = [o for o in objects if o.type == 'MESH']
    solids = []
    for obj in meshes:
        assert not obj.modifiers, (obj.name, 'Unapplied modifier')
        if obj.get('planar_surface'):
            continue
        solids.append(obj)
    select(solids)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    points = [obj.matrix_world @ Vector(p) for obj in meshes for p in obj.bound_box]
    bounds = {'min': [round(min(p[i] for p in points), 4) for i in range(3)],
              'max': [round(max(p[i] for p in points), 4) for i in range(3)]}
    bpy.context.scene['editable_components'] = len(meshes)
    bpy.context.scene['roof_objects'] = [o.name for o in meshes] if name == 'form-thread-roof' else []
    # Individual components are saved first; only temporary copies are batched.
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / (name+'.blend')))
    copies = []
    for obj in meshes:
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        bpy.context.collection.objects.link(duplicate)
        copies.append(duplicate)
    batched = join_by_material(copies)
    export(name, batched + [o for o in objects if o.type == 'EMPTY'])
    STATS[name] = {
        'sourceMeshes': len(meshes), 'runtimeMaterialMeshes': len(batched),
        'triangles': sum(len(p.vertices)-2 for o in batched for p in o.data.polygons),
        'bytes': (OUT / (name+'.glb')).stat().st_size, 'blenderBounds': bounds,
        'materials': [o.data.materials[0].name for o in batched],
        'markers': {o.name: [round(v, 5) for v in o.location] for o in objects if o.type == 'EMPTY'},
        'sourceSha256': hashlib.sha256((SOURCE/(name+'.blend')).read_bytes()).hexdigest(),
        'exportSha256': hashlib.sha256((OUT/(name+'.glb')).read_bytes()).hexdigest(),
    }
    print('SHOP_ASSET', name, json.dumps(STATS[name]), flush=True)


def shell():
    start()
    for w in LAYOUT['shellWalls'][:3]:
        box(w['name'], (w['x'], w['y'], w['h']/2), (w['w'], w['d'], w['h']), M['plaster'])
    for x in [-10.16, 10.16]:
        box('Exterior side stone plinth', (x, 8, .22), (.10, 16.3, .44), M['stone'])
        box('Interior side oak skirting', (x-math.copysign(.35, x), 8, .155), (.08, 15.8, .24), M['oak'])
    box('Rear exterior stone plinth', (0, 16.16, .22), (20.3, .10, .44), M['stone'])
    box('Rear interior oak skirting', (0, 15.81, .155), (19.6, .08, .24), M['oak'])
    for side in [-1, 1]:
        cx = side*5.925
        box('Window stone sill', (cx, -.05, .225), (8.15, .55, .45), M['stone'])
        box('Window oak reveal head', (cx, .025, 3.80), (8.15, .24, .14), M['oak'])
        box('Window lower oak reveal', (cx, .025, .50), (8.15, .24, .10), M['oak'])
        left, right = cx-3.83, cx+3.83
        for j in range(4):
            x = left+(right-left)*j/3
            box('Window mullion oak', (x, .015, 2.16), (.065, .15, 3.27), M['oak'], .005)
            box('Window mullion brass cap', (x, -.066, 2.16), (.028, .018, 3.24), M['brass'], .002)
        for j in range(3):
            x0, x1 = left+(right-left)*j/3+.033, left+(right-left)*(j+1)/3-.033
            obj = mesh('Clear display pane', [(x0, .018, .55), (x1, .018, .55),
                       (x1, .018, 3.73), (x0, .018, 3.73)], [(0, 1, 2, 3)], M['glass'])
            obj['planar_surface'] = True
        # Curved stripes are economical single surfaces; the valance gives depth.
        for j in range(16):
            x0, x1 = cx-3.9+j*7.8/16, cx-3.9+(j+1)*7.8/16-.006
            verts = [(x, -.12-k/6*1.17, 3.96-.42*k/6+.045*math.sin(k/6*math.pi))
                     for x in [x0, x1] for k in range(7)]
            obj = mesh('Striped fabric awning', verts, [(k, k+1, k+8, k+7) for k in range(6)], M['sage'] if j%2 else M['curtain'])
            obj['planar_surface'] = True
            box('Awning valance', ((x0+x1)/2, -1.295, 3.47), (x1-x0, .025, .16), M['sage'] if j%2 else M['curtain'], .004)
        for x in [cx-3.86, cx+3.86]:
            tube('Awning brass support', [(x, -.08, 3.44), (x, -1.23, 3.54)], .018, M['brass'], sides=8)
    for x in [-9.87, -2.05, 2.05, 9.87]:
        box('Facade ivory pilaster', (x, -.16, 2.05), (.40, .54, 4.10), M['plaster'], .018)
        box('Pilaster stone foot', (x, -.18, .24), (.48, .59, .48), M['stone'], .014)
        box('Pilaster oak interior edge', (x, .16, 2.09), (.10, .10, 3.75), M['oak'], .008)
        box('Pilaster capital', (x, -.18, 3.98), (.50, .62, .19), M['stone'], .014)
    box('Entrance limestone threshold', (0, .20, .018), (3.70, 1.05, .036), M['stone'], .003)
    box('Entrance oak recessed soffit', (0, .28, 3.91), (3.70, 1.05, .16), M['oak'], .009)
    for x in [-1.91, 1.91]:
        box('Entrance recessed oak jamb', (x, .33, 1.95), (.10, .62, 3.90), M['oak'], .009)
        box('Entrance brass inner edge', (x-math.copysign(.055, x), .20, 1.98), (.017, .025, 3.80), M['brass'], .002)
        tube('Facade lamp arm', [(x*1.28, -.45, 2.76), (x*1.28, -.66, 2.76)], .025, M['brass'], sides=10)
        ellipsoid('Facade opal globe', (x*1.28, -.68, 2.83), (.12, .12, .17), M['glow'], segments=16, rings=8)
    # Existing 5.5 x .9 m plaque occupies z4.05–4.95; trims clear both edges.
    box('Forest fascia plaque mounting field', (0, -.15, 4.49), (20.25, .63, 1.15), M['forest'], .018)
    box('Fascia lower stone moulding', (0, -.19, 3.95), (20.50, .78, .10), M['stone'], .009)
    box('Fascia upper stone moulding', (0, -.20, 5.09), (20.60, .84, .16), M['stone'], .012)
    for x in [-10.22, 10.22]:
        box('Corner fascia return', (x, .22, 4.50), (.15, .72, 1.05), M['forest'], .008)
    s = LAYOUT['signs']['fascia']
    marker('shop-fascia-sign-anchor', (s['x'], s['y'], s['height']))
    finish('form-thread-shell')


def roof():
    start()
    box('Complete ceiling slab', (0, 8, 4.925), (20.12, 16.12, .25), M['plaster'], .012)
    box('Weatherproof roof deck', (0, 8, 5.145), (20.70, 16.65, .19), M['roof'], .015)
    for y in [-.28, 16.28]:
        box('Roof front rear coping', (0, y, 5.25), (20.72, .18, .14), M['stone'], .014)
    for x in [-10.27, 10.27]:
        box('Roof side coping', (x, 8, 5.25), (.18, 16.43, .14), M['stone'], .014)
    for y in [.4, 5.9, 11.5, 15.65]:
        box('Ceiling oak beam', (0, y, 4.69), (19.6, .18, .22), M['oak'], .014)
        box('Ceiling fine brass seam', (0, y-.098, 4.66), (19.55, .014, .02), M['brass'], .002)
    for x in [-9.72, 9.72]:
        box('Ceiling side cove', (x, 8, 4.69), (.22, 15.6, .22), M['oak'], .012)
        box('Ceiling side warm cove', (x-math.copysign(.12, x), 8, 4.73), (.023, 15.55, .035), M['glow'], .003)
    for index, (x, y) in enumerate([(0, 2.5), (0, 6.8), (0, 10.4), (-6.1, 4.1),
                                  (6.1, 4.1), (-6.1, 9.3), (6.1, 9.3), (-6.4, 13.3), (6.2, 13.6)]):
        drop = 3.72 if x == 0 else 3.82
        cylinder('Pendant ceiling rose', x, y, 4.76, .105, .07, M['brass'], 20)
        tube('Pendant brass stem', [(x, y, drop+.24), (x, y, 4.75)], .013, M['brass'], sides=8)
        ellipsoid('Pendant opal globe', (x, y, drop), (.245, .245, .245), M['glow'], segments=20, rings=10)
        cylinder('Pendant brass cap', x, y, drop+.232, .073, .052, M['brass'], 20)
        marker('shop-pendant-'+str(index+1), (x, y, drop))
    finish('form-thread-roof')


def clip_polygon(poly, axis, limit, keep_greater):
    result = []
    for a, b in zip(poly, poly[1:]+poly[:1]):
        inside_a = a[axis] >= limit if keep_greater else a[axis] <= limit
        inside_b = b[axis] >= limit if keep_greater else b[axis] <= limit
        if inside_a:
            result.append(a)
        if inside_a != inside_b:
            t = (limit-a[axis])/(b[axis]-a[axis])
            result.append(tuple(a[i]+(b[i]-a[i])*t for i in range(2)))
    return result


def parquet():
    box('Continuous parquet substrate', (0, 8, FLOOR/2-.009), (19.72, 15.75, FLOOR-.018), M['edge'], 0)
    colors = [(.39, .235, .106), (.47, .295, .145), (.53, .34, .175), (.44, .267, .12), (.57, .371, .195)]
    mats = [material('Shop herringbone oak '+str(i+1), color, .73) for i, color in enumerate(colors)]
    c, s = math.cos(math.pi/4), math.sin(math.pi/4)
    unit, length, gap = .19, .76, .006
    # Two orthogonal 4:1 boards tile a lattice with basis (4,4),(-1,1).
    # Rotate 45 degrees and clip boundary boards to the finished timber border.
    for i in range(-28, 29):
        for j in range(-100, 101):
            a, b = i*length-j*unit, i*length+j*unit
            for orientation in [0, 1]:
                x, y = a+(length if orientation else 0), b
                w, d = (unit, length) if orientation else (length, unit)
                poly = [(x+gap/2, y+gap/2), (x+w-gap/2, y+gap/2),
                        (x+w-gap/2, y+d-gap/2), (x+gap/2, y+d-gap/2)]
                poly = [(px*c-py*s, px*s+py*c+8) for px, py in poly]
                if max(p[0] for p in poly) < -9.63 or min(p[0] for p in poly) > 9.63 or max(p[1] for p in poly) < .20 or min(p[1] for p in poly) > 15.73:
                    continue
                for axis, limit, keep in [(0, -9.63, True), (0, 9.63, False), (1, .20, True), (1, 15.73, False)]:
                    poly = clip_polygon(poly, axis, limit, keep) if poly else []
                if len(poly) < 3:
                    continue
                pieces = [poly]
                # The shell's flush stone threshold owns this surface. Subtract
                # its rectangle so no timber face shares the same height.
                if min(p[1] for p in poly) < .727 and max(p[0] for p in poly) > -1.852 and min(p[0] for p in poly) < 1.852:
                    center = clip_polygon(poly, 0, -1.852, True)
                    center = clip_polygon(center, 0, 1.852, False) if center else []
                    center = clip_polygon(center, 1, .727, True) if center else []
                    pieces = [clip_polygon(poly, 0, -1.852, False), clip_polygon(poly, 0, 1.852, True), center]
                for piece in pieces:
                    if len(piece) < 3:
                        continue
                    obj = mesh('Herringbone oak board', [(px, py, FLOOR) for px, py in piece], [tuple(range(len(piece)))], mats[(i*19+j*7+orientation*3)%len(mats)])
                    for p in obj.data.polygons:
                        p.use_smooth = False
                    obj['planar_surface'] = True
    for x in [-9.73, 9.73]:
        box('Parquet long border', (x, 8, FLOOR-.009), (.19, 15.65, .018), M['oak'], .001)
        box('Parquet brass perimeter', (x-math.copysign(.105, x), 8, FLOOR), (.016, 15.65, .006), M['brass'], .001)
    for x in [-5.8385, 5.8385]:
        box('Parquet entry border', (x, .105, FLOOR-.009), (7.973, .19, .018), M['oak'], .001)
    box('Parquet rear cross border', (0, 15.82, FLOOR-.009), (19.65, .19, .018), M['oak'], .001)


def partitions():
    for w in LAYOUT['partitions']:
        mat = M['sage'] if w['name'].startswith('fitting') else M['plaster']
        obj = box(w['name'], (w['x'], w['y'], FLOOR+w['h']/2), (w['w'], w['d'], w['h']), mat, .018)
        obj['collision_layout_name'] = w['name']
        cap_w, cap_d = (w['w']+.025, w['d']) if w['w'] < w['d'] else (w['w'], w['d']+.025)
        cap_y = w['y']
        if w['name'].startswith('fitting') and w['name'] != 'fitting rear':
            cap_d, cap_y = 3.4275, 13.91375
        box(w['name']+' oak cap', (w['x'], cap_y, FLOOR+w['h']+.028), (cap_w, cap_d, .056), M['oak'], .008)
        box(w['name']+' oak skirting', (w['x'], w['y'], FLOOR+.13), (w['w']+.035, w['d']+.035, .26), M['oak'], .006)
    for side in [-1, 1]:
        for y in [5.69, 8.11]:
            box('Aisle portal oak jamb', (side*3.2, y, FLOOR+1.60), (.25, .18, 3.20), M['oak'], .014)
        box('Aisle portal oak head', (side*3.2, 6.90, FLOOR+3.105), (.25, 2.24, .19), M['oak'], .008)
        for x in [side*4.66, side*7.39]:
            box('Department cross portal jamb', (x, 7, FLOOR+1.60), (.17, .24, 3.20), M['oak'], .014)
        box('Department cross portal lintel', (side*6.025, 7, FLOOR+3.105), (2.56, .24, .19), M['oak'], .008)


def garment(name, x, y, base, key, angle=math.pi/2):
    """Economical fresh knit/bomber proxies in existing catalogue colours."""
    before = set(bpy.context.scene.objects)
    mat = M[key]
    loft(name+' body', [(0, 0, base, .20, .056), (0, 0, base+.04, .205, .058),
                       (0, 0, base+.35, .19, .06), (0, 0, base+.57, .245, .056),
                       (0, 0, base+.64, .17, .045), (0, 0, base+.69, .072, .035)], mat, 16)
    for side in [-1, 1]:
        obj = box(name+' sleeve', (side*.263, 0, base+.37), (.145, .105, .46), mat, .035)
        obj.rotation_euler.y = side*-.24
        box(name+' cuff', (side*.31, 0, base+.145), (.133, .11, .05), mat, .013)
    loft(name+' neckline', [(0, 0, base+.666, .079, .043), (0, 0, base+.711, .073, .039)], mat, 16)
    box(name+' hem', (0, -.005, base+.021), (.401, .117, .045), mat, .009)
    if key in ['rust', 'moss']:
        box(name+' zipper', (0, -.062, base+.34), (.013, .012, .62), M['brass'], .002)
        for side in [-1, 1]:
            tube(name+' pocket welt', [(side*.11, -.065, base+.17), (side*.16, -.065, base+.27)], .006, M['edge'], sides=6)
    transform = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(angle, 4, 'Z')
    bpy.context.view_layer.update()
    for obj in set(bpy.context.scene.objects)-before:
        obj.matrix_world = transform @ obj.matrix_world


def rail(index, layout):
    x, y = layout['x'], layout['y']
    w, d, h = (LAYOUT['railSize'][k] for k in ['w', 'd', 'h'])
    for px in [x-w/2+.045, x+w/2-.045]:
        box('Rail '+str(index)+' oak foot', (px, y, FLOOR+.075), (.115, d, .15), M['oak'], .030)
        tube('Rail '+str(index)+' brass upright', [(px, y, FLOOR+.12), (px, y, FLOOR+h-.06)], .024, M['brass'], sides=10)
    tube('Rail '+str(index)+' hanging bar', [(x-w/2+.045, y, FLOOR+h-.055), (x+w/2-.045, y, FLOOR+h-.055)], .024, M['brass'], sides=10)
    for j in range(6):
        px = x-1.03+j*.41
        key = ['oat', 'ink', 'rust', 'moss', 'curtain', 'ink'][(j+index)%6]
        tube('Wood triangular hanger', [(px, y, 1.89), (px, y-.30, 1.72), (px, y+.30, 1.72), (px, y, 1.89)], .012, M['oak'], sides=6)
        tube('Hanger brass hook', [(px, y, 1.86), (px, y, 2.00), (px+.038, y, 2.035), (px+.065, y, 2.00)], .006, M['brass'], sides=6)
        garment('Rail '+str(index)+' garment '+str(j+1), px, y, 1.035, key)
    marker('shop-rail-'+str(index), (x, y, 0))


def folded_stack(x, y, z, key, count=3, angle=0):
    for i in range(count):
        obj = box('Folded retail knit', (x, y, z+.045+i*.065), (.50, .39, .075), M[key], .025)
        obj.rotation_euler.z = angle
        box('Folded knit neck seam', (x, y-.125, z+.085+i*.065), (.16, .025, .006), M['edge'], .002)


def shoe_display(f):
    x, y = f['x'], f['y']
    box('Shoe cabinet oak back', (x-.40, y, 1.593), (.12, 3.8, 3.114), M['oak'], .018)
    for yy in [y-1.84, y+1.84]:
        box('Shoe cabinet oak end', (x, yy, 1.59), (.95, .12, 3.10), M['oak'], .018)
    for z in [.32, 1.04, 1.76, 2.48]:
        box('Shoe cabinet ivory shelf', (x+.02, y, z), (.92, 3.72, .066), M['stone'], .014)
        for i in range(4):
            yy = y-1.35+i*.90
            for offset in [-.12, .12]:
                box('Display shoe sculpted sole', (x+.06, yy+offset, z+.055), (.42, .18, .043), M['charcoal'], .032)
                ellipsoid('Display shoe leather upper', (x+.06, yy+offset, z+.12), (.205, .083, .095), M['leather'] if i%2 else M['ink'], segments=16, rings=8)
                box('Display shoe penny strap', (x+.015, yy+offset, z+.208), (.045, .137, .014), M['leather'], .005)
        box('Shoe shelf warm underlight', (x+.38, y, z-.038), (.026, 3.48, .017), M['glow'], .002)


def furniture():
    F = {item['name']: item for item in LAYOUT['furniture']}
    for name in ['left window plinth', 'right window plinth']:
        f = F[name]
        box(name+' recessed base', (f['x'], f['y'], .27), (f['w']-.16, f['d']-.16, .47), M['oak'], .030)
        box(name+' limestone top', (f['x'], f['y'], .5325), (f['w'], f['d'], .085), M['stone'], .025)
        box(name+' brass reveal', (f['x'], f['y']-.83, .464), (f['w']-.10, .02, .018), M['brass'], .002)
    for i, f in enumerate(LAYOUT['mannequins']):
        cylinder('Citizen display pedestal '+str(i+1), f['x'], f['y'], .635, .37, .12, M['stone'])
        cylinder('Citizen display pedestal brass reveal '+str(i+1), f['x'], f['y'], .702, .34, .014, M['brass'])
        cylinder('Citizen display pedestal top '+str(i+1), f['x'], f['y'], .722, .34, .026, M['stone'])
        marker('shop-mannequin-'+str(i+1), (f['x'], f['y'], f['height']))
    f = F['checkout']
    x, y = f['x'], f['y']
    box('Checkout inset dark plinth', (x, y, .105), (4.28, 1.09, .14), M['charcoal'], .018)
    box('Checkout forest cabinet', (x, y, .665), (4.40, 1.20, 1.04), M['forest'], .044)
    for i in range(39):
        box('Checkout solid oak flute', (x-2.08+i*.1095, y-.617, .68), (.052, .055, .96), M['oak'], .016)
    box('Checkout limestone worktop', (x, y, 1.165), (f['w'], f['d'], .10), M['stone'], .025)
    box('Checkout terminal base', (x-1.30, y, 1.247), (.33, .29, .064), M['brass'], .014)
    tube('Checkout terminal riser', [(x-1.30, y, 1.26), (x-1.30, y+.04, 1.41)], .025, M['brass'], sides=10)
    screen = box('Checkout point of sale housing', (x-1.30, y+.03, 1.49), (.37, .055, .26), M['charcoal'], .014)
    screen.rotation_euler.x = -.20
    screen = box('Checkout idle screen', (x-1.30, y-.003, 1.489), (.325, .007, .205), M['forest'], .006)
    screen.rotation_euler.x = -.20
    for i in range(2):
        xx = x+.75+i*.48
        box('Folded paper shopping bag', (xx, y, 1.435), (.31, .22, .44), M['curtain'], .012)
        for yy in [y-.075, y+.075]:
            tube('Paper bag cotton handle', [(xx-.075, yy, 1.64), (xx-.07, yy, 1.77), (xx+.07, yy, 1.77), (xx+.075, yy, 1.64)], .007, M['oak'], sides=6)
    f = F['checkout cabinetry']
    x, y = f['x'], f['y']
    box('Checkout back cabinet', (x, y, .568), (f['w'], f['d'], 1.064), M['oak'], .018)
    for i in range(6):
        xx = x-2.24+i*.895
        box('Checkout cabinet drawer', (xx, y-.292, .64), (.865, .035, .77), M['oak'], .008)
        box('Checkout drawer brass pull', (xx, y-.318, .84), (.22, .024, .022), M['brass'], .004)
    for z in [1.66, 2.19]:
        box('Checkout stock shelf', (x, y-.035, z), (5.6, .62, .075), M['oak'], .012)
        for i in range(7):
            box('Ivory stock box', (x-2.37+i*.79, y-.02, z+.15), (.63, .40, .22), M['curtain'], .014)
            box('Stock box lid', (x-2.37+i*.79, y-.02, z+.265), (.66, .42, .025), M['stone'], .006)
    # Reserve the existing 6 x 1.4 m tagline panel's full z2.85–4.25 range.
    s = LAYOUT['signs']['tagline']
    marker('shop-tagline-sign-anchor', (s['x'], s['y'], s['height']))
    f = F['central display']
    x, y = f['x'], f['y']
    box('Rear island recessed plinth', (x, y, .11), (3.38, 1.96, .15), M['edge'], .075)
    box('Rear island oak cabinet', (x, y, .51), (3.50, 2.10, .73), M['oak'], .10)
    box('Rear island honed limestone', (x, y, .8925), (f['w'], f['d'], .085), M['stone'], .04)
    for xx, key in zip([-1.18, -.31, .56], ['rust', 'curtain', 'ink']):
        folded_stack(xx, y-.20, .947, key)
    cylinder('Island torso display base', 1.17, y+.27, .96, .27, .05, M['stone'])
    tube('Island torso display brass stem', [(1.17, y+.27, .98), (1.17, y+.27, 1.20)], .026, M['brass'], sides=10)
    garment('Island rust bomber bust', 1.17, y+.27, 1.17, 'rust', 0)
    label('THE EVERYDAY EDIT', (0, y-1.063, .53), .14, M['curtain'])
    shoe_display(F['shoe display'])
    f = F['folded stock console']
    box('Knit console oak cabinet', (f['x'], f['y'], .715), (f['w'], f['d'], 1.36), M['oak'], .018)
    box('Knit console stone top', (f['x'], f['y'], 1.388), (f['w'], f['d'], .064), M['stone'], .016)
    for i in range(4):
        folded_stack(f['x'], f['y']-1.38+i*.91, 1.43, ['curtain', 'moss', 'oat', 'ink'][i], 3, math.pi/2)
    f = F['waiting bench']
    for yy in [f['y']-.95, f['y']+.95]:
        for xx in [f['x']-.30, f['x']+.30]:
            box('Waiting bench brass foot', (xx, yy, .22), (.04, .04, .37), M['brass'], .006)
    box('Waiting bench oak seat rail', (f['x'], f['y'], .38), (.87, 2.47, .12), M['oak'], .025)
    box('Waiting bench sage cushion', (f['x']-.04, f['y'], .56), (.85, 2.42, .28), M['sage'], .085)
    box('Waiting bench sage back', (f['x']+.33, f['y'], .85), (.25, 2.5, .58), M['sage'], .074)
    for yy in [f['y']-1.21, f['y']+1.21]:
        box('Waiting bench end bolster', (f['x']-.06, yy, .75), (.73, .12, .34), M['sage'], .043)


def fittings():
    for i, x in enumerate(LAYOUT['fittingCenters']):
        y = 13.95
        box('Fitting '+str(i+1)+' linen rug', (x, y, FLOOR+.013), (2.74, 2.89, .026), M['curtain'], .035)
        for yy in [12.59, 15.31]:
            box('Fitting rug woven border', (x, yy, FLOOR+.028), (2.56, .035, .006), M['sage'], .002)
        my = LAYOUT['preview']['mirrorY']
        box('Fitting mirror oak backing', (x, my+.052, 1.76), (1.91, .085, 2.58), M['oak'], .028)
        for xx in [x-.947, x+.947]:
            box('Fitting mirror brass stile', (xx, my-.007, 1.76), (.050, .035, 2.58), M['brass'], .005)
            box('Fitting mirror illuminated edge', (xx+(.048 if xx<x else -.048), my-.025, 1.76), (.025, .024, 2.40), M['mirror_glow'], .004)
        for zz in [.482, 3.038]:
            box('Fitting mirror brass head sill', (x, my-.007, zz), (1.89, .035, .050), M['brass'], .005)
        obj = mesh('Fitting mirror plane '+str(i+1), [(x-.872, my, .53), (x+.872, my, .53),
                   (x+.872, my, 2.99), (x-.872, my, 2.99)], [(0, 1, 2, 3)], M['mirror'])
        obj['planar_surface'], obj['reflection_normal'] = True, '0,-1,0'
        tube('Fitting curtain brass track', [(x-1.64, 12.19, 3.055), (x+1.64, 12.19, 3.055)], .019, M['brass'], sides=10)
        # Gathered at both jambs, leaving approximately 2.3 m clear entry.
        for side in [-1, 1]:
            cx, verts, faces = x+side*1.44, [], []
            for z in [FLOOR+.07, .45, 1.1, 1.8, 2.4, 2.97]:
                for k in range(17):
                    t = k/16
                    verts.append((cx+(t-.5)*.39, 12.19+math.sin(t*math.pi*8)*.054+(2.97-z)*.009, z))
            for row in range(5):
                for k in range(16):
                    a = row*17+k
                    faces.append((a, a+1, a+18, a+17))
            obj = mesh('Gathered fitting curtain', verts, faces, M['curtain'])
            obj['planar_surface'] = True
            M['curtain'].use_backface_culling = False
            for k in range(6):
                xx = cx-.17+k*.068
                tube('Curtain brass ring', [(xx, 12.19+.027*math.cos(a), 3.027+.043*math.sin(a)) for a in [j/12*math.tau for j in range(13)]], .004, M['brass'], sides=5)
            box('Curtain sage tieback', (cx, 12.13, 1.21), (.42, .022, .052), M['sage'], .010)
        for yy in [13.20, 13.68]:
            tube('Fitting brass coat hook', [(x+1.55, yy, 1.90), (x+1.48, yy, 1.90), (x+1.47, yy, 1.97)], .012, M['brass'], sides=8)
        f = next(f for f in LAYOUT['furniture'] if f['name'] == 'fitting stool '+str(i+1))
        for sx in [-.19, .19]:
            for sy in [-.19, .19]:
                box('Fitting stool oak leg', (f['x']+sx, f['y']+sy, .25), (.045, .045, .43), M['oak'], .008)
        box('Fitting stool sage cushion', (f['x'], f['y'], .435), (.58, .58, .13), M['sage'], .055)
        label('FITTING '+str(i+1).zfill(2), (x, 15.826, 3.36), .14, M['forest'])
        marker('shop-fitting-center-'+str(i+1), (x, LAYOUT['preview']['y'], LAYOUT['preview']['height']))
        marker('shop-mirror-center-'+str(i+1), (x, my, 1.76))


def interior():
    start()
    partitions()
    for i, item in enumerate(LAYOUT['rails']):
        rail(i+1, item)
    furniture()
    fittings()
    # Add planar boards after operator-heavy furniture authoring, avoiding
    # unnecessary dependency-graph updates across thousands of finished boards.
    parquet()
    finish('clothing-shop')


if __name__ == '__main__':
    functions = {'form-thread-shell': shell, 'form-thread-roof': roof, 'clothing-shop': interior}
    requested = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(functions)
    for name in requested:
        if name not in functions:
            raise ValueError('Unknown shop asset: '+name)
        functions[name]()
    path = SOURCE / 'shop-assets.stats.json'
    prior = json.loads(path.read_text()).get('assets', {}) if path.exists() else {}
    prior.update(STATS)
    path.write_text(json.dumps({'blenderVersion': bpy.app.version_string,
        'coordinates': LAYOUT['axes'], 'layoutSha256': hashlib.sha256(LAYOUT_PATH.read_bytes()).hexdigest(),
        'assets': prior}, indent=2)+'\n')
