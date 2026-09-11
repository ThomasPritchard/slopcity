"""Append locomotion and matched interactions without changing the citizen mesh.

Imported by build_assets.py for canonical regeneration. To update an existing
source in an isolated background Blender process, pass --source and --output-dir
after Blender's -- separator. Output directories contain citizen.blend/glb.
Blender Z is up; the citizen faces -Y. Root motion belongs to the game runtime.
"""
import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

CLIP_FRAMES = {'Run': 18, 'Jump': 18, 'HandshakeA': 96, 'HandshakeB': 96,
               'HugA': 108, 'HugB': 108}
HANDSHAKE_DISTANCE = .78
HUG_DISTANCE = .48


def smooth(value):
    value = max(0., min(1., value))
    return value * value * (3. - 2. * value)


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0., 0., 0.)
        bone.location = (0., 0., 0.)
        bone.scale = (1., 1., 1.)
    bpy.context.view_layer.update()


def orient_bone(bone, head, direction, orientation=None):
    rest = bone.bone.matrix_local.to_3x3()
    rotation = orientation or (rest.col[1].rotation_difference(direction.normalized()).to_matrix() @ rest)
    assert abs(rotation.determinant() - 1.) < .0001, 'Bone poses must be rotations, not reflections'
    bone.matrix = Matrix.Translation(head) @ rotation.to_4x4()
    bpy.context.view_layer.update()


def reach(rig, side, wrist, pole, hand_rotation):
    """Analytic two-bone reach baked onto the existing three arm bones."""
    upper = rig.pose.bones[f'upper_arm.{side}']
    forearm = rig.pose.bones[f'forearm.{side}']
    hand = rig.pose.bones[f'hand.{side}']
    shoulder = upper.head.copy()
    target = Vector(wrist)
    delta = target - shoulder
    distance = delta.length
    length_a, length_b = upper.length, forearm.length
    assert abs(length_a - length_b) < distance < length_a + length_b, (side, distance)
    direction = delta.normalized()
    along = (length_a * length_a - length_b * length_b + distance * distance) / (2. * distance)
    perpendicular = Vector(pole) - shoulder
    perpendicular -= direction * perpendicular.dot(direction)
    elbow = shoulder + direction * along + perpendicular.normalized() * math.sqrt(max(0., length_a * length_a - along * along))
    orient_bone(upper, shoulder, elbow - shoulder)
    orient_bone(forearm, elbow, target - elbow)
    orient_bone(hand, target, Vector((0, 1, 0)), hand_rotation @ hand.bone.matrix_local.to_3x3())


def pair_pose(rig, name, seconds):
    handshake = name.startswith('Handshake')
    duration = 3.2 if handshake else 3.6
    weight = smooth(seconds / .70) * smooth((duration - seconds) / .75)
    if handshake:
        # Both right palms meet vertically at the midpoint, thumbs uppermost.
        # Palm centers are 48 mm apart, matching the existing hand-shell width.
        shake = .023 * math.sin((seconds - .70) / 1.45 * math.tau * 2) * smooth((seconds - .7) / .16) * smooth((2.40 - seconds) / .18)
        hand_rotation = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0)))
        reach(rig, 'R', (.027, -HANDSHAKE_DISTANCE / 2 + .09, 1.17 + shake),
              (-.42, -.05, 1.12), hand_rotation)
    else:
        # A reaches above B's arms. B reaches below, leaving a separate sleeve
        # corridor on each side of the bodies. Palms rest on the partner's back.
        upper_role = name.endswith('A')
        height = 1.615 if upper_role else 1.24
        # Feet stay clear at 48 cm; both upper bodies lean gently into the hug.
        rig.pose.bones['spine'].rotation_euler.x = .14
        bpy.context.view_layer.update()
        for side, sign in [('L', 1), ('R', -1)]:
            # Fingers curve across the partner's back with thumbs uppermost.
            sine, cosine = math.sin(.35), math.cos(.35)
            hand_rotation = Matrix(((0, -sign * sine, sign * cosine),
                                    (0, cosine, sine), (-sign, 0, 0)))
            if upper_role:
                # The upper role goes over the shoulders, then lays both hands
                # down the upper back. This avoids the partner's sleeve volume.
                hand_rotation = Matrix.Rotation(math.pi, 3, 'Z')
            reach(rig, side, (sign * (.16 if upper_role else .20),
                              -HUG_DISTANCE - (.03 if upper_role else .035), height),
                  (sign * (.60 if upper_role else .44), -.15,
                   1.85 if upper_role else height - .04), hand_rotation)
    target = {bone.name: bone.rotation_euler.to_quaternion() for bone in rig.pose.bones}
    if name == 'HugA':
        # Lift out to the sides before reaching over the partner, and reverse
        # that route on release. A direct idle-to-contact blend cuts through
        # the partner's shoulders even when the held pose itself is clear.
        reset_pose(rig)
        rig.pose.bones['spine'].rotation_euler.x = .055
        bpy.context.view_layer.update()
        for side, sign in [('L', 1), ('R', -1)]:
            reach(rig, side, (sign * .53, -.08, 1.75),
                  (sign * .60, .08, 1.78), Matrix.Rotation(math.pi, 3, 'Z'))
        raised = {bone.name: bone.rotation_euler.to_quaternion() for bone in rig.pose.bones}
        progress = max(0., min(1., seconds / .9, (duration - seconds) / .9))
        reset_pose(rig)
        for bone in rig.pose.bones:
            rotation = (Quaternion().slerp(raised[bone.name], smooth(progress / .4)) if progress <= .4
                        else raised[bone.name].slerp(target[bone.name], smooth((progress - .4) / .6)))
            bone.rotation_euler = rotation.to_euler('XYZ')
        return
    reset_pose(rig)
    for bone in rig.pose.bones:
        bone.rotation_euler = Quaternion().slerp(target[bone.name], weight).to_euler('XYZ')


def locomotion_pose(rig, name, phase):
    if name == 'Run':
        rig.pose.bones['spine'].rotation_euler.x = .10
        rig.pose.bones['hips'].location.y = .022 * (1 - math.cos(phase * 2))
        for side, offset in [('L', 0), ('R', math.pi)]:
            stride = math.sin(phase + offset)
            rig.pose.bones[f'thigh.{side}'].rotation_euler.x = stride * .65
            rig.pose.bones[f'shin.{side}'].rotation_euler.x = .45 + max(0., stride) * .65
            rig.pose.bones[f'foot.{side}'].rotation_euler.x = -.20
            rig.pose.bones[f'upper_arm.{side}'].rotation_euler.x = -stride * .55
            rig.pose.bones[f'forearm.{side}'].rotation_euler.x = -.95
            rig.pose.bones[f'hand.{side}'].rotation_euler.y = .95 if side == 'L' else -.95
    else:
        t = phase / math.tau
        # Runtime supplies the entire airborne arc. Only compact leg/arm motion
        # is authored here, with neutral first and last frames and a soft tuck.
        lift = math.sin(math.pi * t) ** 2
        rig.pose.bones['spine'].rotation_euler.x = .045 * lift
        for side in ('L', 'R'):
            rig.pose.bones[f'thigh.{side}'].rotation_euler.x = -.24 * lift
            rig.pose.bones[f'shin.{side}'].rotation_euler.x = .58 * lift
            rig.pose.bones[f'foot.{side}'].rotation_euler.x = -.22 * lift
            rig.pose.bones[f'upper_arm.{side}'].rotation_euler.x = -.62 * lift
            rig.pose.bones[f'forearm.{side}'].rotation_euler.x = -.42 * lift


def add_interaction_actions(rig):
    bpy.context.scene.render.fps = 30
    rig.animation_data_create()
    rig.animation_data.action = None
    # Idempotently replace only the actions owned by this helper.
    for track in list(rig.animation_data.nla_tracks):
        if track.name in CLIP_FRAMES:
            rig.animation_data.nla_tracks.remove(track)
    for name in CLIP_FRAMES:
        action = bpy.data.actions.get(name)
        if action:
            bpy.data.actions.remove(action)
    for name, last in CLIP_FRAMES.items():
        rig.animation_data.action = None
        previous = {}
        for index in range(last + 1):
            reset_pose(rig)
            if name in ('Run', 'Jump'):
                locomotion_pose(rig, name, index / last * math.tau)
            else:
                pair_pose(rig, name, index / 30)
            for bone in rig.pose.bones:
                if bone.name in previous:
                    bone.rotation_euler.make_compatible(previous[bone.name])
                previous[bone.name] = bone.rotation_euler.copy()
                bone.keyframe_insert('rotation_euler', frame=index + 1, group=bone.name)
                if bone.name == 'hips':
                    bone.keyframe_insert('location', frame=index + 1, group=bone.name)
        action = rig.animation_data.action
        action.name = name
        action.use_fake_user = True
        # Dense authored samples use linear interpolation so fractional runtime
        # sampling cannot overshoot a hand-contact target.
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = 'LINEAR'
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, action)
        track.mute = True
    rig.animation_data.action = None
    reset_pose(rig)
    bpy.context.scene.frame_set(1)


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=root / 'art-source/citizen.blend')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    bpy.ops.wm.open_mainfile(filepath=str(args.source))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
    assert len(rigs) == 1
    add_interaction_actions(rigs[0])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output_dir / 'citizen.blend'))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type in ('ARMATURE', 'MESH'):
            obj.select_set(True)
    bpy.context.view_layer.objects.active = rigs[0]
    bpy.ops.export_scene.gltf(filepath=str(args.output_dir / 'citizen.glb'), export_format='GLB',
                              use_selection=True, export_animations=True, export_yup=True, export_apply=False)


if __name__ == '__main__':
    main()
