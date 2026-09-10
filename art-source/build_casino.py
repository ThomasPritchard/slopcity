"""Meridian casino: original tables, wheel, machines and interior, in metres."""
import sys, math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_assets import *
reset()
wood=material('Meridian walnut',(.115,.055,.029),.55)
edge=material('Meridian leather',(.052,.074,.06),.77)
felt=material('Meridian felt',(.027,.14,.105),.98)
brass=material('Meridian brass',(.5,.34,.12),.32,.78)
cream=material('Meridian ivory',(.78,.71,.53),.7)
red=material('Meridian red',(.32,.025,.033),.76)
black=material('Meridian black',(.015,.021,.019),.64)
carpet=material('Meridian carpet',(.075,.105,.077),1)
light=material('Meridian warm light',(.85,.65,.32),.4)
light.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(1,.72,.34,1)
light.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=1.6

def text_mesh(label,pos,size,mat,flat=False):
    curve=bpy.data.curves.new('Lettering','FONT');curve.body=label;curve.align_x='CENTER';curve.size=size;curve.extrude=.0008
    obj=bpy.data.objects.new('Lettering '+label,curve);bpy.context.collection.objects.link(obj);obj.location=pos
    if not flat:obj.rotation_euler.x=math.pi/2
    obj.data.materials.append(mat);select([obj]);bpy.ops.object.convert(target='MESH');return bpy.context.object

def chair(x,y,heading=0):
    before=set(bpy.context.scene.objects)
    loft('Chair pedestal',[(0,0,.07,.30,.30),(0,0,.12,.30,.30),(0,0,.15,.085,.085),(0,0,.42,.085,.085)],brass,24)
    cube('Upholstered seat',(0,0,.485),(.66,.64,.115),edge,.07)
    cube('Chair back',(0,-.29,.76),(.65,.115,.5),edge,.055)
    for px in [-.245,.245]:tube('Back support',[(px,-.25,.35),(px,-.31,.88)],.022,brass,sides=8)
    for obj in set(bpy.context.scene.objects)-before:
        obj.location=(x+obj.location.x*math.cos(heading)-obj.location.y*math.sin(heading),y+obj.location.x*math.sin(heading)+obj.location.y*math.cos(heading),obj.location.z)
        obj.rotation_euler.z+=heading

# Large quiet carpet, border, walnut skirting and rhythmic wall lights.
cube('Carpet',(0,20,.072),(31.4,11.4,.035),carpet,.004)
for x in [-15.4,15.4]:cube('Carpet border',(x,20,.094),(.04,11.2,.012),brass,.003)
for y in [14.45,25.55]:cube('Carpet border',(0,y,.094),(30.8,.04,.012),brass,.003)
for y in [14.6,25.4]:cube('Walnut skirting',(0,y,.22),(31.3,.12,.26),wood,.015)
for x in [-15.65,15.65]:cube('Side skirting',(x,20,.22),(.12,11.4,.26),wood,.015)
for x in [-14,-10,-6,-2,2,6,10,14]:
    cube('Rear wall panel',(x,25.65,1.85),(2.8,.08,2.85),wood,.025)
    for dx in [-1.27,1.27]:cube('Panel brass line',(x+dx,25.58,1.85),(.022,.03,2.65),brass,.002)
    cube('Wall light',(x,25.49,2.75),(.12,.13,.65),light,.026)
# Roulette table with brass grid, trays and rail.
cube('Roulette cabinet',(-8,20,.58),(4.65,1.9,.98),wood,.09)
cube('Roulette padded rim',(-8,20,1.065),(5.25,2.55,.22),edge,.22)
cube('Roulette cloth',(-8,20,1.18),(4.90,2.20,.04),felt,.18)
for x in [-10.42,-5.58]:cube('Roulette side inlay',(x,20,1.208),(.012,1.75,.012),brass,.002)
# Wheel bowl sits at left; the moving rotor is a separate authored export.
wheel_x,wheel_y=-9.37,20
bowl=lathe('Wheel bowl',[(.30,1.19),(.79,1.19),(.98,1.36),(1.01,1.39),(1.015,1.43),(.96,1.43),(.78,1.30),(.3,1.24)],wood,96)
bowl.location.x=wheel_x;bowl.location.y=wheel_y
for radius,z in [(1.0,1.43),(.79,1.30)]:tube('Bowl inlay',[(wheel_x+radius*math.cos(i/96*math.tau),wheel_y+radius*math.sin(i/96*math.tau),z) for i in range(97)],.008,brass,sides=6)
# Betting layout mirrors the 2D number board: zero band across the top, six columns of
# six numbers reading row-major (1..6 in the first row), then dozens, column marks and
# the even-money row, with red/black cell fills from the shared red-number set.
reds={1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}
for n in range(1,37):
    cx,cy=-8.05+(n-1)%6*.40,20.525-(n-1)//6*.15
    cube('Number fill',(cx,cy,1.203),(.388,.138,.006),red if n in reds else black,0)
    text_mesh(str(n),(cx,cy,1.222),.095,cream,True)
for col in range(7):cube('Betting grid',(-8.25+col*.40,20.17,1.212),(.013,.90,.012),cream,.001)
for row in range(7):cube('Betting grid',(-7.05,19.72+row*.15,1.212),(2.40,.009,.012),cream,.001)
cube('Betting grid',(-7.05,20.86,1.212),(2.40,.009,.012),cream,.001)
for x in [-8.25,-5.85]:cube('Zero side',(x,20.74,1.212),(.013,.24,.012),cream,.001)
text_mesh('0',(-7.05,20.74,1.222),.11,cream,True)
for i in range(4):cube('Dozen border',(-8.25+i*.80,19.645,1.212),(.013,.15,.012),cream,.001)
cube('Betting grid',(-7.05,19.57,1.212),(2.40,.009,.012),cream,.001)
for i,label in enumerate(['1ST 12','2ND 12','3RD 12']):text_mesh(label,(-7.85+i*.80,19.645,1.222),.062,cream,True)
for col in range(7):cube('Even border',(-8.25+col*.40,19.495,1.212),(.013,.15,.012),cream,.001)
cube('Betting grid',(-7.05,19.42,1.212),(2.40,.009,.012),cream,.001)
for i,label in enumerate(['1–18','EVEN','RED','BLACK','ODD','19–36']):
    cx=-8.05+i*.40
    if label in ('RED','BLACK'):cube('Even fill',(cx,19.495,1.203),(.388,.138,.006),red if label=='RED' else black,0)
    text_mesh(label,(cx,19.495,1.222),.055,cream,True)
for y in [20.44,20.17,19.90]:
    for dy in [-.065,.065]:cube('Column mark',(-5.70,y+dy,1.212),(.17,.009,.012),cream,.001)
    for dx in [-.085,.085]:cube('Column mark',(-5.70+dx,y,1.212),(.013,.13,.012),cream,.001)
    text_mesh('2:1',(-5.70,y,1.222),.05,cream,True)
text_mesh('EUROPEAN  /  SINGLE ZERO',(-8,18.85,1.207),.12,cream,True)
# D-shaped blackjack tables. Player chairs follow a fixed five-place arc.
seat_offsets=[(-1.8,-.6),(-1.15,-1.5),(0,-1.9),(1.15,-1.5),(1.8,-.6)]
for tx in [3,10]:
    for dx in [-1.2,1.2]:cube('Table pedestal',(tx+dx,19,.55),(.28,.65,.95),wood,.035)
    outline=[(tx-2.35,19.42),(tx+2.35,19.42)]+[(tx+math.cos(i/48*math.pi)*2.35,19.25-math.sin(i/48*math.pi)*1.48) for i in range(49)]
    for z,mat,scale in [(1.04,edge,1),(1.145,felt,.92)]:
        points=[(tx+(x-tx)*scale,19+(y-19)*scale,z) for x,y in outline]
        mesh('Blackjack table surface',points,[tuple(reversed(range(len(points))))],mat)
    tube('Leather table rail',[(x,y,1.09) for x,y in outline+[outline[0]]],.08,edge,sides=12)
    text_mesh('BLACKJACK  PAYS  3:2',(tx,18.75,1.153),.13,cream,True)
    text_mesh('DEALER STANDS ON ALL 17',(tx,19.08,1.153),.083,cream,True)
    cube('Dealer tray',(tx,19.31,1.18),(1.0,.24,.09),black,.015)
    for i in range(14):
        chip=loft('Dealer chips',[(tx-.42+i*.065,19.30,1.235,.025,.025),(tx-.42+i*.065,19.30,1.275,.025,.025)],red if i%3 else cream,12)
    for sx,sy in seat_offsets:
        heading=math.atan2(-sx,-sy)
        chair(tx+sx,19+sy,-heading)
        # Each betting arc sits on the felt in front of the corresponding chair.
        px,py=tx+sx*.66,19+sy*.62
        tube('Betting circle',[(px+math.cos(i/32*math.tau)*.17,py+math.sin(i/32*math.tau)*.12,1.155) for i in range(33)],.006,cream,sides=6)
# Six individually numbered slot cabinets, plus padded stools.
for i,x in enumerate([-12,-7,-2,3,8,13]):
    y=24
    cube('Slot cabinet',(x,y,.95),(1.28,.88,1.72),wood,.075)
    cube('Slot brass face',(x,y-.453,1.38),(1.20,.045,1.14),brass,.045)
    cube('Slot dark display',(x,y-.482,1.48),(1.09,.04,.86),black,.035)
    for dx in [-.34,0,.34]:
        cube('Slot reel',(x+dx,y-.510,1.48),(.30,.035,.46),cream,.025)
        text_mesh('7',(x+dx,y-.535,1.40),.24,red)
    cube('Slot control shelf',(x,y-.68,.94),(1.32,.49,.12),edge,.035)
    cube('Spin key',(x+.36,y-.72,1.021),(.21,.17,.04),light,.025)
    cube('Coin slot',(x-.32,y-.72,1.012),(.10,.016,.012),black,.002)
    cube('Slot crown',(x,y,1.92),(1.38,.94,.26),edge,.04)
    text_mesh('MERIDIAN  0'+str(i+1),(x,y-.483,1.88),.11,cream)
    for dx in [-.57,.57]:cube('Slot light strip',(x+dx,y-.51,1.47),(.022,.028,.82),light,.007)
    chair(x,y-1.25,0)
# Lounge at the left side of the entrance, with brass feet and stitched cushions.
for x in [-13.4,-11.4]:
    cube('Lounge chair seat',(x,16,.48),(1.12,.95,.26),edge,.10)
    cube('Lounge chair back',(x,16.40,.90),(1.12,.22,.85),edge,.09)
    for dx in [-.58,.58]:cube('Lounge chair arm',(x+dx,16,.69),(.18,1.04,.42),wood,.05)
    for dx in [-.46,.46]:
        for dy in [-.35,.35]:cube('Lounge foot',(x+dx,16+dy,.17),(.055,.055,.25),brass,.009)
objects=join_by_material([o for o in bpy.context.scene.objects if o.type=='MESH'])
export('casino-kit',objects)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/'casino-kit.blend'))
# Standalone roulette rotor, local origin at centre, base zero; runtime animates this root.
reset()
order=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26]
reds={1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}
for i,n in enumerate(order):
    a,b=i/37*math.tau,(i+1)/37*math.tau
    verts=[(r*math.cos(t),r*math.sin(t),z) for r,z in [(.53,.0),(.76,.0)] for t in [a,b]]
    mesh('Roulette pocket',verts,[(0,2,3,1)],felt if n==0 else red if n in reds else black)
    tube('Pocket divider',[(.53*math.cos(a),.53*math.sin(a),.012),(.76*math.cos(a),.76*math.sin(a),.012)],.006,brass,sides=6)
    t=(a+b)/2;label=text_mesh(str(n),(.65*math.cos(t),.65*math.sin(t),.013),.084,cream,True);label.rotation_euler.z=t-math.pi/2
lathe('Wheel hub',[(.0,.075),(.09,.075),(.14,.035),(.53,0)],wood,72)
lathe('Wheel spindle',[(.0,.19),(.04,.19),(.05,.05)],brass,32)
for a in [0,math.pi/2]:tube('Spindle cross',[(math.cos(a)*-.18,math.sin(a)*-.18,.17),(math.cos(a)*.18,math.sin(a)*.18,.17)],.018,brass,sides=10)
objects=join_by_material([o for o in bpy.context.scene.objects if o.type=='MESH'])
export('roulette-wheel',objects)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art-source'/'roulette-wheel.blend'))
