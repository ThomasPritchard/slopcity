"""Offline inspection of the maintained Meridian .blend outputs; never edits sources.
Run separately with --background --factory-startup --python-exit-code 1.
Optional selection after --: furniture, roulette, slots, venue, exterior, night,
foyer, hall, chandelier, ramp.
"""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/playwright/casino-expansion'
OUT.mkdir(parents=True,exist_ok=True)
CACHE={}


def asset(name,position=(0,0,0),heading=0):
    if name not in CACHE:
        with bpy.data.libraries.load(str(ROOT/'art-source'/(name+'.blend')),link=False) as (source,target):
            target.objects=list(source.objects)
        CACHE[name]=[o for o in target.objects if o and o.type=='MESH']
    transform=Matrix.Translation(Vector(position))@Matrix.Rotation(heading,4,'Z')
    result=[]
    for source in CACHE[name]:
        obj=source.copy();obj.data=source.data;obj.name=name+'/'+source.name
        # Unlinked library objects have an unevaluated matrix_world; their editable
        # local transform is authoritative (these maintained sources have no parents).
        bpy.context.collection.objects.link(obj);obj.matrix_world=transform@source.matrix_basis;result.append(obj)
    return result


def reset():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
    scene.render.resolution_x=1400;scene.render.resolution_y=950;scene.render.resolution_percentage=100
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.30,.34,.32,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.40
    scene.view_settings.view_transform='AgX'
    return scene


def camera(position,target,ortho=None,lens=45):
    bpy.ops.object.camera_add(location=position);obj=bpy.context.object
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    if ortho:obj.data.type='ORTHO';obj.data.ortho_scale=ortho
    obj.data.lens=lens;bpy.context.scene.camera=obj
    return obj


def area(position,target,power,size):
    bpy.ops.object.light_add(type='AREA',location=position);obj=bpy.context.object
    obj.data.energy=power;obj.data.shape='DISK';obj.data.size=size
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def backdrop(size=200,height=0):
    bpy.ops.mesh.primitive_plane_add(size=size,location=(0,0,height));obj=bpy.context.object
    mat=bpy.data.materials.new('Inspection neutral ground');mat.diffuse_color=(.29,.32,.29,1);obj.data.materials.append(mat)


def render(name):
    bpy.context.scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
    print('CASINO_RENDER',name,flush=True)


def furniture():
    reset();backdrop()
    asset('roulette-table',(-3.1,0,0));asset('roulette-wheel',(-4.47,0,1.32))
    asset('blackjack-table',(3.1,.10,0))
    for x in [-1.15,0,1.15]:asset('casino-chair',(3.1+x,-1.68,0))
    asset('slot-machine',(2.7,3.15,0));asset('casino-chair',(2.7,1.9,0))
    asset('casino-chair',(-.6,-2.1,0),-.4)
    camera((10,-15,13),(0,.45,.75),12)
    area((1,-5,10),(0,0,0),1800,8);area((-6,3,7),(0,0,1),1100,6)
    render('production-furnishings')


def roulette():
    reset();backdrop();asset('roulette-table');asset('roulette-wheel',(-1.37,0,1.32))
    camera((3.8,-5,7.5),(0,0,.95),6.3)
    area((1,-4,7),(0,0,0),1100,5);area((-4,2,5),(0,0,1),650,4)
    render('production-roulette')


def slots():
    reset();backdrop();asset('slot-machine');asset('casino-chair',(0,-1.25,0))
    camera((3.5,-5.5,3.2),(0,-.2,1.0),3.8)
    area((1,-3,5),(0,0,0),700,4);area((-3,2,4),(0,0,1),550,3)
    render('production-slots-chair')


def assemble(with_roof=True,with_ceiling=True):
    asset('meridian-shell');asset('meridian-interior')
    if with_roof:asset('meridian-roof')
    if with_ceiling:asset('meridian-ceiling')
    asset('meridian-chandelier')
    asset('casino-sign',(0,13.75,5.4))
    for y in [32,44]:asset('roulette-table',(0,y,.9));asset('roulette-wheel',(-1.37,y,2.22))
    for x in [-8,8]:
        for y in [30,37.7,45.4]:
            asset('blackjack-table',(x,y,.9))
            for sx,sy in [(-1.8,-.6),(-1.15,-1.5),(0,-1.9),(1.15,-1.5),(1.8,-.6)]:
                asset('casino-chair',(x+sx,y+sy,.9),-math.atan2(-sx,-sy))
    for x in [-16.6,-14.6,14.6,16.6]:
        for i in range(6):
            y=28.8+i*3.15;asset('slot-machine',(x,y,.9));asset('casino-chair',(x,y-1.25,.9))


def venue():
    reset();backdrop(height=-.29);assemble(False,False)
    camera((54,-26,65),(0,32,0),75)
    area((0,20,45),(0,35,0),22000,32);area((-25,45,32),(0,35,0),13000,28)
    render('production-venue-cutaway')


def exterior(night=False):
    scene=reset();backdrop(height=-.29);assemble()
    camera((36,-27,19),(0,21,3),58)
    if night:
        scene.world.node_tree.nodes['Background'].inputs[1].default_value=.018
        area((0,5,18),(0,15,1),300,14)
        area((0,12,3.5),(0,18,1),450,8)
        # Emission is rendered physically; no painted or composited lighting.
    else:
        scene.use_nodes=False;area((0,-10,40),(0,25,0),15000,28);area((-30,30,35),(0,30,0),9000,25)
    render('production-exterior-night' if night else 'production-exterior-day')


def foyer():
    scene=reset();scene.use_nodes=False;assemble()
    camera((0,14.85,1.75),(0,32,2.0),lens=25)
    area((0,18,3.7),(0,18,0),360,5);area((0,30,7.5),(0,34,1),2100,15)
    area((0,45,7.5),(0,40,1),2800,15)
    render('production-foyer')


def hall():
    scene=reset();assemble()
    camera((13,27,3.2),(0,39,5.5),lens=25)
    area((0,30,7.5),(0,34,1),1900,13);area((0,46,7.5),(0,40,1),2200,13)
    area((5,30,3.2),(0,39,7.0),550,6)
    render('production-grand-hall')


def chandelier():
    scene=reset();assemble()
    camera((7,29.5,5.15),(0,38,6.5),lens=52)
    area((0,30,7.4),(0,38,5.5),1200,9);area((0,46,7.4),(0,38,5.5),1800,9)
    area((4,32,4.5),(0,38,7.5),550,5)
    render('production-grand-chandelier')


def ramp():
    scene=reset();assemble()
    camera((3,18.4,1.8),(7,21.5,1.8),lens=28)
    area((0,18,3.7),(5,21,1),420,5);area((12,23,3.7),(8,22,1),400,5)
    render('production-ramp-doorway')


if __name__=='__main__':
    choices={'furniture':furniture,'roulette':roulette,'slots':slots,'venue':venue,'exterior':exterior,'night':lambda:exterior(True),'foyer':foyer,'hall':hall,'chandelier':chandelier,'ramp':ramp}
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for name in args or list(choices):choices[name]()
