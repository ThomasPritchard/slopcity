"""Original civic lantern post; metres, Z up, origin at ground centre.

Owns lamp.blend / lamp.glb. The exported lamp-light-source marker locates the
runtime point light; Blender inspection lights are never exported.
"""
import math
import sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import reset, material, cube, lathe, tube, mesh, empty, ellipsoid, select
ROOT=Path(__file__).resolve().parents[1]


def build_model(root):
    iron=material('Lamp evergreen cast metal',(.024,.049,.038),.43,.4)
    bronze=material('Lamp brushed bronze',(.31,.23,.105),.32,.76)
    steel=material('Lamp stainless fasteners',(.34,.36,.33),.3,.82)
    dark=material('Lamp dark recesses',(.016,.021,.018),.78)
    glass=material('Lamp warm glass',(.78,.66,.43),.19,.02)
    glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.30
    glass.surface_render_method='BLENDED'
    glow=material('Lamp warm opal light',(.95,.82,.56),.24)
    bsdf=glow.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Emission Color'].default_value=(1,.72,.34,1)
    bsdf.inputs['Emission Strength'].default_value=2.3

    cube('Chamfered mounting shoe',(0,0,.055),(.46,.46,.11),iron,.035,root)
    for x in [-.16,.16]:
        for y in [-.16,.16]:
            bolt=lathe('Hex anchor bolt',[(.026,0),(.026,.026),(.018,.033)],steel,6,root)
            bolt.location=(x,y,.10)
    lathe('Cast pedestal',[(.17,.10),(.17,.17),(.14,.20),(.127,.32),(.12,.50),(.095,.58),(.084,.63)],iron,48,root)
    lathe('Base bronze collar',[(.128,.315),(.136,.325),(.136,.365),(.128,.375)],bronze,48,root)
    lathe('Tapered pole',[(.081,.55),(.078,.70),(.062,2.7),(.057,3.26),(.066,3.32)],iron,48,root)
    # Recessed access panel, actual hinge and screw; discreet vertical moulding.
    panel=cube('Service door',(0,-.126,.35),(.095,.008,.20),dark,.015,root)
    ellipsoid('Service latch',(0,-.134,.36),(.007,.004,.007),steel,root,12,6)
    for angle in range(8):
        a=angle/8*math.tau
        tube('Cast pedestal flute',[(math.cos(a)*.124,math.sin(a)*.124,.22),
             (math.cos(a)*.123,math.sin(a)*.123,.47)],.007,iron,root,8)
    lathe('Neck collar',[(.061,3.20),(.083,3.23),(.083,3.29),(.068,3.32)],bronze,48,root)
    lathe('Lantern cup',[(.064,3.30),(.085,3.39),(.15,3.46),(.23,3.48),(.245,3.51),(.245,3.55),(.22,3.57)],iron,48,root)
    lathe('Lower lantern bead',[(.218,3.545),(.23,3.553),(.23,3.578),(.218,3.588)],bronze,48,root)
    # Six softly tinted panes around an independent opal light source.
    for i in range(6):
        a=i/6*math.tau+math.pi/6;b=(i+1)/6*math.tau+math.pi/6
        lo=.205;hi=.285
        verts=[(lo*math.cos(a),lo*math.sin(a),3.585),(lo*math.cos(b),lo*math.sin(b),3.585),
               (hi*math.cos(b),hi*math.sin(b),4.075),(hi*math.cos(a),hi*math.sin(a),4.075)]
        mesh('Warm glass pane',verts,[(0,1,2,3)],glass,root)
        tube('Lantern corner stile',[(lo*math.cos(a),lo*math.sin(a),3.55),
             (hi*math.cos(a),hi*math.sin(a),4.105)],.016,iron,root,10)
        # Bronze highlight on the outside of each narrow frame corner.
        tube('Bronze stile detail',[(lo*math.cos(a)*1.05,lo*math.sin(a)*1.05,3.63),
             (hi*math.cos(a)*1.035,hi*math.sin(a)*1.035,4.02)],.004,bronze,root,8)
    lathe('Opal lamp chimney',[(0,3.60),(.076,3.60),(.10,3.65),(.105,3.78),(.09,3.99),(.06,4.015),(0,4.025)],glow,40,root)
    lathe('Bulb socket',[(.07,3.565),(.087,3.585),(.087,3.625),(.069,3.64)],bronze,32,root)
    # Faceted roof with a rolled edge, raised vents and a cast finial.
    lathe('Lantern roof',[(.285,4.07),(.345,4.09),(.355,4.12),(.337,4.14),
          (.29,4.17),(.20,4.245),(.083,4.275),(.064,4.30)],iron,6,root)
    lathe('Roof bronze drip edge',[(.343,4.096),(.359,4.112),(.343,4.129)],bronze,6,root)
    lathe('Vent crown',[(.078,4.265),(.078,4.305),(.059,4.34)],bronze,32,root)
    for i in range(8):
        a=i/8*math.tau
        vent=cube('Vent slot',(math.cos(a)*.077,math.sin(a)*.077,4.292),(.005,.026,.021),dark,.003,root)
        vent.rotation_euler.z=a
    lathe('Cast finial',[(.055,4.315),(.055,4.34),(.035,4.355),(.025,4.395),(0,4.425)],iron,32,root)
    marker=empty('lamp-light-source');marker.parent=root;marker.location=(0,0,3.83)
    root['description']='Original cast-metal civic lantern with bronze trim, glazing, opal chimney and service door'
    root['units']='metres';root['light_source_height_metres']=3.83
    return marker


def build():
    reset();bpy.data.orphans_purge(do_recursive=True)
    root=empty('lamp');marker=build_model(root)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.scene.unit_settings.system='METRIC'
    select([root,marker]+objects);bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source/lamp.blend'))
    groups={}
    for obj in objects:
        copy=obj.copy();copy.data=obj.data.copy();bpy.context.collection.objects.link(copy)
        groups.setdefault(copy.data.materials[0].name,[]).append(copy)
    exported=[]
    for name,group in groups.items():
        select(group)
        if len(group)>1:bpy.ops.object.join()
        obj=bpy.context.object;obj.name=name;exported.append(obj)
    select([root,marker]+exported)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/lamp.glb'),export_format='GLB',use_selection=True,
                              export_animations=False,export_yup=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art-source/lamp.blend'));assert not bpy.data.is_dirty
    print('COMPLETE lamp',flush=True)

if __name__=='__main__':build()
