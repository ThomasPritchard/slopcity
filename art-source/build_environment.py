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
    markers = [obj for obj in bpy.context.scene.objects if obj.parent == root and obj.type == 'EMPTY']
    export(name,[root]+joined+markers)
    return root,joined

def asset(name,builder):
    old=set(bpy.context.scene.objects)
    root=empty(name); builder(root)
    objects=[obj for obj in bpy.context.scene.objects if obj not in old and obj.type=='MESH']
    return finish(name,root,objects)

def make_bench(root):
    from build_bench import build_model
    build_model(root)


def make_lamp(root):
    from build_lamp import build_model
    build_model(root)


def make_fountain(root):
    # Keep full street-kit regeneration consistent with the dedicated fountain source.
    from build_fountain import build_model
    build_model(root)


def make_planter(root):
    from build_planting import build_bed
    build_bed(root)


def make_tree(root):
    from build_planting import build_tree
    build_tree(root)


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
