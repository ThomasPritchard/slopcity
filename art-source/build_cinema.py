"""Maintained original Bridge Picture House; metres, authored from cinema-layout.json.

Run Blender --background --factory-startup --python-exit-code 1 --python
art-source/build_cinema.py [-- --render]. Owns only cinema.blend/cinema.glb and
ignored cinema-asset inspection output. Helpers have guarded entry points.
Blender (x, -townZ, height) exports to glTF (x, height, townZ). Babylon's LH
loader mirrors glTF X; the cinema wrapper must use scaling.x = -1 to cancel it.
Bench and tree sources are inspection context only; neither is in this export.
"""
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import bpy, material, mesh, cube, tube, ellipsoid, bevel, select, join_by_material, empty
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art-source'
OUT = ROOT / 'public/models'
INSPECTION = ROOT / 'output/playwright/cinema-asset'
LAYOUT = json.loads((ROOT / 'shared/cinema-layout.json').read_text())
INSPECTION.mkdir(parents=True, exist_ok=True)


def town(x, y, z):
    return (x, -z, y)


def block(name, x, y, z, width, height, depth, mat, radius=.015):
    obj = cube(name, town(x, y, z), (width, depth, height), mat, 0)
    if radius:
        bevel(obj, radius, 2 if radius > .01 else 1)
    return obj


def glow(name, color, strength):
    mat = material(name, color, .35)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def rounded(width, height, radius, segments=10):
    result = []
    for cx, cy, a in [(width/2-radius, height/2-radius, 0),
                      (-width/2+radius, height/2-radius, 90),
                      (-width/2+radius, -height/2+radius, 180),
                      (width/2-radius, -height/2+radius, 270)]:
        for i in range(segments+1):
            angle = math.radians(a+i*90/segments)
            result.append((cx+radius*math.cos(angle), cy+radius*math.sin(angle)))
    return result


def facade(name, x, y, z, width, height, depth, radius, mat, edge=.015):
    """Rounded vertical face, east-facing +X; width runs along Blender +Y."""
    outline = rounded(width, height, radius)
    n = len(outline)
    verts = [(x+dx, -z+u, y+v) for dx in [-depth/2, depth/2] for u, v in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    obj = mesh(name, verts, faces, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    if edge:
        bevel(obj, edge, 2)
    return obj


def horizontal(name, x, y, z, width, depth, thickness, radius, mat):
    outline = rounded(width, depth, radius)
    n = len(outline)
    verts = [(x+u, -z+v, y+dy) for dy in [-thickness/2, thickness/2] for u, v in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    obj = mesh(name, verts, faces, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    bevel(obj, min(.012, thickness/4), 2)
    return obj


def lettering(label, x, y, z, size, mat, max_width=None, spacing=1.1):
    data = bpy.data.curves.new(label, 'FONT')
    data.body = label
    data.align_x = data.align_y = 'CENTER'
    data.size = size
    data.space_character = spacing
    data.extrude = .003
    data.bevel_depth = 0
    data.bevel_resolution = 1
    data.resolution_u = 3
    obj = bpy.data.objects.new('Cast lettering '+label, data)
    bpy.context.collection.objects.link(obj)
    obj.location = town(x, y, z)
    obj.rotation_euler = (math.pi/2, 0, math.pi/2)
    data.materials.append(mat)
    bpy.context.view_layer.update()
    if max_width and obj.dimensions.y > max_width:
        obj.scale *= max_width/obj.dimensions.y
    select([obj])
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    # Babylon's left-handed east-facing camera has +townZ screen-right.
    # Mirror glyph horizontal coordinates only; the stone anchors stay fixed.
    for vertex in obj.data.vertices:
        vertex.co.x *= -1
    for polygon in obj.data.polygons:
        polygon.flip()
    obj.data.update()
    return obj


def marker(name, x, y, z):
    obj = empty(name)
    obj.location = town(x, y, z)
    return obj


def build_surround():
    s = LAYOUT['surround']
    facade('Substantial rounded limestone screen surround', s['x'], s['h']/2, s['z'],
           s['d'], s['h'], s['w'], .63, stone, .035)
    # A rear recessed evergreen panel articulates the wall from town's west side.
    facade('Rear evergreen architectural panel', -25.507, 3.7, -2, 9.7, 5.8, .03, .43, green)
    facade('Deep evergreen screen inset', -24.568, 4.05, -2, 9.74, 5.59, .11, .23, green)
    facade('Bronze rolled screen border', -24.525, 4.05, -2, 9.19, 5.253, .027, .055, bronze, .006)
    screen = LAYOUT['screen']
    block('Matte backing behind live runtime screen', -24.507, screen['y'], screen['z'],
          .020, screen['height']+.055, screen['width']+.055, black, .005)
    marker('cinema-screen-centre', screen['x'], screen['y'], screen['z'])
    marker('cinema-screen-lower-left', screen['x'], screen['y']-screen['height']/2, screen['z']+screen['width']/2)
    marker('cinema-screen-upper-right', screen['x'], screen['y']+screen['height']/2, screen['z']-screen['width']/2)
    # Original cast letters. The header and dedication remain outside live pixels.
    lettering('THE BRIDGE', -24.578, 7.055, -2, .44, bronze, 6.5, 1.25)
    lettering('PICTURE HOUSE', -24.574, 1.005, -2, .28, bronze, 5.8, 1.4)
    lettering('For the streams that brought us together.', -24.573, .56, -2, .125, bronze, 6.9, 1.03)
    for z in [-5.43, 1.43]:
        block('Dedication bronze divider', -24.57, .80, z, .023, .012, .80, bronze, .004)
    # Broad, shallow weather canopy: only .56 m projects ahead of the screen.
    horizontal('Rounded bronze canopy edge', -24.93, 7.47, -2, 2.0, 12.05, .18, .38, bronze)
    horizontal('Evergreen standing-seam canopy cap', -24.98, 7.577, -2, 1.92, 11.96, .06, .35, green)
    for i in range(34):
        z = -7.77+i*.35
        block('Oak canopy soffit batten', -24.78, 7.357, z, 1.55, .065, .23, oak, .017)
    for z in [-7.18, 3.18]:
        tube('Bronze swept canopy bracket', [town(-24.61, 6.69, z), town(-24.35, 7.08, z),
             town(-24.02, 7.37, z)], .040, bronze, sides=8)
    # Masonry coursing is recessed behind the main face, never across the screen.
    for h in [.45, 1.17, 6.92]:
        for z in [-7.25, 3.25]:
            block('Dressed limestone outer course reveal', -24.594, h, z, .017, .012, .64, mortar, .002)
    for z in [-7.32, 3.32]:
        facade('Fluted evergreen side sconce', -24.53, 2.31, z, .18, .66, .14, .07, green)
        facade('Warm screen side sconce glass', -24.446, 2.31, z, .09, .48, .02, .035, bulbs, .004)
        marker('cinema-screen-sconce-'+str(z), -24.31, 2.31, z)


def build_court():
    court = LAYOUT['court']
    depth = court['maxZ']-court['minZ']
    center_z = (court['minZ']+court['maxZ'])/2
    for index, tier in enumerate(LAYOUT['tiers']):
        width = tier['maxX']-tier['minX']
        center_x = (tier['minX']+tier['maxX'])/2
        h = tier['height']
        # Backing must stay below pavers: coplanar tops render black after glTF import.
        slab_h = h-.026
        block('Terrace '+str(index+1)+' full structural slab', center_x, slab_h/2, center_z,
              width, slab_h, depth, stone, .005)
        # Quiet small-format dressed-stone paving, aligned with shared floor heights.
        nx = max(2, round(width/1.03))
        nz = 16
        dx, dz = (width-.22)/nx, (depth-.34)/nz
        for ix in range(nx):
            for iz in range(nz):
                x = tier['minX']+.11+(ix+.5)*dx
                z = court['minZ']+.17+(iz+.5)*dz
                block('Terrace '+str(index+1)+' dressed paving', x, h-.012, z,
                      dx-.008, .024, dz-.008, paving if (ix+iz)%4 else pale, .003)
        for z in [court['minZ']+.068, court['maxZ']-.068]:
            block('Honed terrace edge band', center_x, h-.009, z, width-.015, .018, .13, pale, .003)
        for x in [tier['minX']+.043, tier['maxX']-.043]:
            block('Terrace bronze flush nosing', x, h-.005, center_z, .018, .009, depth-.29, bronze, .002)
        if index:
            for z in LAYOUT['benchZ']:
                block('Recessed terrace light shadow gap', tier['minX']-.004, h-.059, z,
                      .010, .044, 2.45, green, .003)
                block('Cinema warm bench edge accent', tier['minX']-.012, h-.052, z,
                      .004, .014, 2.31, edge_glow, .001)
        for z in LAYOUT['benchZ']:
            marker('cinema-bench-'+str(index)+'-'+str(z), tier['benchX'], h, z)
    r = LAYOUT['ramp']
    verts = [town(x,y,z) for x,y,z in [
        (r['minX'],0,r['minZ']),(r['maxX'],0,r['minZ']),
        (r['maxX'],0,r['maxZ']),(r['minX'],0,r['maxZ']),
        (r['minX'],r['height'],r['minZ']),(r['maxX'],.008,r['minZ']),
        (r['maxX'],.008,r['maxZ']),(r['minX'],r['height'],r['maxZ'])]]
    obj = mesh('Central gently sloping arrival ramp', verts,
               [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)], paving)
    for p in obj.data.polygons:
        p.use_smooth = False
    for z in [r['minZ']+.06,r['maxZ']-.06]:
        tube('Ramp bronze edge inlay', [town(r['minX'],r['height']+.001,z),town(r['maxX'],.009,z)], .007, bronze, sides=6)
    marker('cinema-arrival-ramp', r['maxX'], .008, center_z)


def build_beds():
    rng = random.Random(1826)
    for index, bed in enumerate(LAYOUT['beds']):
        x,z,w,d,h = [bed[k] for k in ['x','z','w','d','h']]
        block('Garden bed limestone base', x, .07, z, w, .14, d, stone, .025)
        for side in [-1,1]:
            for i in range(9):
                block('Garden bed individual stone block', x-w/2+(i+.5)*w/9, .34, z+side*(d/2-.1),
                      w/9-.012, .40, .20, stone, .012)
            block('Garden bed honed coping', x, h-.042, z+side*(d/2-.09), w, .084, .18, pale, .014)
        for side in [-1,1]:
            block('Garden bed end', x+side*(w/2-.1), .35, z, .20, .43, d-.39, stone, .012)
            block('Garden bed end coping', x+side*(w/2-.09), h-.042, z, .18, .084, d-.32, pale, .012)
        block('Recessed garden loam', x, .557, z, w-.40, .03, d-.4, earth, .005)
        verts,faces,weights=[],[],[]
        for ci in range(29):
            px=x-w/2+.37+ci*(w-.74)/28
            pz=z+rng.uniform(-.13,.13)
            # Keep the coffee perch clear at the arrival corner of the south bed.
            if index==0 and px > -17.22:
                continue
            phase=rng.random()
            for blade in range(15):
                base=Vector(town(px+rng.uniform(-.09,.09),.58,pz+rng.uniform(-.085,.085)))
                a=rng.random()*math.tau
                direction=Vector((math.cos(a),math.sin(a),0))
                side=Vector((-math.sin(a),math.cos(a),0))
                height=rng.uniform(.24,.67)
                lean=rng.uniform(.13,.30)
                width=rng.uniform(.013,.024)
                n=len(verts)
                for row in range(4):
                    t=row/3
                    center=base+direction*lean*t*t+Vector((0,0,height*(t-.14*t*t)))
                    breadth=width*(1-t)+.0003
                    verts.extend([tuple(center-side*breadth),tuple(center+side*breadth)])
                    weights.extend([(t*t,phase)]*2)
                for row in range(3):
                    j=n+row*2
                    faces += [(j,j+1,j+3),(j,j+3,j+2)]
            if ci%3==0:
                top=Vector(town(px+.08,.58+rng.uniform(.62,.85),pz))
                tube('Fine garden seed stem',[town(px,.58,pz),tuple(top)],.004,seed,sides=4)
                ellipsoid('Garden seed head',tuple(top),(.022,.018,.07),seed,segments=6,rings=4)
        obj=mesh('Garden folded meadow grasses '+str(index+1),verts,faces,grass)
        uv=obj.data.uv_layers.new(name='Wind weight and phase')
        for loop in obj.data.loops:
            uv.data[loop.index].uv=weights[loop.vertex_index]
        obj['wind_uv_contract']='U root-to-tip weight; V stable clump phase'
    # A modest timber perch over the stone bed, approached from the open court.
    horizontal('Small coffee ledge oiled oak top', -16.70, .965, -9.37, .96, .96, .095, .11, oak)
    for x in [-17.00,-16.40]:
        block('Coffee ledge evergreen support', x,.75,-9.37,.065,.39,.55,green,.01)
    for x,z in [(-16.87,-9.13),(-16.51,-9.47)]:
        ellipsoid('Coffee saucer',town(x,1.019,z),(.082,.082,.012),pale,segments=20,rings=8)
        # Opaque inset top, no transparent sorting burden.
        bpy.ops.mesh.primitive_cone_add(vertices=20,radius1=.048,radius2=.060,depth=.085,location=town(x,1.066,z))
        cup=bpy.context.object;cup.name='Coffee cup';cup.data.materials.append(pale)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.048,depth=.004,location=town(x,1.109,z))
        bpy.context.object.name='Coffee dark surface';bpy.context.object.data.materials.append(earth)
    marker('cinema-coffee-ledge',-16.70,.965,-9.37)


def build_lights():
    for z in [-9.4,5.4]:
        for x in [-23.9,-16.6]:
            block('Garden string light cast post',x,1.93,z,.07,3.10,.07,green,.015)
            block('Garden string post bronze collar',x,3.40,z,.095,.05,.095,bronze,.011)
            ellipsoid('Garden string post finial',town(x,3.50,z),(.07,.07,.065),bronze,segments=12,rings=6)
    # Keep the warm strings along the side beds; the entrance strand crossed
    # the projected broadcast from the square and the rear seating terrace.
    paths=[((-23.9,3.43,-9.4),(-16.6,3.43,-9.4),.23,12),
           ((-23.9,3.43,5.4),(-16.6,3.43,5.4),.23,12)]
    for i,(a,b,sag,count) in enumerate(paths):
        def point(t):
            return town(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t-4*sag*t*(1-t),a[2]+(b[2]-a[2])*t)
        tube('Fine suspended garden festoon cable '+str(i),[point(t/48) for t in range(49)],.008,green,sides=5)
        for bulb in range(1,count):
            p=Vector(point(bulb/count))
            tube('Bronze festoon bulb socket',[tuple(p),tuple(p-Vector((0,0,.06)))],.022,bronze,sides=8)
            ellipsoid('Cinema warm string bulb',tuple(p-Vector((0,0,.099))),(.049,.049,.065),bulbs,segments=10,rings=6)
        midpoint=point(.5)
        marker('cinema-festoon-light-'+str(i),midpoint[0],midpoint[2]-.12,-midpoint[1])


def build_notice():
    n=LAYOUT['notice']
    for z in [n['z']-.70,n['z']+.70]:
        block('Noticeboard evergreen post',n['x'],.69,z,.115,1.38,.115,green,.024)
        block('Noticeboard limestone foot',n['x'],.11,z,.34,.22,.31,stone,.022)
    facade('Cinema noticeboard limestone frame',n['x'],1.31,n['z'],1.8,2.18,.35,.17,stone,.022)
    facade('Cinema noticeboard evergreen inset',n['x']+.183,1.38,n['z'],1.65,1.90,.027,.055,green,.006)
    lettering('NOW SHOWING',n['x']+.178,.325,n['z'],.115,bronze,1.45,1.1)
    marker('cinema-notice-display-centre',n['x']+.205,1.38,n['z'])
    # Runtime card plane: east facing 1.58 x 1.75 m at the named marker.
    marker('cinema-notice-display-upper-right',n['x']+.205,2.255,n['z']-.79)
    marker('cinema-notice-display-lower-left',n['x']+.205,.505,n['z']+.79)


def validate_and_export():
    objects=[o for o in bpy.context.scene.objects if o.type in {'MESH','EMPTY'}]
    meshes=[o for o in objects if o.type=='MESH']
    bpy.context.view_layer.update()
    assert all(len(o.data.materials)==1 for o in meshes)
    vertices=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    assert all(math.isfinite(c) for p in vertices for c in p)
    assert not any(o.name.startswith(('Seat slat','Layered leafy crown')) for o in meshes)
    for index, tier in enumerate(LAYOUT['tiers']):
        slab=bpy.data.objects['Terrace '+str(index+1)+' full structural slab']
        slab_top=max((slab.matrix_world@v.co).z for v in slab.data.vertices)
        assert slab_top < tier['height']-.025, (index,slab_top)
        for tile in [o for o in meshes if o.name.startswith('Terrace '+str(index+1)+' dressed paving')]:
            assert abs(max((tile.matrix_world@v.co).z for v in tile.data.vertices)-tier['height'])<.00001
        for z in LAYOUT['benchZ']:
            assert LAYOUT['court']['minZ']+1.175 < z < LAYOUT['court']['maxZ']-1.175
            assert tier['minX']+.6 < tier['benchX'] < tier['maxX']-.6
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.scene.unit_settings.scale_length=1
    bpy.context.scene['description']='Original open-air Bridge Picture House; rounded limestone, evergreen inset, cast bronze lettering, timber soffit and shallow terraces'
    bpy.context.scene['coordinate_contract']='Blender (x,-townZ,height); runtime wrapper scaling.x=-1 cancels Babylon glTF LH loader mirror'
    bpy.context.scene['runtime_screen']='9 x 5.0625 m at town (-24.49,4.05,-2); no static imagery'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'cinema.blend'))
    copies=[]
    for obj in meshes:
        copy=obj.copy();copy.data=obj.data.copy();bpy.context.collection.objects.link(copy);copies.append(copy)
    batched=join_by_material(copies)
    markers=[o for o in objects if o.type=='EMPTY']
    select(batched)
    # Bake mesh placement into data while preserving marker world translations.
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    select(batched+markers)
    bpy.ops.export_scene.gltf(filepath=str(OUT/'cinema.glb'),export_format='GLB',use_selection=True,
                             export_animations=False,export_yup=True,export_apply=False)
    bounds={'min':[round(min(p[i] for p in vertices),4) for i in range(3)],
            'max':[round(max(p[i] for p in vertices),4) for i in range(3)]}
    runtime={'min':[bounds['min'][0],bounds['min'][2],-bounds['max'][1]],
             'max':[bounds['max'][0],bounds['max'][2],-bounds['min'][1]]}
    stats={'name':LAYOUT['name'],'sourceMeshes':len(meshes),'runtimeMaterialMeshes':len(batched),
           'triangles':sum(len(p.vertices)-2 for obj in batched for p in obj.data.polygons),
           'bytes':(OUT/'cinema.glb').stat().st_size,'blenderBounds':bounds,'runtimeBounds':runtime,
           'materials':[obj.data.materials[0].name for obj in batched],
           'coordinateContract':'Blender (townX,-townZ,height), glTF (townX,height,townZ), Babylon wrapper scaling.x=-1',
           'letteringHorizontalMirroredForBabylonLH':True,'inspectionSceneReflectedToMatchRuntimeHandedness':True,
           'benchMeshesIncluded':False,'treeMeshesIncluded':False,'staticScreenImagery':False,
           'screen':LAYOUT['screen'],'noticeDisplay':{'x':-13.295,'y':1.38,'z':-7,'width':1.58,'height':1.75},
           'markers':{o.name:[round(o.location.x,5),round(o.location.z,5),round(-o.location.y,5)] for o in markers},
           'sourceValidated':True,'renderEvidence':'Offline Blender source/export inspection only; browser integration remains parent-owned'}
    assert stats['markers']['cinema-screen-centre']==[-24.49,4.05,-2.0],stats['markers']
    assert stats['markers']['cinema-notice-display-centre']==[-13.295,1.38,-7.0],stats['markers']
    assert stats['runtimeMaterialMeshes']<=14,stats
    assert stats['triangles']<65000,stats
    (INSPECTION/'cinema-assets.stats.json').write_text(json.dumps(stats,indent=2)+'\n')
    print('CINEMA_ASSET',json.dumps(stats),flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'cinema.blend'))


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global stone,pale,paving,mortar,green,bronze,oak,black,earth,grass,seed,bulbs,edge_glow
    stone=material('Cinema warm limestone',(.58,.56,.49),.82)
    pale=material('Cinema honed limestone',(.71,.68,.59),.69)
    paving=material('Cinema dressed stone paving',(.56,.55,.49),.85)
    mortar=material('Cinema recessed stone joints',(.30,.31,.28),.95)
    green=material('Cinema evergreen enamel',(.024,.055,.041),.40,.25)
    bronze=material('Cinema brushed bronze',(.43,.29,.13),.32,.72)
    oak=material('Cinema oiled oak',(.32,.18,.080),.52)
    black=material('Cinema screen matte backing',(.009,.013,.011),.94)
    earth=material('Cinema dark loam and coffee',(.058,.038,.020),1)
    grass=material('Cinema meadow grasses',(.17,.255,.085),.89)
    grass.use_backface_culling=False
    seed=material('Cinema dry seed heads',(.36,.29,.14),.91)
    bulbs=glow('Cinema warm string bulb glow',(1,.60,.23),2.0)
    edge_glow=glow('Cinema warm bench edge glow',(1,.65,.30),1.2)
    build_surround();build_court();build_beds();build_lights();build_notice()
    validate_and_export()


def context_asset(name, position, heading=0):
    """Read existing editable assets only into disposable inspection scene."""
    with bpy.data.libraries.load(str(SOURCE/(name+'.blend')),link=False) as (source,target):
        target.objects=list(source.objects)
    loaded=[o for o in target.objects if o]
    transform=Matrix.Translation(Vector(position))@Matrix.Rotation(heading,4,'Z')
    for obj in loaded:
        bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.update()
    world={o:o.matrix_world.copy() for o in loaded}
    for obj in loaded:
        obj.parent=None
        obj.matrix_world=transform@world[obj]
        obj.name='INSPECTION ONLY '+name+'/'+obj.name


def inspection_point(position):
    # Reflect the disposable scene and camera to match Babylon LH view direction.
    p=Vector(town(*position));p.y *= -1
    return p


def mirror_inspection_scene():
    reflection=Matrix.Diagonal(Vector((1,-1,1,1)))
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.matrix_world=reflection@obj.matrix_world


def camera(position,target,lens=42):
    bpy.ops.object.camera_add(location=inspection_point(position))
    obj=bpy.context.object
    obj.rotation_euler=(inspection_point(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    obj.data.lens=lens
    obj.data.clip_end=500
    bpy.context.scene.camera=obj


def area(position,target,power,size,color=(1,.87,.69)):
    bpy.ops.object.light_add(type='AREA',location=inspection_point(position))
    obj=bpy.context.object;obj.data.energy=power;obj.data.shape='DISK';obj.data.size=size;obj.data.color=color
    obj.rotation_euler=(inspection_point(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def render(name):
    bpy.context.scene.render.filepath=str(INSPECTION/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('CINEMA_RENDER',name,flush=True)


def render_inspection():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'cinema.blend'))
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=1600;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Cinema inspection world');scene.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.43,.49,.53,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.55
    ground=material('Inspection ground only',(.25,.28,.20),.95)
    block('Inspection ground only',-20,-.08,-2,90,.14,80,ground,0)
    for tier in LAYOUT['tiers']:
        for z in LAYOUT['benchZ']:
            # Bench native front is -Y; -pi/2 rotates it toward Blender -X.
            context_asset('bench',town(tier['benchX'],tier['height'],z),-math.pi/2)
    for tree in LAYOUT['trees']:
        context_asset('tree',town(tree['x'],0,tree['z']))
    mirror_inspection_scene()
    bpy.ops.object.light_add(type='SUN',location=(0,0,15))
    sun=bpy.context.object;sun.data.energy=2.0;sun.data.angle=math.radians(14)
    sun.rotation_euler=(math.radians(30),math.radians(-24),math.radians(-48))
    area((-14,13,-5),(-24,3,-2),1700,10)
    camera((-5.8,1.74,-6.8),(-23.0,3.05,-2),33)
    render('cinema-arrival-day')
    camera((-5.4,14.7,-18.8),(-20.3,2.0,-2),37)
    render('cinema-overview-day')
    # Seated eye height makes blank-screen visibility and open sky explicit.
    camera((-16.3,1.47,-2),(-24.49,4.05,-2),29)
    render('cinema-seated-day')
    sun.data.energy=.08
    world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.20,.31,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.21
    for obj in scene.objects:
        if obj.type=='LIGHT' and obj.data.type=='AREA':obj.data.energy=80
    for x,z in [(-21,-9.4),(-21,5.4),(-16.6,-2)]:
        area((x,3.3,z),(x,.4,z),90,3,(1,.56,.24))
    area((-23.85,7.28,-2),(-24.5,3.2,-2),100,7,(1,.68,.36))
    camera((-5.8,1.74,-6.8),(-23.0,3.05,-2),33)
    render('cinema-arrival-dusk')
    camera((-24.1,2.35,-7.6),(-17.5,.85,-2),31)
    render('cinema-bench-edge-dusk')
    # The exact batched GLB is independently imported for a geometry parity view.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(OUT/'cinema.glb'))
    mirror_inspection_scene()
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=1600;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Export inspection world');scene.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.43,.49,.53,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.7
    area((-11,15,-8),(-23,3,-2),2600,12)
    camera((-5.4,14.7,-18.8),(-20.3,2,-2),37)
    render('cinema-export-overview')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'cinema.blend'))
    assert not bpy.data.is_dirty
    print('CINEMA_SOURCE_RELOADED_CLEAN',flush=True)


if __name__=='__main__':
    build()
    if '--render' in sys.argv:
        render_inspection()
