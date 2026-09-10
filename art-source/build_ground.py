"""Original patterned limestone promenades, fountain rondel and gravel courts.

Metres, Z up, Blender -Y maps to runtime +Z. Owns town-ground.blend/glb;
all colour, normal and roughness images are generated and packed here.
"""
import math
import sys
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import reset, empty, select, mesh
ROOT=Path(__file__).resolve().parents[1]


def noise(x,y,seed=0):
    return np.mod(np.sin(x*127.1+y*311.7+seed*74.7)*43758.5453,1)


def smooth_noise(n, cells, seed):
    y,x=np.mgrid[:n,:n].astype(np.float64)*cells/n
    ix=np.floor(x);iy=np.floor(y);fx=x-ix;fy=y-iy
    fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
    a=noise(ix%cells,iy%cells,seed);b=noise((ix+1)%cells,iy%cells,seed)
    c=noise(ix%cells,(iy+1)%cells,seed);d=noise((ix+1)%cells,(iy+1)%cells,seed)
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy


def packed_image(name, data, colour=False):
    h,w=data.shape[:2];image=bpy.data.images.new(name,width=w,height=h,alpha=False)
    if not colour:image.colorspace_settings.name='Non-Color'
    if data.ndim==2:data=np.repeat(data[:,:,None],3,axis=2)
    rgba=np.ones((h,w,4),dtype=np.float32);rgba[:,:,:3]=np.clip(data,0,1)
    image.pixels.foreach_set(rgba.ravel());image.pack();return image


def relief_normal(height, metres):
    # World-space height is converted to tangent slopes. Wrap derivatives keep seams flat.
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))*height.shape[1]/(2*metres[0])
    dy=(np.roll(height,-1,0)-np.roll(height,1,0))*height.shape[0]/(2*metres[1])
    normal=np.stack([-dx,-dy,np.ones_like(height)],axis=2)
    normal/=np.linalg.norm(normal,axis=2)[:,:,None]
    return normal*.5+.5


def surface(name, colour, height, rough, metres):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    mat.diffuse_color=(*np.mean(colour,axis=(0,1)),1)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;bsdf=nodes.get('Principled BSDF')
    for label,data,col in [('Colour',colour,True),('Normal',relief_normal(height,metres),False),('Roughness',rough[::4,::4],False)]:
        tex=nodes.new('ShaderNodeTexImage');tex.image=packed_image(name+' '+label,data,col)
        if label=='Normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=1
            links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
        else:links.new(tex.outputs['Color'],bsdf.inputs['Base Color' if col else 'Roughness'])
    return mat


def fan_stone():
    # Staggered overlapping fan courses; periodic IDs give a seamless original pattern.
    n=1024;span=(4.8,3.9);R=1.5;step=.975
    y,x=np.mgrid[:n,:n].astype(np.float64);x=(x+.5)/n*span[0];y=(y+.5)/n*span[1]
    chosen=np.zeros((n,n),bool);cx=np.zeros_like(x);cy=np.zeros_like(y);column=np.zeros_like(x);row=np.zeros_like(y)
    for offset in [-1,0,1]:
        j=np.floor(y/step)+offset;shift=np.mod(j,2)*1.2;i=np.round((x-shift)/2.4)
        xx=i*2.4+shift;yy=j*step
        use=(~chosen)&((x-xx)**2+(y-yy)**2<R*R)
        cx=np.where(use,xx,cx);cy=np.where(use,yy,cy);column=np.where(use,i,column);row=np.where(use,j,row);chosen|=use
    assert chosen.all()
    dx=x-cx;dy=y-cy;r=np.hypot(dx,dy);theta=np.arctan2(dy,dx)
    # Nine radial courses of dressed, softly irregular setts in each fan.
    course=np.floor(r/(R/9));radial=np.mod(r,R/9)
    count=np.maximum(8,np.round(math.tau*(course+.5)*(R/9)/.20))
    angle_step=math.tau/count;angular=np.mod(theta+(np.mod(course,2)*.5)*angle_step,angle_step)
    stone=np.floor((theta+(np.mod(course,2)*.5)*angle_step)/angle_step)
    distance=np.minimum(np.minimum(radial,R/9-radial),np.minimum(angular,angle_step-angular)*r)
    variation=noise(np.mod(column,2)+course*7,np.mod(row,4)+stone*3,12)
    cloud=smooth_noise(n,19,24)-.5;grain=smooth_noise(n,160,21)-.5
    edge=np.clip((distance-.004)/.007,0,1);edge=edge*edge*(3-2*edge)
    palette=np.array([.78,.752,.682]);tone=.88+variation*.21+cloud*.11+grain*.028
    rgb=palette[None,None,:]*tone[:,:,None]
    rgb=rgb*edge[:,:,None]+np.array([.51,.485,.43])*(1-edge[:,:,None])
    height=.0045*edge+cloud*.0005+grain*.00017
    rough=.78+cloud*.065+(1-edge)*.12
    return surface('Ground fan-laid limestone',rgb,height,rough,span)


def gravel():
    # Periodic jittered Voronoi pebbles, roughly 14-28 mm across, set in finer grit.
    n=1024;span=1.4;cells=64
    y,x=np.mgrid[:n,:n].astype(np.float64)*cells/n
    ix=np.floor(x);iy=np.floor(y);nearest=np.ones((n,n))*1e9;second=nearest.copy();id_x=np.zeros_like(x);id_y=np.zeros_like(y)
    for dx in [-1,0,1]:
        for dy in [-1,0,1]:
            a=ix+dx;b=iy+dy
            xx=a+.18+noise(a%cells,b%cells,5)*.64;yy=b+.18+noise(a%cells,b%cells,8)*.64
            d=(x-xx)**2+(y-yy)**2;closer=d<nearest
            second=np.where(closer,nearest,np.minimum(second,d))
            id_x=np.where(closer,a%cells,id_x);id_y=np.where(closer,b%cells,id_y);nearest=np.minimum(nearest,d)
    edge=np.clip((np.sqrt(second)-np.sqrt(nearest)-.075)/.24,0,1)
    rounded=edge*edge*(3-2*edge)
    variation=noise(id_x,id_y,44);warm=noise(id_x,id_y,15)
    cloud=smooth_noise(n,7,2)-.5;grit=smooth_noise(n,230,9)-.5
    tone=.69+variation*.54+cloud*.05
    rgb=np.stack([.57+.035*warm,.545+.021*warm,.485+.015*warm],axis=2)*tone[:,:,None]
    rgb=rgb*rounded[:,:,None]+np.array([.405,.395,.355])*(1-rounded[:,:,None])
    rgb+=grit[:,:,None]*.065
    height=rounded*(.0027+variation*.0018)+grit*.00055
    rough=.87+variation*.07
    return surface('Ground compacted gravel',rgb,height,rough,(span,span))


def limestone():
    n=512;cloud=smooth_noise(n,8,52)-.5;grain=smooth_noise(n,100,19)-.5
    rgb=np.array([.76,.735,.668])*(1+cloud[:,:,None]*.075+grain[:,:,None]*.018)
    return surface('Ground dressed limestone',rgb,cloud*.0007+grain*.00025,.80+cloud*.05,(.8,.8))


def solid(name, colour):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*colour,1)
    bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(*colour,1);bsdf.inputs['Roughness'].default_value=.77
    return mat


class Surfaces:
    def __init__(self,root):self.root=root;self.groups={}
    def polygon(self,points,height,mat,uv_scale=(.8,.8),tint=1):
        group=self.groups.setdefault(mat.name,{'verts':[],'faces':[],'uv':[],'colours':[],'mat':mat})
        start=len(group['verts'])
        # Points are authored in runtime X/Z; reverse the polygon after mapping Z to -Y.
        points=list(reversed(points))
        group['verts'].extend((x,-z,height) for x,z in points)
        group['uv'].extend((x/uv_scale[0],-z/uv_scale[1]) for x,z in points)
        group['colours'].extend([(tint,tint,tint,1)]*len(points))
        group['faces'].append(tuple(start+i for i in range(len(points))))
    def rect(self,x0,z0,x1,z1,height,mat,uv_scale=(.8,.8),tint=1):
        self.polygon([(x0,z0),(x1,z0),(x1,z1),(x0,z1)],height,mat,uv_scale,tint)
    def ring(self,inner,outer,height,mat,stone_width=.3,gap=.006):
        count=math.ceil(math.tau*(inner+outer)/2/stone_width)
        phase=(round(inner*100)%2)*math.pi/count
        for i in range(count):
            a=i/count*math.tau+phase+gap/((inner+outer)/2)/2;b=(i+1)/count*math.tau+phase-gap/((inner+outer)/2)/2
            points=[]
            for r,angles in [(inner,[a,(a+b)/2,b]),(outer,[b,(a+b)/2,a])]:
                points.extend((r*math.cos(t),1+r*math.sin(t)) for t in angles)
            # Ring points run clockwise in X/Z, unlike rectangles.
            self.polygon(list(reversed(points)),height,mat,tint=.92+.08*float(noise(i,round(inner*100),9)))
    def finish(self):
        objects=[]
        for name,group in self.groups.items():
            obj=mesh(name,group['verts'],group['faces'],group['mat'],self.root)
            for face in obj.data.polygons:face.use_smooth=False
            uv=obj.data.uv_layers.new(name='World-scale surfaces')
            colours=obj.data.color_attributes.new(name='Stone variation',type='FLOAT_COLOR',domain='POINT')
            for i,colour in enumerate(group['colours']):colours.data[i].color=colour
            for loop in obj.data.loops:uv.data[loop.index].uv=group['uv'][loop.vertex_index]
            # Export supports the colour attribute; keep the same modulation in Blender.
            if name!='Ground compacted gravel':
                nodes=group['mat'].node_tree.nodes;links=group['mat'].node_tree.links;bsdf=nodes.get('Principled BSDF')
                colour=nodes.new('ShaderNodeVertexColor');colour.layer_name='Stone variation'
                mult=nodes.new('ShaderNodeMix');mult.data_type='RGBA';mult.blend_type='MULTIPLY';mult.inputs[0].default_value=1
                if bsdf.inputs['Base Color'].is_linked:links.new(bsdf.inputs['Base Color'].links[0].from_socket,mult.inputs[6])
                else:mult.inputs[6].default_value=bsdf.inputs['Base Color'].default_value
                links.new(colour.outputs['Color'],mult.inputs[7]);links.new(mult.outputs[2],bsdf.inputs['Base Color'])
            objects.append(obj)
        return objects


def build_model(root):
    fans=fan_stone();grit=gravel();stone=limestone()
    slate=solid('Ground charcoal limestone edging',(.16,.19,.177))
    joints=solid('Ground recessed stone joints',(.235,.233,.202))
    s=Surfaces(root)
    s.rect(-27,-27,27,27,.002,grit,(1.4,1.4))
    # Retain the broad arrival/cross routes, extend the pale approach to the casino threshold.
    s.rect(-4,-26.5,4,14,.005,joints)
    s.rect(-3.6,-26.5,3.6,14,.010,fans,(4.8,3.9))
    s.rect(-26,-4.5,18.35,.5,.006,joints)
    s.rect(-26,-4.1,18.35,.1,.013,fans,(4.8,3.9))
    # A wide dressed-stone pad supports both feet and the original stand exits.
    for x in (-10,10):
        s.rect(x-2.05,-8.8,x+2.05,-5.45,.005,joints)
        s.rect(x-.85,-5.45,x+.85,-4.1,.006,fans,(4.8,3.9))
        s.rect(x-1.85,-8.6,x+1.85,-5.65,.010,fans,(4.8,3.9))
        # Small framed landing; joints break the coping into individually laid stones.
        for edge_z in (-8.7,-5.55):
            for i in range(10):
                a=x-2.05+i*.41
                # Leave a seamless opening towards the cross promenade.
                if edge_z>-6 and abs(a+.205-x)<.9:continue
                s.rect(a+.006,edge_z-.1,a+.404,edge_z+.1,.014,stone,tint=.94+.06*float(noise(i,x,4)))
        for edge_x in (x-1.95,x+1.95):
            for i in range(7):
                a=-8.6+i*(2.95/7);s.rect(edge_x-.1,a+.006,edge_x+.1,a+2.95/7-.006,.014,stone)
    # Narrow dark outer course and larger warm limestone inner course.
    for x in (-4,3.86):
        for i in range(90):
            z=-26.5+i*.45
            if -4.6<z+.225<.6:continue
            s.rect(x,z+.006,x+.14,min(14,z+.444),.014,slate)
    for x in (-3.84,3.61):
        for i in range(90):
            z=-26.5+i*.45
            if -4.6<z+.225<.6:continue
            s.rect(x,z+.007,x+.23,min(14,z+.443),.015,stone,tint=.93+.07*float(noise(i,x,3)))
    for z in (-4.5,.36):
        for i in range(99):
            x=-26+i*.45
            if -4.05<x+.225<4.05:continue
            if z<0 and any(abs(x+.225-b)<.95 for b in (-10,10)):continue
            s.rect(x+.006,z,min(18.35,x+.444),z+.14,.014,slate)
    for z in (-4.34,.11):
        for i in range(99):
            x=-26+i*.45
            if -4.05<x+.225<4.05:continue
            if z<0 and any(abs(x+.225-b)<.95 for b in (-10,10)):continue
            s.rect(x+.007,z,min(18.35,x+.443),z+.23,.015,stone,tint=.94+.06*float(noise(i,z,5)))
    # One raised-by-millimetres rondel covers the junction cleanly, with concentric courses.
    n=256;disk=[(7.6*math.cos(i/n*math.tau),1+7.6*math.sin(i/n*math.tau)) for i in range(n)]
    s.polygon(disk,.018,joints)
    s.ring(7.43,7.59,.023,slate,.3)
    s.ring(7.08,7.41,.023,stone,.39)
    s.ring(6.98,7.06,.023,slate,.3)
    r=3.24
    while r<6.955:
        outer=min(6.96,r+.265)
        s.ring(r+.004,outer-.004,.022,stone,.32)
        r=outer+.004
    s.ring(3.22,3.42,.024,slate,.28)
    # Four restrained radial inlays connect the fountain apron to the approach axes.
    for angle in [0,math.pi/2,math.pi,3*math.pi/2]:
        for k in range(8):
            a=3.45+k*.44;b=min(6.93,a+.43);w=.045
            points=[(r*math.cos(angle)+t*math.sin(angle),1+r*math.sin(angle)-t*math.cos(angle)) for r,t in [(a,-w),(b,-w),(b,w),(a,w)]]
            s.polygon(list(reversed(points)),.024,slate)
    root['description']='Original fan-laid limestone promenades, concentric fountain apron, framed bench landings and compacted gravel courts'
    root['units']='metres';root['surface_range_metres']=[.002,.024];root['fountain_centre_xz']=[0,1];root['fountain_apron_radius']=7.6
    return s.finish()


def build():
    reset();bpy.data.orphans_purge(do_recursive=True)
    root=empty('town-ground');objects=build_model(root)
    bpy.context.scene.unit_settings.system='METRIC';select([root]+objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source/town-ground.blend'))
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/town-ground.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_all_vertex_colors=False)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art-source/town-ground.blend'));assert not bpy.data.is_dirty
    print('COMPLETE town-ground',flush=True)

if __name__=='__main__':build()
