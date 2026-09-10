"""The Rising Wave: original limestone, mosaic and cast-bronze civic fountain.

Owns fountain.blend / fountain.glb only. Metres, Z up, origin at ground centre.
Animated water is authored in src/world/fountain.ts, not baked into the GLB.
"""
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import reset, material, cube, lathe, tube, mesh, empty, select

ROOT = Path(__file__).resolve().parents[1]


def build_model(root):
    rng = random.Random(104)
    stone = material('Fountain warm limestone', (.57, .535, .45), .78)
    coping = material('Fountain honed coping', (.70, .665, .57), .58)
    joint = material('Fountain stone joints', (.30, .30, .26), .92)
    bronze = material('Fountain satin bronze', (.40, .235, .09), .28, .82)
    edge = material('Fountain polished bronze edges', (.56, .365, .145), .22, .86)
    patina = material('Fountain bronze patina', (.095, .18, .145), .46, .7)
    grout = material('Fountain submerged grout', (.16, .26, .24), .65)
    tiles = [material('Fountain glazed mosaic ' + str(i), colour, .26, .08) for i, colour in enumerate([
        (.12, .29, .27), (.17, .35, .32), (.23, .39, .35), (.105, .25, .24)])]

    # Heavy carved bowl, waterline at .44, mosaic floor at .205.
    lathe('Carved limestone basin', [(0, 0), (3.16, 0), (3.25, .07), (3.25, .14),
          (3.12, .21), (3.12, .48), (3.06, .53), (2.81, .53), (2.79, .47),
          (2.79, .20), (0, .20)], stone, 128, root)
    lathe('Lower shadow reveal', [(3.115, .185), (3.13, .185), (3.13, .215), (3.115, .215)], joint, 128, root)
    # Radial coping sections have real joints and softly rounded stone edges.
    for block in range(24):
        start = block / 24 * math.tau + .0025
        end = (block + 1) / 24 * math.tau - .0025
        profile = [(2.795, .48), (2.81, .555), (2.86, .60), (3.085, .60),
                   (3.15, .565), (3.17, .51), (3.14, .48)]
        verts = [(r * math.cos(a), r * math.sin(a), z) for a in
                 [start + (end - start) * i / 8 for i in range(9)] for r, z in profile]
        n = len(profile)
        faces = [(i*n+j, i*n+(j+1)%n, (i+1)*n+(j+1)%n, (i+1)*n+j)
                 for i in range(8) for j in range(n)]
        faces += [tuple(reversed(range(n))), tuple(8*n+j for j in range(n))]
        mesh('Segmented limestone coping', verts, faces, coping, root)
    lathe('Mosaic grout bed', [(0, .202), (2.79, .202)], grout, 96, root)
    groups = [[] for _ in tiles]
    for ix in range(-19, 20):
        for iy in range(-19, 20):
            x, y = ix*.14, iy*.14
            if math.hypot(abs(x)+.068, abs(y)+.068) < 2.77:
                groups[rng.randrange(4)].append((x, y))
    for index, positions in enumerate(groups):
        verts = []; faces = []
        for x, y in positions:
            n = len(verts)
            verts.extend([(x-.067,y-.067,.207),(x+.067,y-.067,.207),
                          (x+.067,y+.067,.207),(x-.067,y+.067,.207)])
            faces.append((n,n+1,n+2,n+3))
        mesh('Individual inset mosaic tesserae', verts, faces, tiles[index], root)
    lathe('Bronze basin inlay', [(2.72,.208),(2.735,.208),(2.735,.213),(2.72,.213)], edge, 128, root)
    lathe('Sculpture limestone plinth', [(0,.207),(.67,.207),(.67,.3),(.58,.36),
          (.46,.56),(.43,.68),(0,.68)], coping, 96, root)
    lathe('Sculpture bronze socket', [(0,.675),(.34,.675),(.34,.715),(.29,.75),(0,.75)], bronze, 64, root)

    # A broad closed ribbon with a full turn: a rising wave with an open centre.
    # Rounded elliptical section gives generous cast surfaces and polished edges.
    def centre(t):
        return Vector((.65*math.sin(t)*(1+.12*math.cos(t)),
                       .27*math.sin(2*t)+.12*math.sin(t), 2.02+1.30*math.cos(t)))
    verts=[]; faces=[]; sections=160; sides=16
    for i in range(sections):
        t=i/sections*math.tau
        c=centre(t); tangent=(centre(t+.001)-centre(t-.001)).normalized()
        across=tangent.cross(Vector((0,1,0))).normalized()
        normal=tangent.cross(across).normalized()
        twist=t+.28*math.sin(t)
        wide=across*math.cos(twist)+normal*math.sin(twist)
        thick=tangent.cross(wide).normalized()
        width=.24+.10*(.5+.5*math.cos(t-.5))
        for j in range(sides):
            a=j/sides*math.tau
            p=c+wide*(math.cos(a)*width)+thick*(math.sin(a)*.055)
            verts.append(tuple(p))
    for i in range(sections):
        for j in range(sides):
            faces.append((i*sides+j, ((i+1)%sections)*sides+j,
                          ((i+1)%sections)*sides+(j+1)%sides, i*sides+(j+1)%sides))
    sculpture=mesh('Rising Wave cast bronze sculpture',verts,
                   [tuple(reversed(face)) for face in faces],bronze,root)
    sculpture.data.materials.append(edge);sculpture.data.materials.append(patina)
    for polygon in sculpture.data.polygons:
        section=polygon.index%sides
        polygon.material_index=1 if section in [0,7,8,15] else 2 if section in [10,11,12] else 0

    # Nozzle mouths agree with the runtime ballistic emitter coordinates.
    for i in range(8):
        a=i/8*math.tau
        x,y=.92*math.cos(a),.92*math.sin(a)
        lathe_obj=lathe('Nozzle foot',[(0,.207),(.075,.207),(.075,.245),(.052,.265),(0,.265)],bronze,20,root)
        lathe_obj.location.x=x;lathe_obj.location.y=y
        start=Vector((x,y,.245)); mouth=Vector((x,y,.56))
        tube('Nozzle riser',[start,mouth],.036,bronze,root,16)
        flight=(4.2+math.sqrt(4.2**2+2*9.81*(.56-.44)))/9.81
        speed=(2.3-.92)/flight
        direction=Vector((math.cos(a)*speed,math.sin(a)*speed,4.2)).normalized()
        socket=lathe('Angled jet outlet',[(.043,-.065),(.043,-.01),(.036,.015),(.022,.015),(.022,-.04)],edge,20,root)
        socket.location=mouth;socket.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
        # Dark inset makes each mouth visibly hollow above the waterline.
        hole=lathe('Nozzle aperture',[(0,0),(.022,0)],joint,20,root)
        hole.location=mouth+direction*.008;hole.rotation_euler=socket.rotation_euler
    root['description']='The Rising Wave; original cast bronze sculpture, honed limestone and glazed mosaic'
    root['water_level_metres']=.44
    root['nozzle_radius_metres']=.92
    root['nozzle_height_metres']=.56
    root['units']='metres'


def build():
    reset();bpy.data.orphans_purge(do_recursive=True)
    root=empty('fountain');build_model(root)
    objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
    bpy.context.scene.unit_settings.system='METRIC'
    select([root]+objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source/fountain.blend'))
    # Source retains components; only disposable copies are merged for the runtime.
    copies=[]
    for obj in objects:
        copy=obj.copy();copy.data=obj.data.copy();bpy.context.collection.objects.link(copy);copies.append(copy)
    select(copies);bpy.ops.object.join()
    merged=bpy.context.object
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
    exported=list(bpy.context.selected_objects)
    for obj in exported: obj.name=obj.data.materials[0].name
    select([root]+exported)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/fountain.glb'),export_format='GLB',
                              use_selection=True,export_animations=False,export_yup=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art-source/fountain.blend'))
    assert not bpy.data.is_dirty
    print('COMPLETE fountain',flush=True)

if __name__=='__main__':build()
