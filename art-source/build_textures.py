import bpy, math
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'public'/'textures'
root.mkdir(parents=True,exist_ok=True)
# Original soft studio/sky lighting environment, saved as a floating-point HDR.
w,h=512,256
im=bpy.data.images.new('Slop City lighting environment',width=w,height=h,float_buffer=True)
pixels=[]
for y in range(h):
    v=y/(h-1)
    for x in range(w):
        u=x/w
        sky=max(0,(v-.48)*2)
        base=[.12+sky*.53,.13+sky*.61,.12+sky*.69]
        for cx,cy,sx,sy,power in [(.22,.69,.08,.18,2.5),(.75,.62,.12,.12,1.2),(.48,.91,.15,.055,1.4)]:
            glow=math.exp(-(((u-cx)/sx)**6+((v-cy)/sy)**6))*power
            base=[c+glow for c in base]
        pixels.extend([*base,1])
im.pixels.foreach_set(pixels);im.filepath_raw=str(root/'city-light.hdr');im.file_format='HDR';im.save()
# Two-scale analytic ripple normals. These are original shader data, not a photo.
n=256;normal=bpy.data.images.new('Fountain ripple normals',width=n,height=n);pixels=[]
for y in range(n):
    for x in range(n):
        a=x/n*math.tau;b=y/n*math.tau
        dx=.13*math.cos(a*8+b*3)+.07*math.cos(a*17-b*9)
        dy=.13*math.cos(b*7-a*4)+.07*math.cos(b*19+a*6)
        length=math.sqrt(dx*dx+dy*dy+1)
        pixels.extend([.5-dx/length*.5,.5-dy/length*.5,.5+.5/length,1])
normal.colorspace_settings.name='Non-Color';normal.pixels.foreach_set(pixels);normal.filepath_raw=str(root/'water-normal.png');normal.file_format='PNG';normal.save()
print('Exported original HDR lighting and ripple normals')
