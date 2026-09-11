"""Original Slop City assets. Run in an isolated Blender --background --factory-startup process.
Units: metres. Blender Z up, character faces -Y. All outputs stay in this repository.
"""
import bpy, math, random, json, sys
sys.path.insert(0,str(__import__("pathlib").Path(__file__).resolve().parent))
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(71)

def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

def material(name, colour, roughness=.65, metallic=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*colour, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*colour, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return m

def smooth(obj):
    if obj.type == 'MESH':
        for face in obj.data.polygons: face.use_smooth = True
    return obj

def mesh(name, verts, faces, mat, parent=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj)
    if mat: obj.data.materials.append(mat)
    if parent: obj.parent = parent
    return smooth(obj)

def bevel(obj, width=.015, segments=3):
    mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL'); mod.width = width; mod.segments = segments
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def cube(name, location, scale, mat, radius=.01, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object; obj.name = name; obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat: obj.data.materials.append(mat)
    if radius: bevel(obj, radius)
    if parent: obj.parent = parent
    return obj

def ellipsoid(name, location, scale, mat, parent=None, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=location)
    obj=bpy.context.object; obj.name=name; obj.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if parent: obj.parent=parent
    return smooth(obj)

def loft(name, rows, mat, segments=32, parent=None):
    # Each row: centre x/y/z, ellipse radii x/y; consistent rings avoid capsule seams.
    verts=[]; faces=[]
    for x,y,z,rx,ry in rows:
        for i in range(segments):
            a=i/segments*math.tau; verts.append((x+math.cos(a)*rx,y+math.sin(a)*ry,z))
    for j in range(len(rows)-1):
        for i in range(segments):
            a=j*segments+i; b=j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple((len(rows)-1)*segments+i for i in range(segments)))
    return mesh(name,verts,faces,mat,parent)

def tube(name, points, radius, mat, parent=None, sides=10):
    verts=[]; faces=[]
    for i, point in enumerate(points):
        p=Vector(point); d=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        d.normalize(); ref=Vector((0,0,1)) if abs(d.z)<.9 else Vector((0,1,0))
        u=d.cross(ref).normalized(); v=d.cross(u).normalized()
        r=radius[i] if isinstance(radius,list) else radius
        for k in range(sides): verts.append(tuple(p+r*(math.cos(k/sides*math.tau)*u+math.sin(k/sides*math.tau)*v)))
    for i in range(len(points)-1):
        for k in range(sides):
            a=i*sides+k; b=i*sides+(k+1)%sides; faces.append((a,b,b+sides,a+sides))
    faces += [tuple(reversed(range(sides))), tuple((len(points)-1)*sides+k for k in range(sides))]
    return mesh(name, verts, faces, mat, parent)

def lathe(name, profile, mat, segments=96, parent=None):
    verts=[]; faces=[]
    for radius,z in profile:
        for i in range(segments):
            a=i/segments*math.tau; verts.append((radius*math.cos(a),radius*math.sin(a),z))
    for j in range(len(profile)-1):
        for i in range(segments):
            a=j*segments+i; b=j*segments+(i+1)%segments; faces.append((a,b,b+segments,a+segments))
    return mesh(name,verts,faces,mat,parent)

def empty(name):
    obj=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(obj); return obj

def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]

def export(name, objects):
    select(objects)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_yup=True, export_apply=False)
    print('EXPORTED',name,flush=True)

def join_by_material(objects):
    # Keep material surfaces together to avoid a draw call per leaf/button/plank.
    groups={}
    for obj in objects:
        if obj.type=='MESH' and len(obj.data.materials)==1: groups.setdefault(obj.data.materials[0].name,[]).append(obj)
    result=[]
    for name, group in groups.items():
        select(group); bpy.ops.object.join(); obj=bpy.context.object; obj.name=name; result.append(obj)
    return result

def sneaker(cx, bone, bind, leather, rubber, cream, lining, accent):
    # Rounded, asymmetric last with a distinct heel, toe box and layered cupsole.
    outline=[]
    right=[(0,-.209),(.04,-.194),(.062,-.163),(.069,-.12),(.066,-.06),(.06,.02),(.055,.07),(.03,.1),(0,.104)]
    controls=right+[(-x,y) for x,y in reversed(right[1:-1])]
    for i in range(len(controls)):
        p0,p1,p2,p3=[Vector(controls[k%len(controls)]) for k in [i-1,i,i+1,i+2]]
        for j in range(4):
            t=j/4;v=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
            outline.append((cx+v.x,v.y))
    n=len(outline)
    def sole_layer(name,levels,mat):
        verts=[];faces=[]
        for z,scale in levels:
            for x,y in outline:
                lift=max(0,(-y-.13)/.075)*.007
                verts.append((cx+(x-cx)*scale,-.055+(y+.055)*scale,z+lift))
        for j in range(len(levels)-1):
            for i in range(n):
                a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
        faces.extend([tuple(reversed(range(n))),tuple((len(levels)-1)*n+i for i in range(n))])
        bind(mesh(name,verts,faces,mat),bone)
    sole_layer('Textured rubber outsole',[(.013,.94),(.018,1),(.029,1)],rubber)
    sole_layer('Sculpted cupsole',[(.029,1),(.043,1.015),(.058,.97)],cream)
    sole_layer('Cupsole stitch line',[(.043,1.016),(.045,1.016)],leather)
    sections=[(-.201,.012,.078),(-.187,.042,.082),(-.158,.057,.097),(-.12,.06,.11),(-.08,.059,.137),(-.035,.056,.16),(.015,.052,.167),(.065,.049,.15),(.089,.026,.112),(.095,.006,.07)]
    verts=[];faces=[];arc=20
    for y,w,h in sections:
        for j in range(arc+1):
            a=j/arc*math.pi;base=.060+max(0,(-y-.13)/.075)*.007;verts.append((cx+math.cos(a)*w,y,base+math.sin(a)*(h-base)))
    for i in range(len(sections)-1):
        for j in range(arc):
            a=i*(arc+1)+j;b=a+1;faces.append((a,a+arc+1,b+arc+1,b))
    faces.extend([tuple(range(arc+1)),tuple((len(sections)-1)*(arc+1)+j for j in reversed(range(arc+1)))])
    bind(mesh('Shaped leather upper',verts,faces,leather),bone)
    def upper(y,x):
        for (ya,wa,ha),(yb,wb,hb) in zip(sections,sections[1:]):
            if ya<=y<=yb:
                t=(y-ya)/(yb-ya);w=wa+(wb-wa)*t;h=ha+(hb-ha)*t
                base=.060+max(0,(-y-.13)/.075)*.007
                return base+(h-base)*math.sqrt(max(0,1-(x/w)**2))
        return .1
    # A darker tongue, actual crossed laces, eyelets, and curved toe-panel stitching.
    tongue=[];tongue_faces=[]
    for i in range(13):
        y=-.105+i*.118/12
        for j in range(9):
            x=-.022+j*.044/8;tongue.append((cx+x,y,upper(y,x)+.0025))
    for i in range(12):
        for j in range(8):
            a=i*9+j;tongue_faces.append((a,a+1,a+10,a+9))
    bind(mesh('Curved woven tongue',tongue,tongue_faces,lining),bone)
    for j in range(5):
        y=-.09+j*.019
        for side in [-1,1]:
            x=side*.026
            bind(ellipsoid('Lace eyelet',(cx+x,y,upper(y,x)+.003),(.0037,.0037,.0018),lining,segments=12,rings=8),bone)
        for side in [-1,1]:
            points=[]
            for k in range(7):
                t=k/6;x=side*(.026-.052*t);yy=y+.014*t
                points.append((cx+x,yy,upper(yy,x)+.006))
            bind(tube('Crossed cotton lace',points,.00165,cream,sides=6),bone)
    for y in [-.139]:
        points=[(cx+x,y,upper(y,x)+.0018) for x in [-.047+i*.094/20 for i in range(21)]]
        bind(tube('Toe panel stitching',points,.0011,cream,sides=6),bone)
    for side in [-1,1]:
        points=[(cx+side*.055,-.1,.082),(cx+side*.054,-.055,.09),(cx+side*.049,.018,.106),(cx+side*.039,.065,.113)]
        bind(tube('Quarter panel seam',points,.0015,lining,sides=6),bone)
    bind(cube('Contrast heel tab',(cx,.086,.115),(.038,.009,.039),accent,.006),bone)
    for j in range(8):
        bind(cube('Outsole tread',(cx,-.16+j*.029,.014),(.083,.009,.008),rubber,.002),bone)

def character():
    reset()
    skin=material('Skin',(.62,.39,.25),.62)
    skin.node_tree.nodes.get('Principled BSDF').inputs['Subsurface Weight'].default_value=.05
    cloth=material('Cloth_Main',(.18,.25,.21),.88)
    inner=material('Cotton_Inner',(.81,.78,.69),.94)
    denim=material('Trousers',(.12,.16,.18),.86)
    seam=material('Seam',(.22,.27,.25),.9)
    shoe=material('Shoe_Leather',(.72,.69,.6),.68)
    sole=material('Shoe_Rubber',(.48,.47,.43),.92)
    hair=material('Hair',(.055,.038,.029),.9)
    eye=material('Eye_White',(.71,.70,.61),.34)
    iris=material('Iris',(.055,.10,.075),.34)
    pupil=material('Pupil',(.006,.009,.008),.2)
    lip=material('Lips',(.35,.16,.115),.72)
    brass=material('Buttons',(.3,.26,.17),.42,.7)
    weights={};parts={}
    def bind(obj, bone): weights[obj.name]=bone; return obj
    bind(loft('Tailored jacket body',[(0,0,.91,.157,.109),(0,0,.95,.168,.113),(0,0,1.1,.159,.11),(0,0,1.24,.175,.122),(0,0,1.36,.203,.122),(0,0,1.45,.225,.11),(0,0,1.49,.178,.087),(0,0,1.525,.085,.065),(0,0,1.539,.06,.052)],cloth,48),'spine')
    bind(loft('Neck',[(0,0,1.46,.062,.055),(0,0,1.59,.055,.05),(0,0,1.62,.052,.048)],skin),'head')
    # Collar points, placket and top-stitched pockets add actual garment construction.
    for side in [-1,1]:
        verts=[(side*.045,-.082,1.527),(side*.14,-.115,1.466),(side*.085,-.149,1.407),(side*.025,-.15,1.47)]
        collar=bind(mesh('Folded collar',verts,[(0,1,2,3)],cloth),'spine')
        solid=collar.modifiers.new('Sewn collar thickness','SOLIDIFY');solid.thickness=.003
        bpy.context.view_layer.objects.active=collar;bpy.ops.object.modifier_apply(modifier=solid.name)
        pocket=bind(cube('Chest pocket',(side*.113,-.128,1.29),(.085,.01,.105),cloth,.008),'spine')
        bind(cube('Pocket welt',(side*.113,-.137,1.34),(.084,.01,.009),seam,.002),'spine')
        bind(tube('Pocket stitching',[(side*.075,-.136,1.33),(side*.075,-.137,1.244),(side*.15,-.137,1.244)],.0015,seam,sides=5),'spine')
    bind(cube('Button placket',(0,-.134,1.225),(.023,.011,.55),cloth,.005),'spine')
    for z in [1.0,1.1,1.2,1.3,1.4,1.48]: bind(ellipsoid('Horn button',(0,-.143,z),(.008,.004,.008),brass,segments=12,rings=8),'spine')

    # Face: shaped jaw, cheekbones and a continuous nose/lip relief in the head surface.
    rows=[(1.568,.029,.035),(1.58,.055,.052),(1.603,.073,.064),(1.63,.083,.068),(1.66,.087,.073),(1.69,.094,.079),(1.72,.096,.078),(1.75,.094,.073),(1.78,.089,.070),(1.81,.077,.06),(1.833,.043,.034),(1.839,.006,.005)]
    verts=[]; faces=[]; count=64
    for z,rx,ry in rows:
        for i in range(count):
            a=i/count*math.tau; x=math.cos(a)*rx; y=math.sin(a)*ry
            front=max(0,-math.sin(a))**18
            y-=front*(.031*math.exp(-((z-1.699)/.025)**2)+.008*math.exp(-((z-1.653)/.01)**2))
            verts.append((x,y,z))
    for j in range(len(rows)-1):
        for i in range(count): a=j*count+i; b=j*count+(i+1)%count; faces.append((a,b,b+count,a+count))
    head=bind(mesh('Sculpted head',verts,faces,skin),'head')
    sub=head.modifiers.new('Facial surface','SUBSURF');sub.levels=2; bpy.context.view_layer.objects.active=head; bpy.ops.object.modifier_apply(modifier=sub.name)
    for side in [-1,1]:
        bind(ellipsoid('Ear',(side*.092,.004,1.692),(.017,.023,.038),skin),'head')
        bind(ellipsoid('Ear concha',(side*.101,-.014,1.695),(.008,.004,.017),lip,segments=16,rings=10),'head')
        bind(ellipsoid('Eye',(side*.043,-.073,1.728),(.021,.015,.010),eye),'head')
        bind(ellipsoid('Iris',(side*.043,-.0873,1.728),(.007,.002,.0075),iris,segments=24,rings=12),'head')
        bind(ellipsoid('Pupil',(side*.043,-.089,1.728),(.0035,.001,.004),pupil,segments=16,rings=10),'head')
        lid=[(side*.043+math.cos(a)*.022,-.078-math.sin(a)*.004,1.728+math.sin(a)*.011) for a in [i/12*math.pi for i in range(13)]]
        bind(tube('Upper eyelid',lid,.003,skin,sides=8),'head')
        brow=[(side*.043+(i-4)*.005,-.074-(1-abs(i-4)/4)*.005,1.75+math.sin(i/8*math.pi)*.004) for i in range(9)]
        bind(tube('Brow',brow,.0035,hair,sides=8),'head')
    bind(tube('Upper lip',[(-.028,-.085,1.653),(-.013,-.098,1.653),(0,-.103,1.651),(.013,-.098,1.653),(.028,-.085,1.653)],.0033,lip,sides=8),'head')
    bind(tube('Lower lip',[(-.028,-.084,1.648),(0,-.103,1.645),(.028,-.084,1.648)],.004,lip,sides=8),'head')
    # Fitted side-part silhouette: continuous scalp surface, close sides and a soft crown.
    verts=[];faces=[];rings=32;sectors=80
    def hair_point(phi,t):
        front=max(0,-math.sin(phi))
        theta=t*(1.86-.53*front**.45)
        return (-.008*math.sin(theta)*math.cos(theta), math.sin(theta), math.cos(theta))
    for j in range(rings+1):
        for i in range(sectors):
            phi=i/sectors*math.tau;shift,st,ct=hair_point(phi,max(.001,j/rings))
            verts.append((math.cos(phi)*st*.099+shift,.006+math.sin(phi)*st*.085,1.754+ct*.101+.003*math.sin(phi*7+ct*5)**2*st))
    for j in range(rings):
        for i in range(sectors):
            a=j*sectors+i;b=j*sectors+(i+1)%sectors;faces.append((a,a+sectors,b+sectors,b))
    cap=bind(mesh('Fitted side part',verts,faces,hair),'head')
    for side in [-1,1]:
        suffix='L' if side>0 else 'R'; thigh=f'thigh.{suffix}'; shin=f'shin.{suffix}'; upper=f'upper_arm.{suffix}'; fore=f'forearm.{suffix}'; hand=f'hand.{suffix}'; foot=f'foot.{suffix}'
        leg=loft('Trouser leg',[(side*.098,0,.91,.097,.105),(side*.102,0,.84,.1,.109),(side*.102,.002,.7,.085,.093),(side*.105,.003,.53,.067,.075),(side*.104,0,.45,.067,.071),(side*.1,0,.29,.058,.064),(side*.1,0,.12,.053,.059)],denim,32)
        bind(leg,('leg',suffix))
        bind(tube('Outer trouser seam',[(side*.19,0,.88),(side*.18,.001,.70),(side*.17,0,.5),(side*.15,0,.15)],.0016,seam,sides=6),('leg',suffix))
        bind(cube('Trouser cuff',(side*.1,0,.13),(.11,.125,.034),denim,.016),shin)
        before=set(weights)
        sneaker(side*.1, foot, bind, shoe, sole, inner, denim, cloth)
        for name in set(weights)-before:parts[name]='sneakers'
        sleeve=loft('Jacket sleeve',[(side*.211,0,1.451,.072,.076),(side*.235,0,1.39,.077,.077),(side*.26,0,1.27,.068,.069),(side*.275,0,1.16,.06,.06),(side*.282,-.005,1.09,.056,.055),(side*.288,-.012,.988,.047,.046),(side*.292,-.015,.952,.045,.043)],cloth,28)
        bind(sleeve,('arm',suffix))
        bind(loft('Jacket cuff',[(side*.292,-.015,.947,.047,.045),(side*.291,-.013,.984,.049,.047)],cloth,28),fore)
        bind(ellipsoid('Cuff button',(side*.335,-.015,.964),(.004,.007,.007),brass,segments=12,rings=8),fore)
        bind(loft('Wrist',[(side*.292,-.015,.962,.033,.032),(side*.294,-.018,.90,.034,.025)],skin,20),hand)
        bind(ellipsoid('Palm',(side*.296,-.018,.871),(.04,.025,.06),skin,segments=24,rings=14),hand)
        for i in range(4):
            px=side*.296+(i-1.5)*.018; length=[.065,.077,.073,.055][i]
            points=[(px,-.019,.844),(px,-.025,.818),(px,-.032,.844-length)]
            bind(tube('Finger',points,[.0095,.009,.0065],skin,sides=10),hand)
            bind(ellipsoid('Fingertip',points[-1],(.0065,.007,.007),skin,segments=12,rings=8),hand)
        bind(tube('Thumb',[(side*.264,-.021,.89),(side*.249,-.045,.869),(side*.245,-.057,.846)],[.013,.010,.007],skin,sides=10),hand)

    # Give every wearable its own material groups, even where materials were shared.
    top_names=('Tailored jacket','Folded collar','Chest pocket','Pocket welt','Pocket stitching','Button placket','Horn button','Jacket sleeve','Jacket cuff','Cuff button')
    bottom_names=('Trouser leg','Outer trouser seam','Trouser cuff')
    copies={}
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH':continue
        part=parts.get(obj.name) or ('utility' if obj.name.startswith(top_names) else 'chinos' if obj.name.startswith(bottom_names) else None)
        if part:
            source=obj.data.materials[0];key=(part,source.name)
            if key not in copies:
                copies[key]=source.copy();copies[key].name='wear_'+part+'__'+source.name
            obj.data.materials[0]=copies[key]
    from clothing import add_clothing
    add_clothing(bind)

    # One deforming skeleton. Weight long sleeves/trousers across elbow and knee transitions.
    armdata=bpy.data.armatures.new('CitizenRig'); rig=bpy.data.objects.new('CitizenRig',armdata); bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
    def bone(name,head,tail,parent=None):
        b=armdata.edit_bones.new(name);b.head=head;b.tail=tail
        if parent:b.parent=armdata.edit_bones[parent]
    bone('root',(0,0,0),(0,0,.15));bone('hips',(0,0,.87),(0,0,1.0),'root');bone('spine',(0,0,1.0),(0,0,1.48),'hips');bone('head',(0,0,1.48),(0,0,1.83),'spine')
    for side in [-1,1]:
        s='L' if side>0 else 'R'
        bone(f'thigh.{s}',(side*.1,0,.91),(side*.105,0,.49),'hips');bone(f'shin.{s}',(side*.105,0,.49),(side*.1,0,.12),f'thigh.{s}');bone(f'foot.{s}',(side*.1,0,.12),(side*.1,-.15,.08),f'shin.{s}')
        bone(f'upper_arm.{s}',(side*.211,0,1.451),(side*.277,0,1.16),'spine');bone(f'forearm.{s}',(side*.277,0,1.16),(side*.292,-.015,.96),f'upper_arm.{s}');bone(f'hand.{s}',(side*.292,-.015,.96),(side*.296,-.02,.83),f'forearm.{s}')
    bpy.ops.object.mode_set(mode='OBJECT')
    objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
    for obj in objects:
        spec=weights[obj.name]
        if isinstance(spec,tuple):
            kind,s=spec; a=f'thigh.{s}' if kind=='leg' else f'upper_arm.{s}'; b=f'shin.{s}' if kind=='leg' else f'forearm.{s}'; mid=.49 if kind=='leg' else 1.16
            ga=obj.vertex_groups.new(name=a);gb=obj.vertex_groups.new(name=b)
            shoulder=obj.vertex_groups.new(name='spine') if kind=='arm' else None
            for v in obj.data.vertices:
                point=obj.matrix_world@v.co;z=point.z;factor=max(0,min(1,(z-mid+.045)/.09))
                anchored=max(0,min(1,(z-1.34)/.11))*max(0,min(1,(.24-abs(point.x))/.10)) if shoulder else 0
                if anchored>0:shoulder.add([v.index],anchored,'REPLACE')
                if factor>0:ga.add([v.index],factor*(1-anchored),'REPLACE')
                if factor<1:gb.add([v.index],(1-factor)*(1-anchored),'REPLACE')
        else:obj.vertex_groups.new(name=spec).add(list(range(len(obj.data.vertices))),1,'REPLACE')
        mod=obj.modifiers.new('Citizen deformation','ARMATURE');mod.object=rig;obj.parent=rig
    # Combine by material while preserving weight groups and deformation.
    joined=join_by_material(objects)
    for obj in joined:
        for mod in list(obj.modifiers):obj.modifiers.remove(mod)
        mod=obj.modifiers.new('Citizen deformation','ARMATURE');mod.object=rig;obj.parent=rig
    bpy.context.scene.render.fps=30
    for action_name,frames in [('Idle',60),('Walk',30),('Wave',84),('Sit',60)]:
        rig.animation_data_create(); rig.animation_data.action=None
        for frame in range(1,frames+2,3):
            phase=(frame-1)/frames*math.tau
            for pb in rig.pose.bones: pb.rotation_mode='XYZ';pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
            if action_name=='Idle':rig.pose.bones['spine'].rotation_euler.x=math.sin(phase)*.012
            elif action_name=='Walk':
                for side,offset in [('L',0),('R',math.pi)]:
                    stride=math.sin(phase+offset)
                    rig.pose.bones[f'thigh.{side}'].rotation_euler.x=stride*.35
                    rig.pose.bones[f'shin.{side}'].rotation_euler.x=-max(0,-stride)*.5
                    rig.pose.bones[f'foot.{side}'].rotation_euler.x=max(0,-stride)*.12
                    rig.pose.bones[f'upper_arm.{side}'].rotation_euler.x=-stride*.2
                rig.pose.bones['hips'].location.y=abs(math.sin(phase))*.015
            elif action_name=='Sit':
                # Root stays on the ground. Lower the pelvis onto the .5075m bench;
                # 75-degree thighs leave the lower legs vertical and soles grounded.
                rig.pose.bones['hips'].location.y=-.30
                for side in ['L','R']:
                    rig.pose.bones[f'thigh.{side}'].rotation_euler.x=-math.radians(75)
                    rig.pose.bones[f'shin.{side}'].rotation_euler.x=math.radians(75)
                    rig.pose.bones[f'upper_arm.{side}'].rotation_euler.x=-.15
                    rig.pose.bones[f'forearm.{side}'].rotation_euler.x=-.9
                rig.pose.bones['spine'].rotation_euler.x=math.sin(phase)*.006
            else:
                # Ease into a bent-elbow greeting; the hand does the waving.
                t=max(0,min(1,(frame-1)/15,(frames+1-frame)/21))
                envelope=t*t*(3-2*t)
                rig.pose.bones['upper_arm.R'].rotation_euler.z=1.10*envelope
                rig.pose.bones['upper_arm.R'].rotation_euler.x=-.12*envelope
                rig.pose.bones['forearm.R'].rotation_euler.z=1.65*envelope
                rig.pose.bones['hand.R'].rotation_euler.z=math.sin((frame-16)/48*math.tau*2)*.19*envelope
                rig.pose.bones['hand.R'].rotation_euler.y=.10*envelope
                rig.pose.bones['head'].rotation_euler.z=-.025*envelope
                rig.pose.bones['spine'].rotation_euler.z=.012*envelope
            for pb in rig.pose.bones:
                pb.keyframe_insert('rotation_euler',frame=frame,group=pb.name)
                if pb.name=='hips':pb.keyframe_insert('location',frame=frame,group=pb.name)
        rig.animation_data.action.name=action_name;rig.animation_data.action.use_fake_user=True
        track=rig.animation_data.nla_tracks.new();track.name=action_name;track.strips.new(action_name,1,rig.animation_data.action);track.mute=True
    rig.animation_data.action=None
    for pb in rig.pose.bones:pb.rotation_euler=(0,0,0);pb.location=(0,0,0)
    bpy.context.scene.frame_set(1)
    from add_citizen_interactions import add_interaction_actions
    add_interaction_actions(rig)
    export('citizen', [rig]+joined)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/'citizen.blend'))
    print('CHARACTER',sum(len(obj.data.polygons) for obj in joined),'faces',flush=True)

if __name__=='__main__': character()
