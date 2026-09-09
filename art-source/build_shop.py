"""Form & Thread fixtures, authored locally in a separate Blender process."""
import sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import *
reset()
oak=material('Shop white oak',(.47,.34,.20),.72)
oakedge=material('Shop oak edge',(.32,.21,.12),.8)
brass=material('Shop brushed brass',(.42,.31,.14),.4,.7)
cream=material('Shop limestone',(.72,.68,.57),.85)
sage=material('Shop sage linen',(.25,.32,.22),.98)
dark=material('Shop forest green',(.075,.14,.10),.86)
mirror=material('Shop mirror',(.7,.76,.72),.09,.95)
light=material('Shop light',(.95,.85,.65),.4)
light.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(1,.88,.67,1)
light.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=1.4
fabrics=[material('Display fabric '+str(i),colour,.95) for i,colour in enumerate([(.55,.45,.28),(.11,.19,.26),(.36,.12,.06),(.2,.27,.15),(.7,.63,.48)])]
# Recessed oak floor with individual planks and perimeter skirting.
for i in range(31):
    cube('Floor plank',(0,-9.3+i*.60,.082),(7.35,.587,.045),oak if i%3 else oakedge,.005)
for y in [-9.7,9.7]:cube('Floor border',(0,y,.105),(7.4,.07,.05),brass,.004)
for x in [-3.7,3.7]:cube('Floor border',(x,0,.105),(.07,19.4,.05),brass,.004)
# East-wall slats and three shelves with folded stock.
for i in range(67):cube('Wall slat',(3.72,-9.6+i*.29,1.55),(.10,.035,2.85),oakedge,.005)
for y in [-1.5,0,1.5]:
    cube('Wall shelf',(3.24,y,1.2),(.83,1.34,.075),oak,.015)
    cube('Shelf bracket',(3.53,y,.98),(.12,.045,.40),brass,.005)
    for k in range(3):
        for j in range(3):cube('Folded knit',(3.15,y-.43+k*.43,1.27+j*.045),(.43,.34,.04),fabrics[(j+k)%5],.016)
# Two freestanding rails. Hangers, collars, sleeves and hems read as garments.
for ycentre in [-3.6,3.6]:
    for y in [ycentre-1.25,ycentre+1.25]:
        cube('Rail foot',(.85,y,.13),(1.0,.10,.09),brass,.02)
        tube('Rail upright',[(.85,y,.16),(.85,y,1.96)],.025,brass,sides=12)
    tube('Rail bar',[(.85,ycentre-1.25,1.96),(.85,ycentre+1.25,1.96)],.025,brass,sides=12)
    for i in range(5):
        y=ycentre-.93+i*.46;mat=fabrics[i]
        tube('Hanger hook',[(.85,y,1.91),(.85,y,2.015),(.79,y,2.04),(.75,y,2.0)],.008,brass,sides=8)
        tube('Wood hanger',[(.85,y,1.88),(.85,y-.25,1.73),(.85,y+.25,1.73),(.85,y,1.88)],.014,oak,sides=8)
        cube('Hanging torso',(.85,y,1.34),(.11,.43,.76),mat,.045)
        for side in [-1,1]:
            sleeve=cube('Hanging sleeve',(.85,y+side*.27,1.49),(.105,.19,.44),mat,.035);sleeve.rotation_euler.x=side*.35
        cube('Hanging hem',(.846,y,.98),(.12,.44,.05),mat,.012)
        cube('Hanging collar',(.785,y,1.68),(.025,.15,.07),mat,.012)
# Checkout at the north end; fluting, stone top, packaging and register.
cube('Counter body',(1.15,7.2,.57),(3.2,1.10,.92),dark,.035)
for i in range(29):cube('Counter flute',(-.42+i*.112,6.635,.59),(.05,.035,.85),oak,.013)
cube('Counter stone',(1.15,7.2,1.065),(3.38,1.22,.10),cream,.022)
cube('Register base',(2.1,7.2,1.15),(.34,.31,.07),brass,.015)
register=cube('Register display',(2.12,7.20,1.35),(.035,.31,.30),dark,.012);register.rotation_euler.y=-.3
for i in range(2):
    cube('Paper bag',(.20+i*.5,7.2,1.33),(.34,.25,.44),cream,.018)
    for x in [.09+i*.5,.31+i*.5]:tube('Bag handle',[(x,7.17,1.53),(x,7.17,1.66),(x,7.24,1.66),(x,7.24,1.53)],.009,oakedge,sides=8)
# Open fitting alcove. Keep the centre and west entry open for the avatar/camera.
cube('Fitting back',(3.38,-6.6,1.46),(.13,3.25,2.76),sage,.02)
for y in [-8.23,-4.97]:
    cube('Fitting side',(1.8,y,1.46),(3.25,.12,2.76),sage,.02)
    cube('Fitting edge',(.17,y,1.46),(.055,.14,2.79),brass,.01)
cube('Fitting lintel',(.17,-6.6,2.78),(.13,3.4,.18),oak,.012)
cube('Fitting mirror',(3.295,-6.6,1.48),(.026,1.45,2.20),mirror,.012)
for y in [-7.39,-5.81]:cube('Mirror lamp',(3.24,y,1.49),(.055,.045,2.28),light,.01)
for i in range(13):
    y=-4.99-i*.045
    cube('Gathered curtain',(.13+.025*math.sin(i*1.6),y,1.43),(.10,.07,2.48),sage,.018)
cube('Fitting rug',(1.65,-6.6,.124),(2.30,2.65,.025),cream,.035)
# Bench and shoes on display beside the entrance.
cube('Display table',(-1.4,4.8,.70),(1.18,1.9,.095),oak,.025)
for x in [-1.87,-.93]:
    for y in [4.05,5.55]:cube('Display table leg',(x,y,.39),(.055,.055,.56),brass,.009)
for y in [4.35,5.22]:
    for x in [-1.64,-1.21]:
        ellipsoid('Display shoe',(x,y,.82),(.09,.23,.11),oakedge,segments=24,rings=12)
        cube('Display shoe sole',(x,y,.75),(.18,.44,.035),cream,.045)
# Join material groups for efficient instancing, retain original .blend source.
objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
joined=join_by_material(objects)
export('clothing-shop',joined)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/'clothing-shop.blend'))
print('SHOP',sum(len(o.data.polygons) for o in joined),'faces',flush=True)
