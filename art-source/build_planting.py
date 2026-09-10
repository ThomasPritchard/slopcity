"""Original civic planting: editable tree and two stone-bed source/export pairs.

Metres, Z up. Foliage UVs encode root-to-tip wind weight and clump phase;
the runtime maps these to its plantWind attribute. No external asset packs.
"""
import math, random, sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import reset, material, cube, tube, mesh, empty, select
ROOT=Path(__file__).resolve().parents[1]


def wind_mesh(name, verts, faces, weights, mat, root):
    obj=mesh(name,verts,faces,mat,root)
    uv=obj.data.uv_layers.new(name='Wind weight and phase')
    for loop in obj.data.loops: uv.data[loop.index].uv=weights[loop.vertex_index]
    obj['wind_uv_contract']='U root-to-tip weight; V stable clump phase; untextured geometry'
    return obj


def build_tree(root):
    rng=random.Random(9207)
    bark=material('Tree furrowed bark',(.16,.12,.077),.95)
    pale=material('Tree bark ridges',(.24,.195,.127),.97)
    # A bent trunk with asymmetric buttress roots and visible branch forks.
    trunk=[(0,0,0),(.035,-.035,.32),(-.065,.025,.85),(.025,.04,1.45),(-.045,0,2.1),(.04,.025,2.85),(.10,.01,3.5)]
    tube('Gently twisted trunk',trunk,[.22,.165,.125,.108,.085,.06,.015],bark,root,20)
    for i in range(7):
        a=i*math.tau/7+.3;r=rng.uniform(.28,.44)
        tube('Root flare',[(math.cos(a)*r,math.sin(a)*r,.01),(math.cos(a)*.16,math.sin(a)*.16,.11),(.01,0,.45)],[.033,.065,.066],bark,root,8)
    for i in range(13):
        a=i*math.tau/13
        pts=[]
        for x,y,z in trunk[:-1]:
            r=.17*(1-z/4)+.015
            pts.append((x+math.cos(a+z*.1)*r,y+math.sin(a+z*.1)*r,z+.02))
        tube('Long bark furrow',pts,[.008,.01,.007,.006,.004,.002],pale,root,5)
    clusters=[]
    for i in range(15):
        a=i*2.39996;z=1.5+(i%5)*.28;r=1.0+(i%3)*.22
        start=Vector((-.03,0,z));elbow=Vector((math.cos(a)*r*.50,math.sin(a)*r*.50,z+.52));end=Vector((math.cos(a)*r,math.sin(a)*r,z+.87))
        tube('Tapered scaffold branch',[start,elbow,end],[.063,.036,.009],bark,root,9)
        for j in range(3):
            turn=a+(j-1)*.68
            tip=end+Vector((math.cos(turn)*.24,math.sin(turn)*.24,.16+j*.12))
            fork=elbow.lerp(end,.60)
            tube('Fine branch fork',[fork,end.lerp(tip,.45),tip],[.022,.011,.0025],bark,root,6)
            clusters.append((tip,turn))
    clusters.extend([(Vector((0,0,3.50)),0),(Vector((-.28,.16,3.8)),2.1),(Vector((.24,-.15,3.85)),4.2)])
    # Fill the inner crown as well as the branch tips so the foliage reads as one full canopy.
    for i in range(6):
        a=i*math.tau/6
        clusters.append((Vector((math.cos(a)*.55,math.sin(a)*.55,3.0+(i%3)*.30)),a))
    greens=[material('Tree leaves forest',(.115,.205,.07),.88),material('Tree leaves olive',(.21,.30,.10),.87),material('Tree leaves sunlit',(.31,.39,.145),.9)]
    groups=[([],[],[]) for _ in greens]
    for ci,(centre,angle) in enumerate(clusters):
        for k in range(104):
            a=rng.random()*math.tau;r=math.sqrt(rng.random())*.52
            p=centre+Vector((math.cos(a)*r,math.sin(a)*r,rng.uniform(-.35,.40)*math.sqrt(max(.1,1-r/.75))))
            direction=Vector((math.cos(angle+rng.uniform(-1.8,1.8)),math.sin(angle+rng.uniform(-1.8,1.8)),rng.uniform(-.7,.8))).normalized()
            side=direction.cross(Vector((0,0,1))).normalized()
            length=rng.uniform(.19,.30);width=length*rng.uniform(.25,.35)
            fold=direction.cross(side).normalized()*.013
            points=[p-direction*length*.5,p+side*width,p+direction*length*.5,p-side*width,p+fold]
            verts,faces,weights=groups[(ci+k)%3];n=len(verts);verts.extend(map(tuple,points))
            faces.extend([(n,n+1,n+4),(n+1,n+2,n+4),(n+2,n+3,n+4),(n+3,n,n+4)])
            # Whole-leaf canopy sway plus a little extra flex at its outer tip.
            weights.extend([(.24,ci/len(clusters)),(.65,ci/len(clusters)),(1,ci/len(clusters)),(.65,ci/len(clusters)),(.55,ci/len(clusters))])
    for mat,(verts,faces,weights) in zip(greens,groups):wind_mesh('Layered leafy crown',verts,faces,weights,mat,root)
    root['description']='Original broad, airy civic tree with asymmetric forks, bark ridges, root flares and individually folded leaves'
    root['units']='metres'


def build_bed(root,width=4,depth=3):
    rng=random.Random(1278+int(width*100))
    stone=material('Planting warm limestone',(.52,.50,.433),.91)
    coping=material('Planting honed coping',(.67,.645,.565),.77)
    mortar=material('Planting recessed joints',(.255,.25,.209),.98)
    earth=material('Planting dark loam',(.067,.044,.024),1)
    mulch=material('Planting bark mulch',(.14,.09,.047),1)
    pebble=material('Planting river pebbles',(.30,.275,.205),.97)
    cube('Low stone plinth',(0,0,.065),(width-.015,depth-.015,.13),stone,.035,root)
    # Hollow masonry sides, individual blocks and a projecting bevelled coping.
    for along,length,span in [('x',width,depth),('y',depth-.40,width)]:
        count=max(2,round(length/.9));step=length/count
        for sign in [-1,1]:
            for i in range(count):
                v=-length/2+(i+.5)*step
                loc=(v,sign*(span/2-.115),.31) if along=='x' else (sign*(span/2-.115),v,.31)
                size=(step-.011,.22,.39) if along=='x' else (.22,step-.011,.39)
                cube('Individual limestone block',loc,size,stone,.012,root)
            loc=(0,sign*(span/2-.105),.555) if along=='x' else (sign*(span/2-.105),0,.555)
            size=(length,.21,.09) if along=='x' else (.21,length,.09)
            cube('Rounded coping rail',loc,size,coping,.019,root)
    cube('Recessed loam surface',(0,0,.505),(width-.43,depth-.43,.03),earth,.018,root)
    # Natural mulch and a few rounded pebbles stay visible through the planting.
    for i in range(88):
        x=rng.uniform(-width/2+.28,width/2-.28);y=rng.uniform(-depth/2+.28,depth/2-.28)
        obj=cube('Scattered bark chip',(x,y,.527),(rng.uniform(.025,.075),rng.uniform(.015,.035),.012),mulch,0,root)
        obj.rotation_euler.z=rng.random()*math.tau
    for i in range(22):
        a=rng.random()*math.tau;r=rng.uniform(.28,.60)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(math.cos(a)*r,math.sin(a)*r,.536))
        obj=bpy.context.object;obj.name='Soil pebble';obj.scale=(.035,.026,.015);obj.data.materials.append(pebble);obj.parent=root
    grass=[material('Planting grass meadow',(.15,.235,.063),.93),material('Planting grass detail',(.265,.345,.105),.9)]
    seed=material('Planting seed heads',(.39,.32,.15),.95)
    groups=[([],[],[]) for _ in grass];seedverts=[];seedfaces=[];seedweights=[]
    nx=max(4,round((width-.6)/.34));ny=max(4,round((depth-.6)/.35))
    for ix in range(nx):
        for iy in range(ny):
            x=-width/2+.36+ix*(width-.72)/(nx-1)+rng.uniform(-.09,.09)
            y=-depth/2+.36+iy*(depth-.72)/(ny-1)+rng.uniform(-.09,.09)
            if math.hypot(x,y)<.43:continue
            phase=rng.random()
            for blade in range(20):
                group=blade%2;verts,faces,weights=groups[group]
                a=rng.random()*math.tau;h=rng.uniform(.29,.66);lean=rng.uniform(.13,.36);w=rng.uniform(.020,.034)
                base=Vector((x+rng.uniform(-.065,.065),y+rng.uniform(-.065,.065),.524))
                direction=Vector((math.cos(a),math.sin(a),0));side=Vector((-math.sin(a),math.cos(a),0))
                n=len(verts)
                for row in range(5):
                    t=row/5;centre=base+direction*lean*t*t+Vector((0,0,h*(t-.18*t*t)))
                    breadth=w*(1-t)**.75
                    verts.extend([tuple(centre-side*breadth),tuple(centre+Vector((0,0,.010*(1-t)))),tuple(centre+side*breadth)])
                    weights.extend([(t*t,phase)]*3)
                tip=base+direction*lean+Vector((0,0,h*.82));verts.append(tuple(tip));weights.append((1,phase))
                for row in range(4):
                    b=n+row*3
                    faces.extend([(b,b+3,b+1),(b+1,b+3,b+4),(b+1,b+4,b+2),(b+2,b+4,b+5)])
                faces.extend([(n+12,n+15,n+13),(n+13,n+15,n+14)])
            # Sparse arching seed stems bring a taller layer above the blade clumps.
            if (ix+iy)%4==0:
                a=rng.random()*math.tau;direction=Vector((math.cos(a),math.sin(a),0));side=Vector((-math.sin(a),math.cos(a),0))
                base=Vector((x,y,.524));h=rng.uniform(.62,.83);n=len(seedverts)
                for row in range(6):
                    t=row/5;p=base+direction*.12*t*t+Vector((0,0,h*t));w=.004 if row<4 else .016
                    seedverts.extend([tuple(p-side*w),tuple(p+side*w)]);seedweights.extend([(t*t,phase)]*2)
                for row in range(5):
                    b=n+row*2;seedfaces.extend([(b,b+2,b+1),(b+1,b+2,b+3)])
    for mat,(verts,faces,weights) in zip(grass,groups):wind_mesh('Curved folded grass blades',verts,faces,weights,mat,root)
    wind_mesh('Fine meadow seed heads',seedverts,seedfaces,seedweights,seed,root)
    root['soil_height_metres']=.52;root['stone_bounds_metres']=[width,depth,.6]
    root['description']='Hollow segmented limestone bed with honed coping, recessed loam, scattered mulch and layered wind-ready meadow grass'


def save_pair(name,builder):
    reset();bpy.data.orphans_purge(do_recursive=True)
    root=empty(name);builder(root)
    bpy.context.scene.unit_settings.system='METRIC'
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    select([root]+objects);bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/f'{name}.blend'))
    groups={}
    for obj in objects:
        copy=obj.copy();copy.data=obj.data.copy();bpy.context.collection.objects.link(copy)
        groups.setdefault(copy.data.materials[0].name,[]).append(copy)
    exported=[]
    for name_mat,group in groups.items():
        select(group)
        if len(group)>1:bpy.ops.object.join()
        obj=bpy.context.object;obj.name=name_mat;exported.append(obj)
    select([root]+exported)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models'/f'{name}.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art-source'/f'{name}.blend'));assert not bpy.data.is_dirty
    print('COMPLETE planting',name,flush=True)


if __name__=='__main__':
    save_pair('tree',build_tree)
    save_pair('planter',build_bed)
    save_pair('entrance-planter',lambda root:build_bed(root,2.6,2.6))
