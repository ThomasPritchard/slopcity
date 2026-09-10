"""Original civic bench. Metres, Z up, front -Y; seat top stays at .5075 m.

Owns bench.blend and bench.glb only. Timber grain is generated here and packed
into both files; no downloaded textures or dependency on the studio scene.
"""
import math
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import reset, material, cube, tube, mesh, empty, select, bevel
ROOT = Path(__file__).resolve().parents[1]


def oak_image():
    """Long fibres, occasional small knots and fine pores, with restrained contrast."""
    width, height = 1024, 256
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    x /= width; y /= height
    rng = np.random.default_rng(917)
    fibres = y + .011*np.sin(x*13+y*4) + .005*np.sin(x*31+y*9)
    for kx, ky in [(.27,.30), (.76,.73)]:
        dx=(x-kx)/.11; dy=(y-ky)/.14
        fibres += .037*np.exp(-(dx*dx+dy*dy)*1.6)*np.sin(np.arctan2(dy,dx)*2)
    growth = np.sin(fibres*math.tau*29 + .8*np.sin(fibres*math.tau*5))
    fine = np.maximum(0,np.sin(fibres*math.tau*107+x*7))**14
    shade = .94 + .052*growth - .067*fine + .028*np.sin(y*21+x*2) + rng.normal(0,.01,(height,width))
    # The generated packed PNG uses sRGB colour values for the original oak.
    rgba=np.ones((height,width,4),dtype=np.float32)
    rgba[:,:,:3]=np.clip(shade[:,:,None]*np.array([.63,.465,.30]),0,1)
    image=bpy.data.images.new('Bench original oak grain',width=width,height=height,alpha=True)
    image.pixels.foreach_set(rgba.ravel());image.pack()
    return image


def timber_material(name, image, tint):
    mat=material(name,(1,1,1),.58)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*tint,1)
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    mat.node_tree.links.new(tex.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    # glTF multiplies the image by this factor; the image itself supplies the colour.
    mat.diffuse_color=(*tint,1)
    return mat


def timber(name, location, dimensions, mat, root, seed, grain_axis=0):
    obj=cube(name,location,dimensions,mat,min(.012,min(dimensions)*.22),root)
    # Project each face along the plank, and offset each slat to avoid repeated knots.
    uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='Timber grain')
    other=[a for a in range(3) if a != grain_axis]
    for face in obj.data.polygons:
        normal=face.normal
        transverse=min(other,key=lambda a:abs(normal[a]))
        for loop_index in face.loop_indices:
            co=obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            u=co[grain_axis]/dimensions[grain_axis]+.5
            v=co[transverse]/dimensions[transverse]+.5
            uv.data[loop_index].uv=(u*.94+(seed*.173)%1,v*.73+(seed*.217)%1)
    return obj


def curve(points, samples=5):
    """Catmull-Rom points for smooth cast rails, clamped at the ends."""
    result=[]
    for i in range(len(points)-1):
        p0,p1,p2,p3=[Vector(points[max(0,min(len(points)-1,k))]) for k in (i-1,i,i+1,i+2)]
        for j in range(samples):
            t=j/samples
            result.append(tuple(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)))
    return result+[points[-1]]


def cast_rail(name, points, radius, mat, root, flatten=1):
    # A fixed lateral reference avoids the frame flips in a general tube helper
    # when these nearly vertical castings bend across its reference-axis threshold.
    points=[Vector(p) for p in curve(points)]
    verts=[];faces=[];sides=10
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        lateral=Vector((1,0,0))
        u=(lateral-tangent*lateral.dot(tangent)).normalized()
        v=tangent.cross(u).normalized()
        for k in range(sides):
            a=k/sides*math.tau
            verts.append(tuple(p+radius*(math.cos(a)*u*flatten+math.sin(a)*v)))
    for i in range(len(points)-1):
        for k in range(sides):
            a=i*sides+k;b=i*sides+(k+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+k for k in range(sides))])
    return mesh(name,verts,faces,mat,root)


def fastener(name, position, normal, mat, root, radius=.009):
    # Low domed heads: actual topology visible close up, seated below the slat bevel.
    n=Vector(normal);p=Vector(position)
    points=[tuple(p-n*.001),tuple(p+n*.0015),tuple(p+n*.0032)]
    return tube(name,points,[radius,radius,radius*.65],mat,root,10)


def build_model(root):
    image=oak_image()
    oak=timber_material('Bench oiled oak',image,(1,1,1))
    # Both materials share one embedded image; gentle per-board variation.
    oak_light=timber_material('Bench mellow oak',image,(1,1,1))
    # Original image nodes remain exportable; use a second image-free
    # base factor through glTF's supported multiply node rather than procedural noise.
    nodes=oak_light.node_tree.nodes;links=oak_light.node_tree.links
    multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
    multiply.inputs[2].default_value=(.92,.95,.98,1)
    links.new(next(n for n in nodes if n.type=='TEX_IMAGE').outputs['Color'],multiply.inputs[1])
    links.new(multiply.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])
    iron=material('Bench evergreen cast metal',(.024,.049,.038),.43,.4)
    bronze=material('Bench brushed bronze',(.31,.23,.105),.36,.76)
    dark=material('Bench recessed hardware',(.014,.02,.016),.74,.25)

    # Six separate seat slats. The two original +/- .52 m anchors remain centred
    # on a .5075 m contact plane; only the leading edge rolls down slightly.
    for i in range(6):
        y=-.24+i*.095;z=.476 if i==0 else .48
        timber(f'Seat slat {i+1}',(0,y,z),(2.35,.082,.055),oak_light if i in (1,4) else oak,root,i)
        for x in (-.9,.9):
            fastener('Recessed seat washer',(x,y,z+.027), (0,0,1),dark,root,.012)
            fastener('Bronze seat screw',(x,y,z+.029), (0,0,1),bronze,root,.007)
    # Relaxed back profile with lumbar clearance and real gaps between slats.
    for i in range(5):
        z=.657+i*.087;y=.30+(z-.657)*.21
        obj=timber(f'Reclined back slat {i+1}',(0,y,z),(2.35,.048,.075),oak_light if i in (0,3) else oak,root,i+9)
        obj.rotation_euler.x=-math.atan(.21)
        front=Vector((0,-1,-.21)).normalized()
        for x in (-.9,.9):
            p=Vector((x,y,z))+front*.025
            fastener('Back washer',p,front,dark,root,.011)
            fastener('Back screw',p+front*.0015,front,bronze,root,.007)
            fastener('Rear carriage head',Vector((x,y,z))-front*.034,-front,bronze,root,.009)

    for x in (-.9,.9):
        for y in (-.33,.35):
            cube('Ground mounting shoe',(x,y,.021),(.155,.19,.042),iron,.018,root)
            for dx in (-.048,.048):
                fastener('Ground anchor',(x+dx,y,.044),(0,0,1),bronze,root,.010)
        cast_rail('Swept front cast leg',[(x,-.33,.044),(x,-.315,.14),(x,-.235,.31),(x,-.21,.437)],.032,iron,root,1.3)
        cast_rail('Rear leg and back stile',[(x,.35,.044),(x,.325,.15),(x,.225,.38),(x,.27,.49),(x,.344,.78),(x,.409,1.022)],.029,iron,root,1.4)
        cast_rail('Seat bearer',[(x,-.292,.44),(x,-.18,.434),(x,.14,.434),(x,.288,.458)],.029,iron,root,1.4)
        cast_rail('Under-seat arch brace',[(x,-.292,.195),(x,-.16,.276),(x,.10,.275),(x,.302,.188)],.013,iron,root)
        # Cast bosses and thin bronze rims at the structural junctions.
        for y,z in [(-.208,.429),(.255,.447)]:
            normal=(1 if x>0 else -1,0,0)
            fastener('Cast junction boss',(x+normal[0]*.04,y,z),normal,bronze,root,.028)
            fastener('Junction bolt',(x+normal[0]*.044,y,z),normal,iron,root,.012)
        for z in (.635,.814,.985):
            y=.30+(z-.657)*.21+.035
            cube('Back mounting saddle',(x,y,z),(.083,.036,.045),iron,.009,root)
        arm_x=math.copysign(1.075,x)
        cast_rail('Armrest front sweep',[(x,-.24,.422),(arm_x,-.267,.526),(arm_x,-.257,.651),(arm_x,-.196,.719)],.022,iron,root)
        cast_rail('Armrest rear return',[(arm_x,.235,.714),(arm_x,.289,.646),(x,.301,.539)],.022,iron,root)
        timber('Rounded oak arm cap',(arm_x,.012,.736),(.086,.50,.041),oak,root,18,grain_axis=1)
        for y in (-.16,.18):fastener('Arm cap screw',(arm_x,y,.756),(0,0,1),bronze,root,.006)
        # Visible end-to-end bracing with socket collars beneath the seat.
        cube('Crossbar socket',(x,.115,.252),(.09,.081,.078),iron,.013,root)
        fastener('Socket pin',(x,.071,.252),(0,-1,0),bronze,root,.012)
    tube('Under-seat stretcher',[(-.91,.115,.252),(.91,.115,.252)],.022,iron,root,12)
    root['description']='Original slatted oak civic bench with swept evergreen cast legs, timber arm caps and bronze hardware'
    root['units']='metres';root['seat_top_metres']=.5075;root['seat_anchors_x']=[-.52,.52]
    root['front']='-Y in Blender; +Z in Babylon';root['width_metres']=2.35


def build():
    reset();bpy.data.orphans_purge(do_recursive=True)
    root=empty('bench');build_model(root)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.scene.unit_settings.system='METRIC'
    select([root]+objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source/bench.blend'))
    groups={}
    for original in objects:
        obj=original.copy();obj.data=original.data.copy();bpy.context.collection.objects.link(obj)
        groups.setdefault(obj.data.materials[0].name,[]).append(obj)
    exported=[]
    for name,group in groups.items():
        select(group)
        if len(group)>1:bpy.ops.object.join()
        obj=bpy.context.object;obj.name=name;exported.append(obj)
    select([root]+exported)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/bench.glb'),export_format='GLB',use_selection=True,
                              export_animations=False,export_yup=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art-source/bench.blend'))
    assert not bpy.data.is_dirty
    print('COMPLETE bench',flush=True)

if __name__=='__main__':build()
