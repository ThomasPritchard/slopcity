import bpy
from mathutils import Vector
from pathlib import Path
root=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'art-source'/'citizen.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=768;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.world.color=(.18,.18,.18)
bpy.ops.object.camera_add(location=(2.1,-4.8,2.2));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,.97))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=65;scene.camera=camera
for location,power,size in [((2,-3,4),450,4),((-3,-1,2.8),300,3),((0,3,3),500,3)]:
 bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.location.z=-.01
m=bpy.data.materials.new('Backdrop');m.diffuse_color=(.22,.25,.23,1);floor.data.materials.append(m)
scene.render.filepath=str(root/'output'/'playwright'/'character-blender.png');bpy.ops.render.render(write_still=True)
