import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import *

reset()
stone=material('Honed limestone',(.56,.54,.47),.86)
edge=material('Limestone edge',(.67,.64,.56),.78)
metal=material('Powder-coated bronze',(.095,.13,.115),.38,.65)
brass=material('Brushed brass',(.47,.35,.16),.32,.8)
wood=material('Warm oak',(.32,.20,.105),.75)
woodlight=material('Light oak',(.42,.29,.16),.7)
tile=material('Basin mosaic',(.12,.26,.25),.34)
grout=material('Mosaic grout',(.38,.44,.38),.87)
dark=material('Soil',(.085,.075,.05),1)
cream=material('Cotton upholstery',(.68,.64,.53),.94)
light=material('Warm diffuser',(.9,.84,.63),.4)
light.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.9,.8,.5,1)
light.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.7

def finish(name, root, objects):
    joined=join_by_material(objects)
    for obj in joined: obj.parent=root
    export(name,[root]+joined)
    return root,joined

def asset(name,builder):
    old=set(bpy.context.scene.objects)
    root=empty(name); builder(root)
    objects=[obj for obj in bpy.context.scene.objects if obj not in old and obj.type=='MESH']
    return finish(name,root,objects)

def make_bench(root):
    for i in range(6):cube('Rounded oak seat',(0,-.24+i*.095,.48),(2.35,.082,.055),wood if i%2 else woodlight,.012,root)
    for i in range(4):cube('Back slat',(0,.29,.68+i*.095),(2.35,.048,.081),wood if i%2 else woodlight,.013,root)
    for x in [-.83,.83]:
        tube('Cast support',[(x,-.2,.06),(x,-.24,.37),(x,-.2,.46),(x,.24,.46),(x,.31,.96)],.029,metal,root,sides=12)
        cube('Foot plate',(x,0,.035),(.15,.56,.028),metal,.014,root)
        for y in [-.16,.18]:ellipsoid('Bolt',(x,y,.055),(.012,.012,.005),brass,root,12,8)
    for x in [-1.08,1.08]:tube('Armrest',[(x,-.23,.53),(x,-.24,.69),(x,-.16,.73),(x,.24,.73),(x,.29,.65)],.018,metal,root,12)

def make_lamp(root):
    lathe('Post',[(.14,0),(.14,.1),(.075,.16),(.056,.2),(.043,3.5),(.065,3.56)],metal,40,root)
    cube('Lantern frame',(0,0,3.76),(.4,.4,.43),metal,.028,root)
    cube('Lantern light',(0,0,3.76),(.335,.335,.32),light,.015,root)
    for x in [-.19,.19]:
        for y in [-.19,.19]:cube('Lantern stile',(x,y,3.76),(.035,.035,.44),metal,.005,root)
    cube('Cap',(0,0,4.0),(.48,.48,.05),metal,.016,root)

def make_fountain(root):
    lathe('Basin stone',[(0,0),(3.18,0),(3.25,.065),(3.25,.13),(3.12,.18),(3.12,.44),(3.18,.47),(3.18,.54),(3.1,.58),(2.86,.58),(2.80,.51),(2.8,.18),(0,.18)],stone,128,root)
    lathe('Coping polished edge',[(2.82,.50),(2.84,.55),(2.9,.58),(3.09,.58),(3.15,.55)],edge,128,root)
    lathe('Inner grout floor',[(0,.19),(2.79,.19)],grout,96,root)
    # Inset small mosaic tiles remain visible through the water.
    for ix in range(-13,14):
        for iy in range(-13,14):
            x=ix*.2;y=iy*.2
            if math.hypot(x,y)<2.69:cube('Mosaic tile',(x,y,.198),(.19,.19,.016),tile,0,root)
    lathe('Pedestal',[(.7,.19),(.7,.3),(.51,.35),(.37,.8),(.28,1.1)],edge,80,root)
    # Three intersecting continuous bronze loops form an original civic sculpture.
    for k in range(3):
        pts=[]
        for i in range(97):
            a=i/96*math.tau; radius=.65+.09*math.sin(3*a+k)
            pts.append((math.cos(a)*radius*math.cos(k*math.pi/3),math.cos(a)*radius*math.sin(k*math.pi/3),1.65+math.sin(a)*.79))
        tube('Bronze ribbon',pts,.026,brass,root,12)
    for i in range(8):
        a=i/8*math.tau
        nozzle=lathe('Water nozzle',[(.035,0),(.035,.065),(.022,.09)],brass,16,root);nozzle.location=(math.cos(a)*.65,math.sin(a)*.65,.2)

def make_planter(root):
    cube('Stone planter',(0,0,.3),(4,3,.6),stone,.065,root)
    cube('Recessed planting bed',(0,0,.612),(3.78,2.78,.035),dark,.04,root)
    cube('Front reveal',(0,-1.506,.44),(3.7,.014,.022),brass,.005,root)
    greens=[material('Groundcover sage',(.17,.24,.12),.94),material('Groundcover olive',(.28,.32,.16),.95)]
    for k,green in enumerate(greens):
        verts=[];faces=[]
        for i in range(240):
            x=random.uniform(-1.75,1.75);y=random.uniform(-1.25,1.25);a=random.random()*math.tau;length=random.uniform(.12,.38);w=random.uniform(.025,.05)
            base=Vector((x,y,.63));tip=base+Vector((math.cos(a)*length*.6,math.sin(a)*length*.6,length));side=Vector((-math.sin(a)*w,math.cos(a)*w,0));mid=(base+tip)*.5
            n=len(verts);verts.extend([tuple(base),tuple(mid+side),tuple(tip),tuple(mid-side),tuple(mid+Vector((0,0,.025)))]);faces.extend([(n,n+1,n+4),(n+1,n+2,n+4),(n+2,n+3,n+4),(n+3,n,n+4)])
        mesh('Living groundcover',verts,faces,green,root)

def make_tree(root):
    bark=material('Olive bark',(.19,.16,.11),.98)
    tube('Shaped trunk',[(0,0,0),(.05,0,.8),(-.08,.035,1.6),(.07,0,2.5),(0,.07,3.2)],[.14,.12,.09,.065,.028],bark,root,14)
    for i in range(18):
        a=i*2.4;z=1.8+(i%5)*.25;r=.75+(i%3)*.3
        tube('Branch',[(0,0,z),(math.cos(a)*r*.45,math.sin(a)*r*.45,z+.38),(math.cos(a)*r,math.sin(a)*r,z+.75)],[.044,.025,.004],bark,root,8)
    for k,colour in enumerate([(.21,.29,.15),(.32,.37,.2),(.17,.24,.14),(.4,.44,.27)]):
        green=material('Olive leaves '+str(k),colour,.88)
        verts=[];faces=[]
        for i in range(680):
            # Broad airy canopy, with distinct pointed leaf surfaces and open gaps.
            a=random.random()*math.tau;r=math.sqrt(random.random())*1.48
            p=Vector((math.cos(a)*r,math.sin(a)*r,2.8+random.uniform(-.25,1.15)*(1-r/2.3)))
            d=Vector((random.uniform(-1,1),random.uniform(-1,1),random.uniform(-.3,.6))).normalized()*random.uniform(.11,.22)
            side=d.cross(Vector((0,0,1))).normalized()*random.uniform(.018,.038)
            n=len(verts);verts.extend([tuple(p-d/2),tuple(p+side),tuple(p+d/2),tuple(p-side),tuple(p+Vector((0,0,.012)))]);faces.extend([(n,n+1,n+4),(n+1,n+2,n+4),(n+2,n+3,n+4),(n+3,n,n+4)])
        mesh('Olive canopy',verts,faces,green,root)

assets=[]
for name,builder in [('bench',make_bench),('lamp',make_lamp),('fountain',make_fountain),('planter',make_planter),('tree',make_tree)]:
    assets.append(asset(name,builder))
for i,(root,objects) in enumerate(assets):root.location.x=i*9
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/'street-kit.blend'))

reset()
# A real dressing-room scene, open at the front for the preview camera.
root=empty('ChangingRoom')
wall=material('Warm plaster',(.61,.59,.52),.96)
floor=material('Oak floor',(.37,.27,.17),.79)
mirror=material('Mirror_Surface',(.7,.74,.71),.06,1)
curtain=material('Linen curtain',(.38,.43,.35),.96)
cube('Studio floor',(0,0,-.08),(6,6,.16),floor,.01,root)
for i in range(20):
    for j in range(5):
        cube('Parquet plank',(-2.85+i*.3,-2.4+j*1.2+(i%2)*.15,.007),(.287,1.185,.012),wood if (i+j)%3 else woodlight,.003,root)
cube('Back plaster wall',(0,2.3,1.65),(6,.15,3.3),wall,.02,root)
cube('Left plaster wall',(-3,0,1.65),(.15,4.6,3.3),wall,.02,root)
cube('Right plaster wall',(3,0,1.65),(.15,4.6,3.3),wall,.02,root)
for x in [-2.92,2.92]:cube('Skirting',(x,0,.12),(.045,4.6,.24),wood,.006,root)
cube('Back skirting',(0,2.2,.12),(5.9,.045,.24),wood,.006,root)
cube('Mirror brass frame',(0,2.18,1.42),(1.55,.09,2.42),brass,.08,root)
cube('Mirror_Surface',(0,2.115,1.42),(1.46,.015,2.33),mirror,.064,root)
for x in [-.89,.89]:cube('Mirror light',(x,2.06,1.46),(.033,.04,2.1),light,.012,root)
# Floor-to-ceiling timber slats and a curved fabric screen.
for i in range(12):cube('Oak batten',(-2.8+i*.105,2.13,1.65),(.038,.095,3.3),wood,.006,root)
for i in range(16):
    x=1.17+i*.075;y=1.9+math.sin(i*math.pi/2)*.045
    cube('Curtain fold',(x,y,1.51),(.082,.07,2.9),curtain,.032,root)
tube('Clothing rail',[(1.7,.2,.06),(1.7,.2,1.9),(2.8,.2,1.9),(2.8,.2,.06)],.018,brass,root,12)
for i,col in enumerate([(.25,.31,.24),(.62,.54,.39),(.18,.23,.28)]):
    m=material('Display textile '+str(i),col,.95)
    cube('Hanging garment',(1.93+i*.3,.2,1.32),(.22,.12,.88),m,.04,root)
    tube('Hanger',[(1.8+i*.3,.2,1.7),(1.93+i*.3,.2,1.83),(2.06+i*.3,.2,1.7)],.006,brass,root,8)
cube('Upholstered stool',(-1.75,.15,.49),(.87,.58,.14),cream,.09,root)
for x in [-2.05,-1.45]:
    for y in [-.03,.34]:cube('Stool leg',(x,y,.21),(.044,.044,.42),wood,.006,root)
lathe('Try-on platform',[(0,0),(.72,0),(.75,.02),(.75,.04),(0,.04)],stone,96,root)
objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
finish('changing-room',root,objects)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/'changing-room.blend'))
print('ENVIRONMENT COMPLETE',flush=True)
