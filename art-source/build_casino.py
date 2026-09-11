"""Maintained Meridian architecture and reusable furniture, authored in metres.
Blender (x,y,z) maps to town (x,z,y) after the Babylon root rotation of pi.
Architecture uses absolute town-plan coordinates; furniture origins are floor level.
This builder consumes no prototype source, scene, or geometry.
"""
import sys, math, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import bpy, ROOT, OUT, reset, material, mesh, cube, loft, lathe, tube, ellipsoid, bevel, select, export, join_by_material, empty
from mathutils import Vector
TAU=math.tau
SOURCE=ROOT/'art-source'
STATS={}
REDS={1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36}
ORDER=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26]


def glow(name,colour,strength):
    mat=material(name,colour,.27)
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Emission Color'].default_value=(*colour,1)
    bsdf.inputs['Emission Strength'].default_value=strength
    return mat


def start():
    reset()
    global stone,pale,wood,leather,felt,bronze,ivory,red,black,carpet,light,neon,bulb,glass
    stone=material('Meridian limestone',(.58,.53,.43),.78)
    pale=material('Meridian honed limestone',(.77,.73,.62),.58)
    wood=material('Meridian walnut',(.105,.049,.026),.43)
    leather=material('Meridian evergreen upholstery',(.025,.067,.048),.68)
    felt=material('Meridian gaming felt',(.025,.145,.096),.96)
    bronze=material('Meridian brushed bronze',(.48,.29,.105),.30,.8)
    ivory=material('Meridian ivory marking',(.86,.80,.62),.64)
    red=material('Meridian roulette red',(.42,.015,.024),.65)
    black=material('Meridian charcoal',(.011,.017,.015),.57)
    carpet=material('Meridian evergreen carpet',(.041,.085,.065),.99)
    light=glow('Meridian interior opal glow',(.95,.68,.31),1.2)
    neon=glow('Meridian neon red',(1,.015,.007),3)
    bulb=glow('Meridian bulb glow',(1,.58,.18),2.5)
    glass=glow('Meridian glass glow',(.68,.58,.34),.65)


def rounded(w,d,r,segments=8,x=0,y=0):
    points=[]
    for cx,cy,start_angle in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for i in range(segments+1):
            a=math.radians(start_angle+i*90/segments)
            points.append((x+cx+r*math.cos(a),y+cy+r*math.sin(a)))
    return points


def prism(name,outline,bottom,top,mat,radius=0):
    n=len(outline)
    verts=[(x,y,z) for z in [bottom,top] for x,y in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj=mesh(name,verts,faces,mat)
    for p in obj.data.polygons:p.use_smooth=False
    if radius:bevel(obj,radius,2)
    return obj


def rim(name,outline,height,radius,mat,sides=8):
    return tube(name,[(x,y,height) for x,y in outline+[outline[0]]],radius,mat,sides=sides)


def ring(name,x,y,height,radius,thickness,mat,segments=64):
    return tube(name,[(x+radius*math.cos(i/segments*TAU),y+radius*math.sin(i/segments*TAU),height) for i in range(segments+1)],thickness,mat,sides=8)


def text(label,pos,size,mat,flat=False,heading=0):
    data=bpy.data.curves.new(label,'FONT');data.body=label;data.align_x='CENTER';data.align_y='CENTER'
    data.size=size;data.extrude=.0006 if flat else .002;data.resolution_u=3
    obj=bpy.data.objects.new('Lettering '+label,data);bpy.context.collection.objects.link(obj)
    obj.location=pos;obj.rotation_euler=(0 if flat else math.pi/2,0,heading);obj.data.materials.append(mat)
    select([obj]);bpy.ops.object.convert(target='MESH');return bpy.context.object


def marker(name,position):
    obj=empty(name);obj.location=position;return obj


def finish(name):
    """Save editable components, then batch disposable mesh copies for runtime."""
    objects=[o for o in bpy.context.scene.objects if o.type in {'MESH','EMPTY'}]
    source_meshes=[o for o in objects if o.type=='MESH']
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.blend')))
    copies=[]
    for obj in source_meshes:
        duplicate=obj.copy();duplicate.data=obj.data.copy();bpy.context.collection.objects.link(duplicate);copies.append(duplicate)
    batched=join_by_material(copies)
    export(name,batched+[o for o in objects if o.type=='EMPTY'])
    points=[obj.matrix_world@Vector(v) for obj in source_meshes for v in obj.bound_box]
    STATS[name]={'sourceMeshes':len(source_meshes),'runtimeMaterialMeshes':len(batched),
        'triangles':sum(len(p.vertices)-2 for obj in batched for p in obj.data.polygons),'bytes':(OUT/(name+'.glb')).stat().st_size,
        'blenderBounds':{'min':[round(min(p[i] for p in points),4) for i in range(3)],'max':[round(max(p[i] for p in points),4) for i in range(3)]},
        'markers':{o.name:list(o.location) for o in objects if o.type=='EMPTY'}}
    print('MERIDIAN_ASSET',name,json.dumps(STATS[name]),flush=True)


def shell():
    start()
    cube('Ground-level foundation',(0,35,-.14),(40,42,.28),stone,.025)
    # Finished stone clears the town paving's existing 24 mm surface relief.
    cube('Foyer finished limestone floor',(0,19.2,.015),(39.4,10.4,.03),pale,.003)
    cube('Raised hall slab',(0,40.2,.445),(39.4,31.6,.91),pale,.015)
    for i in range(5):
        h=(i+1)*.18
        cube('Arrival stair '+str(i+1),(0,22+(i+.5)*.48,h/2),(12,.48,h),pale,.006)
        cube('Bronze stair nosing '+str(i+1),(0,22+i*.48+.025,h-.004),(11.96,.035,.008),bronze,.002)
    vertices=[(7,22,0),(19,22,0),(19,24.4,0),(7,24.4,0),(7,22,.005),(19,22,.9),(19,24.4,.9),(7,24.4,.005)]
    ramp=mesh('Accessible east ramp 1 in 13.333',vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],pale)
    for p in ramp.data.polygons:p.use_smooth=False
    for side in [-1,1]:
        cube('Hall exterior side wall',(side*19.85,40.05,4.55),(.3,31.9,7.3),stone,.025)
        cube('Lower wing side wall',(side*19.85,19,3.1),(.3,10,6.2),stone,.025)
        cube('Front enclosed wing',(side*10.9,14.15,3.1),(17.8,.3,6.2),stone,.025)
        for y in [27,35,43,51,55.7]:
            cube('Side pilaster',(side*19.58,y,4.35),(.32,.70,6.9),pale,.025)
            cube('Pilaster bronze shoe',(side*19.55,y,1.13),(.37,.77,.46),bronze,.012)
        for xabs in [6.1,10.65,15.2,19.55]:
            xx=xabs*side
            cube('Facade evergreen inset',(xx-side*1.92,13.976,2.30),(3.25,.06,3.25),leather,.06)
            cube('Facade limestone pilaster',(xx,13.85,3.03),(.38,.6,5.94),pale,.035)
            for offset in [-.095,.095]:cube('Facade bronze flute',(xx+offset,13.53,2.84),(.025,.022,4.2),bronze,.005)
        cube('Side architectural cornice',(side*19.86,40.15,8.12),(.40,31.7,.18),pale,.025)
    cube('Rear limestone wall',(0,55.85,4.55),(40,.30,7.3),stone,.025)
    cube('Rear architectural cornice',(0,55.84,8.12),(40,.42,.18),pale,.025)
    cube('Front fascia backing',(0,14.10,5.47),(40,.60,1.45),leather,.06)
    cube('Fascia upper limestone ledge',(0,14.07,6.26),(40.25,.78,.16),pale,.025)
    for x in [-5.22,5.22]:cube('Main sign architectural side frame',(x,13.70,5.4),(.14,.20,1.85),bronze,.022)
    marker('meridian-fascia-sign-anchor',(0,13.75,5.4))
    outline=rounded(39.6,3.5,1.35,16,y=12.95)
    prism('Rounded evergreen marquee',outline,3.94,4.63,leather,.035)
    # Clip the emissive perimeter to an open exterior U. The 50 mm inset also
    # keeps the complete neon/bulb radii south of the foyer threshold at y=14.
    exterior_limit=13.95
    runs=[];current=[]
    for a,b in zip(outline,outline[1:]+outline[:1]):
        inside_a,inside_b=a[1]<=exterior_limit,b[1]<=exterior_limit
        if inside_a and inside_b:
            if not current:current=[a]
            current.append(b)
        elif inside_a != inside_b:
            t=(exterior_limit-a[1])/(b[1]-a[1])
            crossing=(a[0]+(b[0]-a[0])*t,exterior_limit)
            if inside_a:
                if not current:current=[a]
                current.append(crossing);runs.append(current);current=[]
            else:current=[crossing,b]
    if current:runs.append(current)
    assert len(runs)==2 and math.dist(runs[-1][-1],runs[0][0])<.00001
    exterior_path=runs[-1]+runs[0][1:]
    for phase,h in enumerate([4.08,4.29,4.50]):
        chase=glow('Meridian neon red chase '+str(phase),(1,.015,.007),3)
        tube('Exterior U neon marquee band '+str(phase),[(x,y,h) for x,y in exterior_path],.033,chase,sides=8)
    rim('Marquee bronze soffit edge',outline,3.945,.035,bronze)
    # Consecutive perimeter bulbs cycle through eight independently driven groups.
    bulb_groups=[glow('Meridian bulb glow chase '+str(i),(1,.58,.18),2.5) for i in range(8)]
    bulb_index=0
    for a,b in zip(exterior_path,exterior_path[1:]):
        count=max(1,round(math.dist(a,b)/.37))
        for i in range(count):
            t=i/count;x,y=a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t
            ellipsoid('Warm marquee bulb '+str(bulb_index),(x,y,3.90),(.043,.043,.042),bulb_groups[bulb_index%8],segments=8,rings=4)
            bulb_index+=1
    for side in [-1,1]:
        x,y=side*2.68,13.25
        loft('Entrance pier base',[(x,y,.02,.59,.59),(x,y,.15,.59,.59),(x,y,.22,.50,.50)],bronze,32)
        loft('Entrance glassblock core',[(x,y,.20,.49,.49),(x,y,3.94,.49,.49)],glass,32)
        for h in [.22+i*.23 for i in range(17)]:ring('Glassblock horizontal joint',x,y,h,.496,.010,bronze,32)
        for i in range(16):
            a=i/16*TAU
            tube('Glassblock vertical joint',[(x+.496*math.cos(a),y+.496*math.sin(a),.22),(x+.496*math.cos(a),y+.496*math.sin(a),3.93)],.008,bronze,sides=5)
        loft('Entrance pier capital',[(x,y,3.75,.51,.51),(x,y,3.91,.62,.62)],bronze,32)
    finish('meridian-shell')


def roof():
    start()
    cube('Lower wings weather roof',(0,19.15,4.35),(40,10.6,.22),leather,.025)
    cube('Hall upper front closure',(0,24.22,6.31),(40,.34,3.62),stone,.025)
    for x in [-16,-8,0,8,16]:
        cube('Upper facade evergreen inset',(x,24.035,6.35),(5.9,.055,2.20),leather,.045)
        for dx in [-2.80,2.80]:cube('Upper facade bronze border',(x+dx,23.998,6.35),(.025,.024,1.98),bronze,.004)
    cube('Hall weather roof',(0,40.1,8.32),(40.3,32.1,.24),leather,.025)
    for x in [-19.8,19.8]:cube('Roof parapet coping',(x,40.1,8.55),(.60,32,.22),pale,.025)
    for y in [24.3,55.9]:cube('Roof parapet coping',(0,y,8.55),(40.2,.60,.22),pale,.025)
    finish('meridian-roof')


def coffer_frame(name,w,d,band,bottom,top,radius,x,y,mat):
    """A genuine hollow coffer surround, retaining a recessed visible ceiling."""
    outer=rounded(w,d,radius,6,x=x,y=y)
    inner=rounded(w-2*band,d-2*band,max(.02,radius-band),6,x=x,y=y)
    n=len(outer)
    verts=[(px,py,z) for z,outline in [(bottom,outer),(bottom,inner),(top,outer),(top,inner)] for px,py in outline]
    faces=[]
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,j+2*n,i+2*n),(i+n,i+3*n,j+3*n,j+n),
                      (i,j+n,j,i+n),(i+2*n,j+2*n,j+3*n,i+3*n)])
    # Explicitly ordered underside and top faces prevent twisted ring quads.
    for i in range(n):
        faces[i*4+2]=(i,i+n,(i+1)%n+n,(i+1)%n)
    obj=mesh(name,verts,faces,mat)
    for poly in obj.data.polygons:poly.use_smooth=False
    return obj


def ceiling():
    start()
    ceiling_ivory=material('Meridian ceiling ivory plaster',(.82,.77,.65),.70)
    cove=glow('Meridian ceiling warm cove glow',(1,.72,.36),1.6)
    # Separate from the weather envelope: runtime keeps this decorative ceiling visible.
    cube('Foyer ivory ceiling field',(0,19.2,4.20),(39.4,10.4,.08),ceiling_ivory,.006)
    for x in [-3.35,3.35]:
        for y in [16.65,21.75]:
            coffer_frame('Foyer stepped ivory coffer',6.18,4.62,.18,4.00,4.165,.28,x,y,ceiling_ivory)
            rim('Foyer coffer bronze moulding',rounded(5.84,4.28,.16,6,x=x,y=y),4.012,.026,bronze)
            rim('Foyer warm recessed cove',rounded(5.72,4.16,.14,6,x=x,y=y),4.09,.012,cove,sides=6)
    # Main ceiling field is at 8.08 m; mouldings descend to approximately 7.90 m.
    cube('Hall ivory ceiling field',(0,40.15,8.14),(39.4,31.7,.12),ceiling_ivory,.008)
    for x in [-14.4,-7.2,0,7.2,14.4]:
        for y in [28.5,35.9,43.3,50.7]:
            if x==0 and y in [35.9,43.3]:continue
            coffer_frame('Hall stepped ivory coffer',6.72,6.85,.19,7.92,8.085,.44,x,y,ceiling_ivory)
            rim('Hall coffer outer bronze reveal',rounded(6.65,6.78,.42,6,x=x,y=y),7.915,.022,bronze)
            rim('Hall coffer inner bronze reveal',rounded(6.27,6.40,.24,6,x=x,y=y),7.93,.025,bronze)
            rim('Hall coffer warm cove',rounded(6.14,6.27,.20,6,x=x,y=y),8.01,.013,cove,sides=6)
            for dx in [-2.64,2.64]:
                for dy in [-2.70,2.70]:
                    diamond=cube('Coffer corner bronze diamond',(x+dx,y+dy,8.062),(.21,.21,.025),bronze,.008)
                    diamond.rotation_euler.z=math.pi/4
    # A long central panel frames a sunburst medallion directly above the chandelier.
    coffer_frame('Central grand ceiling surround',6.72,14.2,.20,7.91,8.085,.48,0,39.6,ceiling_ivory)
    rim('Central bronze ceiling reveal',rounded(6.35,13.84,.30,8,y=39.6),7.925,.027,bronze)
    for radius,h,width,mat in [(3.06,8.025,.026,bronze),(2.91,8.035,.015,cove),(2.74,8.03,.026,bronze),(.62,8.025,.026,bronze)]:
        ring('Ceiling medallion concentric ring',0,38,h,radius,width,mat,96)
    for i in range(48):
        a=i/48*TAU
        r0=.73 if i%2==0 else 1.55
        tube('Medallion bronze sunburst ray',[(r0*math.cos(a),38+r0*math.sin(a),8.035),(2.65*math.cos(a),38+2.65*math.sin(a),8.035)],.011,bronze,sides=5)
    # Concealed perimeter cornice and cove keeps the grand room visually enclosed.
    coffer_frame('Hall perimeter ivory cornice',39.4,31.7,.24,7.88,8.085,.40,0,40.15,ceiling_ivory)
    rim('Hall perimeter warm cove',rounded(38.86,31.16,.20,8,y=40.15),7.985,.018,cove,sides=6)
    marker('meridian-ceiling-medallion',(0,38,8.03))
    finish('meridian-ceiling')


def chandelier():
    start()
    opal=glow('Meridian chandelier opal glow',(1,.76,.42),2.1)
    crystal=material('Meridian chandelier cut crystal',(.78,.86,.80),.17,.18)
    # This deliberately opaque faceted crystal avoids runtime transparency sorting.
    canopy=lathe('Chandelier stepped ceiling rose',[(0,7.80),(.48,7.80),(.48,7.74),(.35,7.69),(.18,7.65),(0,7.65)],bronze,48)
    canopy.location.y=38
    tube('Chandelier upper ceiling mount',[(0,38,7.77),(0,38,8.04)],.042,bronze,sides=10)
    tube('Chandelier central suspension',[(0,38,5.30),(0,38,7.72)],.036,bronze,sides=10)
    tiers=[(2.48,7.21,.46,40),(1.96,6.70,.47,32),(1.39,6.17,.46,24),(.79,5.66,.40,16)]
    for tier,(radius,top,drop,count) in enumerate(tiers):
        for z in [top,top-.075]:ring('Chandelier tier bronze gallery',0,38,z,radius,.027,bronze,64)
        ring('Chandelier concealed opal ribbon',0,38,top-.04,radius-.065,.026,opal,64)
        for i in range(count):
            a=(i+.5)/count*TAU;x,y=radius*math.cos(a),38+radius*math.sin(a)
            # Long six-sided pendants, with a pointed foot and separate bronze cap.
            loft('Chandelier faceted crystal pendant',[(x,y,top-drop,.018,.018),(x,y,top-drop+.075,.068,.068),(x,y,top-.105,.068,.068),(x,y,top-.065,.047,.047)],crystal if i%3 else opal,6)
            loft('Chandelier pendant bronze crown',[(x,y,top-.085,.077,.077),(x,y,top-.04,.077,.077)],bronze,6)
        for i in range(8):
            a=i/8*TAU
            tube('Chandelier tier radial brace',[(.10*math.cos(a),38+.10*math.sin(a),top+.04),((radius-.03)*math.cos(a),38+(radius-.03)*math.sin(a),top+.04)],.016,bronze,sides=6)
    for i in range(8):
        a=(i+.5)/8*TAU
        tube('Chandelier swept suspension arm',[(.20*math.cos(a),38+.20*math.sin(a),7.69),(.70*math.cos(a),38+.70*math.sin(a),7.61),(1.50*math.cos(a),38+1.50*math.sin(a),7.33),(2.48*math.cos(a),38+2.48*math.sin(a),7.25)],.020,bronze,sides=8)
    finial=loft('Chandelier central opal finial',[(0,38,5.15,.018,.018),(0,38,5.24,.14,.14),(0,38,5.37,.15,.15),(0,38,5.42,.08,.08)],opal,12)
    marker('meridian-chandelier-light-anchor',(0,38,6.1))
    finish('meridian-chandelier')


def rail(name,a,b,za,zb):
    count=max(1,math.ceil(math.dist(a,b)/1.5))
    for i in range(count+1):
        t=i/count;x,y,z=a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,za+(zb-za)*t
        cube(name+' upright',(x,y,z+.50),(.06,.06,1),bronze,.009)
        cube(name+' foot',(x,y,z+.025),(.17,.17,.05),bronze,.015)
    for h in [.32,.70,1.02]:tube(name+' continuous rail',[(a[0],a[1],za+h),(b[0],b[1],zb+h)],.03 if h==1.02 else .016,bronze,sides=8)


def interior():
    start()
    cube('Main hall carpet',(0,40.19,.905),(38.85,31.50,.012),carpet,.01)
    for x in [-18.95,18.95]:cube('Carpet bronze border',(x,40.18,.914),(.028,30.9,.008),bronze,.002)
    for y in [24.74,55.61]:cube('Carpet bronze border',(0,y,.914),(37.92,.028,.008),bronze,.002)
    cube('Foyer limestone arrival runner',(0,18,.033),(4.1,8,.006),pale,.002)
    for x in [-2.12,2.12]:cube('Foyer bronze inlay',(x,18,.038),(.03,8,.004),bronze,.001)
    # The foyer now remains enclosed through the top of the stair approach.
    # The right-hand opening alone admits the east ramp corridor.
    for x,y0,y1 in [(-7,14,24.4),(7,14,20.7),(7,22.3,24.4)]:
        cy=(y0+y1)/2;length=y1-y0
        cube('Foyer full-height wing partition',(x,cy,2),(.26,length,4),stone,.018)
        face=x-math.copysign(.15,x)
        cube('Foyer walnut dado panel',(face,cy,.81),(.06,length,1.52),wood,.012)
        cube('Foyer bronze dado cap',(face-math.copysign(.04,x),cy,1.60),(.04,length,.05),bronze,.008)
        cube('Partition walnut skirting',(face,cy,.20),(.08,length,.36),wood,.018)
    cube('Ramp doorway stone lintel',(7,21.5,3.4),(.32,1.6,1.2),pale,.018)
    for y in [20.62,22.38]:
        cube('Ramp access stone jamb',(7,y,1.4),(.36,.16,2.8),pale,.018)
        cube('Ramp access bronze jamb reveal',(6.81,y,1.4),(.025,.034,2.66),bronze,.005)
    cube('Ramp access bronze lintel reveal',(6.81,21.5,2.84),(.025,1.6,.04),bronze,.005)
    marker('meridian-ramp-doorway',(7,21.5,0))
    for side in [-1,1]:
        x=side*6.15
        cube('Enclosed stair side wall',(x,23.2,2),(.30,2.4,4),stone,.015)
        cube('Stair walnut wall panel',(side*5.988,23.2,1.20),(.022,2.4,1.8),wood,.006)
        cube('Stair bronze dado cap',(side*5.967,23.2,2.12),(.020,2.4,.035),bronze,.004)
        # Jamb faces stay outside the clear x +/-6 m stair width.
        cube('Grand stair portal limestone jamb',(side*6.18,24.4,2.35),(.36,.44,4.7),pale,.018)
        for offset in [-.075,.075]:
            cube('Grand stair portal bronze flute',(side*6.18+offset,24.164,2.23),(.025,.020,3.70),bronze,.005)
    cube('Closed west stair shoulder',(-6.575,22,2),(.85,.26,4),stone,.015)
    # No east shoulder crosses x6.3..7: that narrow corridor reaches the ramp doorway.
    cube('Grand stair portal ivory lintel',(0,24.4,4.25),(12.72,.44,.9),pale,.018)
    cube('Grand stair portal lower bronze reveal',(0,24.16,3.85),(12,.025,.05),bronze,.006)
    cube('Grand stair portal upper bronze reveal',(0,24.16,4.59),(12.46,.025,.045),bronze,.006)
    for x in [-.58,-.29,0,.29,.58]:
        diamond=cube('Grand portal bronze fan motif',(x,24.157,4.26),(.11,.024,.28),bronze,.009)
        diamond.rotation_euler.y=-x*.65
    for side in [-1,1]:
        for y in [28,36,44,52]:
            cube('Hall walnut wall panel',(side*19.64,y,2.80),(.055,5.2,3.8),wood,.012)
            for dy in [-2.3,2.3]:cube('Wall panel bronze border',(side*19.60,y+dy,2.8),(.03,.025,3.4),bronze,.004)
            cube('Opal wall lantern',(side*19.45,y,3.80),(.18,.24,1.10),light,.065)
            cube('Wall lantern bronze back',(side*19.58,y,3.80),(.09,.43,1.26),bronze,.045)
    # Reception customer face points -X, into the foyer.
    prism('Reception walnut carcass',rounded(1.25,4.18,.22,x=4.8,y=18.25),.08,1.015,wood,.012)
    prism('Reception rounded limestone top',rounded(1.35,4.30,.23,x=4.8,y=18.25),1.015,1.08,pale,.012)
    rim('Reception bronze plinth',rounded(1.25,4.18,.22,x=4.8,y=18.25),.14,.027,bronze)
    for y in [16.47+i*.19 for i in range(20)]:cube('Reception inward walnut flute',(4.164,y,.59),(.022,.06,.75),stone,.012)
    cube('Reception inward nameplate',(4.132,18.25,.68),(.035,1.52,.25),leather,.035)
    text('RECEPTION',(4.110,18.25,.69),.13,ivory,heading=-math.pi/2)
    # Visual placeholder, with no wallet or machine interaction authored here.
    cube('ATM alcove stone surround',(-6.43,18.25,1.40),(.85,2.24,2.80),pale,.14)
    cube('ATM evergreen insert',(-5.985,18.25,1.36),(.06,1.62,2.18),leather,.11)
    cube('ATM display bronze reveal',(-5.963,18.25,1.58),(.022,1.01,.64),bronze,.052)
    cube('ATM dark inactive display',(-5.943,18.25,1.58),(.035,.89,.52),black,.045)
    text('ATM',(-5.914,18.25,2.20),.19,ivory,heading=math.pi/2)
    text('COMING LATER',(-5.910,18.25,1.15),.080,ivory,heading=math.pi/2)
    marker('meridian-atm-placeholder',(-6.05,18.25,0))
    rail('West hall ledge',(-19.7,24.33),(-6.15,24.33),.9,.9)
    rail('East hall ledge',(6.15,24.33),(7,24.33),.9,.9)
    rail('Ramp north handrail',(7,24.36),(17.8,24.36),0,.81)
    rail('Ramp south handrail',(8.4,22),(19,22),.105,.9)
    rail('Ramp east handrail',(19,22.1),(19,24.26),.9,.9)
    for x in [-11.5,11.5]:rim('Future bay carpet inset',rounded(11,7,.3,x=x,y=51.4),.917,.008,bronze,sides=6)
    for x,y in [(0,32),(0,44)]:rim('Roulette island carpet medallion',rounded(7,5.2,1.6,x=x,y=y),.917,.016,bronze,sides=6)
    finish('meridian-interior')


def roulette():
    start()
    outline=rounded(5.10,2.30,.46,12)
    prism('Roulette sculpted walnut pedestal',rounded(3.95,1.40,.40),.13,.99,wood,.045)
    prism('Roulette bronze pedestal shoe',rounded(4.02,1.47,.41),0,.19,bronze,.012)
    for x in [-1.75,-.65,.65,1.75]:
        for y in [-.71,.71]:cube('Roulette cabinet fluting',(x,y,.58),(.025,.022,.65),bronze,.006)
    prism('Roulette walnut tabletop fascia',outline,.94,1.105,wood,.02)
    rim('Roulette lower bronze reveal',outline,1.045,.021,bronze)
    prism('Roulette upholstered cushion',outline,1.095,1.19,leather,.035)
    prism('Roulette continuous felt',rounded(4.82,2.05,.37,12),1.177,1.20,felt,.007)
    rim('Roulette stitched cushion seam',rounded(4.96,2.17,.41,12),1.194,.004,ivory,sides=5)
    # A flat outer race feeds a sloping apron, with a clear cavity below the rotor.
    # Rotor underside is table height1.29; the cavity floor stays15 mm below it.
    bowl=lathe('Roulette turned walnut bowl',[(.30,1.20),(.76,1.20),(.94,1.33),(.98,1.40),(.98,1.435),(.93,1.435),(.93,1.39),(.84,1.39),(.79,1.36),(.805,1.345),(.805,1.275),(.30,1.275)],wood,144);bowl.location.x=-1.37
    ring('Bowl outer bronze inlay',-1.37,0,1.43,.971,.007,bronze,144)
    for n in range(1,37):
        x,y=-.05+(n-1)%6*.40,.525-(n-1)//6*.15
        cube('Roulette number colour '+str(n),(x,y,1.203),(.388,.138,.004),red if n in REDS else black,0)
        text(str(n),(x,y,1.207),.091,ivory,flat=True)
    for col in range(7):cube('Roulette six-column grid',(-.25+col*.40,.15,1.207),(.009,.90,.005),ivory,0)
    for row in range(7):cube('Roulette six-row grid',(.95,-.30+row*.15,1.207),(2.40,.008,.005),ivory,0)
    for x in [-.25,2.15]:cube('Roulette zero side',(x,.74,1.207),(.009,.28,.005),ivory,0)
    cube('Roulette zero top',(.95,.88,1.207),(2.40,.008,.005),ivory,0)
    text('0',(.95,.74,1.207),.11,ivory,flat=True)
    for i in range(4):cube('Roulette dozen divider',(-.25+i*.80,-.375,1.207),(.009,.15,.005),ivory,0)
    for y in [-.45,-.60]:cube('Roulette outside border',(.95,y,1.207),(2.4,.008,.005),ivory,0)
    for i,label in enumerate(['1ST 12','2ND 12','3RD 12']):text(label,(.15+i*.80,-.375,1.207),.061,ivory,flat=True)
    for i,label in enumerate(['1-18','EVEN','RED','BLACK','ODD','19-36']):
        x=-.05+i*.40
        cube('Roulette outside divider',(-.25+i*.40,-.525,1.207),(.009,.15,.005),ivory,0)
        if label in {'RED','BLACK'}:cube('Roulette outside colour',(x,-.525,1.203),(.388,.138,.004),red if label=='RED' else black,0)
        text(label,(x,-.525,1.207),.054,ivory,flat=True)
    cube('Roulette outside end',(2.15,-.525,1.207),(.009,.15,.005),ivory,0)
    for y in [.44,.17,-.10]:
        rim('Roulette column return box',rounded(.16,.13,.003,x=2.29,y=y),1.207,.003,ivory,sides=4)
        text('2:1',(2.29,y,1.207),.049,ivory,flat=True)
    text('THE MERIDIAN / SINGLE ZERO',(.65,-.85,1.204),.088,ivory,flat=True)
    marker('roulette-wheel-anchor',(-1.37,0,1.32));marker('roulette-chip-height',(0,0,1.225))
    finish('roulette-table')


def blackjack_outline(scale=1):
    return [(2.35*scale,.42*scale),(-2.35*scale,.42*scale)]+[(math.cos(math.pi+i/64*math.pi)*2.35*scale,(.25+math.sin(math.pi+i/64*math.pi)*1.48)*scale) for i in range(65)]


def blackjack():
    start()
    for x in [-1.2,1.2]:
        prism('Blackjack curved walnut pedestal',rounded(.42,.72,.18,x=x),.10,.985,wood,.026)
        prism('Blackjack bronze shoe',rounded(.50,.80,.20,x=x),0,.12,bronze,.012)
    cube('Blackjack under-table stretcher',(0,.02,.46),(2.4,.13,.17),wood,.04)
    prism('Blackjack deep walnut fascia',blackjack_outline(),.96,1.075,wood,.015)
    prism('Blackjack shaped leather rail',blackjack_outline(),1.065,1.139,leather,.025)
    prism('Blackjack D-shaped felt',blackjack_outline(.92),1.12,1.15,felt,.006)
    rim('Blackjack bronze fascia reveal',blackjack_outline(),1.00,.013,bronze)
    rim('Blackjack stitched leather seam',blackjack_outline(.969),1.141,.0035,ivory,sides=5)
    text('BLACKJACK PAYS 3:2',(0,-.25,1.155),.123,ivory,flat=True)
    text('DEALER STANDS ON ALL 17',(0,.08,1.155),.077,ivory,flat=True)
    cube('Blackjack recessed dealer chip tray',(0,.305,1.158),(1.02,.205,.04),black,.024)
    for i in range(14):
        x=-.42+i*.065
        loft('Blackjack dealer chip stack',[(x,.30,1.176,.025,.025),(x,.30,1.212,.025,.025)],red if i%3 else ivory,12)
    for sx,sy in [(-1.8,-.6),(-1.15,-1.5),(0,-1.9),(1.15,-1.5),(1.8,-.6)]:
        px,py=sx*.66,sy*.62
        tube('Blackjack betting oval',[(px+math.cos(i/32*TAU)*.17,py+math.sin(i/32*TAU)*.12,1.155) for i in range(33)],.004,ivory,sides=6)
    marker('blackjack-card-height',(0,0,1.17));finish('blackjack-table')


def slot():
    start()
    profile=[(-.59,-.40),(.59,-.40),(.65,-.30),(.65,.31),(.57,.43),(-.57,.43),(-.65,.31),(-.65,-.30)]
    prism('Slot shaped walnut cabinet',profile,.12,2.12,wood,.055)
    prism('Slot cast bronze plinth',rounded(1.3,.90,.13),0,.16,bronze,.018)
    cube('Slot evergreen face',(0,-.458,1.60),(1.20,.10,1),leather,.08)
    # Display opening x +/- .525, height 1.265..1.715, at y=-.55.
    for x in [-.565,.565]:cube('Slot display vertical reveal',(x,-.540,1.49),(.070,.048,.59),bronze,.018)
    for z in [1.225,1.755]:cube('Slot display horizontal reveal',(0,-.540,z),(1.20,.048,.07),bronze,.018)
    cube('Slot blank live display backing',(0,-.528,1.49),(1.05,.018,.45),black,.015)
    prism('Slot curved control shelf',rounded(1.30,.49,.15,y=-.45),.99,1.105,leather,.018)
    cube('Slot glowing spin key',(.36,-.63,1.124),(.21,.16,.035),light,.027)
    cube('Slot bronze control legend',(-.20,-.62,1.113),(.42,.13,.008),bronze,.012)
    text('MERIDIAN',(0,-.518,1.95),.122,ivory)
    text('FICTIONAL CREDITS',(0,-.47,.77),.075,ivory)
    for side in [-1,1]:
        cube('Slot side bronze flute',(side*.603,-.473,1.47),(.022,.030,1.30),bronze,.007)
        cube('Slot warm vertical accent',(side*.535,-.527,1.985),(.018,.028,.18),light,.006)
    prism('Slot stepped lower crown',rounded(1.30,.91,.16),2.085,2.20,leather,.019)
    prism('Slot stepped bronze crown',rounded(1.23,.85,.15),2.20,2.25,bronze,.012)
    prism('Slot sculpted crown',rounded(1.16,.79,.14),2.25,2.35,leather,.025)
    marker('slot-live-display-anchor',(0,-.55,1.49));marker('slot-player-seat-anchor',(0,-1.25,0))
    finish('slot-machine')


def chair():
    start()
    lathe('Chair turned weighted pedestal',[(0,0),(.29,0),(.32,.065),(.32,.085),(.28,.12),(.105,.15),(.075,.20),(.075,.42),(.16,.435),(0,.435)],bronze,48)
    prism('Chair upholstered curved seat',rounded(.66,.64,.20,10),.4275,.5425,leather,.026)
    rim('Chair seat upholstery welt',rounded(.64,.62,.19,10),.525,.0035,ivory,sides=5)
    verts=[]
    for h,r,cy in [(.51,.35,.03),(.95,.36,-.02),(1.015,.36,-.02)]:
        for i in range(33):
            a=math.radians(208+i*124/32);verts.append((r*math.cos(a),cy+r*math.sin(a),h))
    faces=[(j*33+i,j*33+i+1,(j+1)*33+i+1,(j+1)*33+i) for j in range(2) for i in range(32)]
    obj=mesh('Chair curved upholstered back',verts,faces,leather)
    solid=obj.modifiers.new('Upholstery depth','SOLIDIFY');solid.thickness=.085
    select([obj]);bpy.ops.object.modifier_apply(modifier=solid.name);bevel(obj,.028,3)
    for h in [.56,.975]:
        points=[]
        for i in range(33):
            a=math.radians(210+i*120/32);points.append((.365*math.cos(a),-.02+.365*math.sin(a),h))
        tube('Chair back upholstery welt',points,.004,ivory,sides=5)
    for x in [-.235,.235]:tube('Chair swept bronze back support',[(x,-.13,.35),(x,-.27,.50),(x,-.34,.80)],.021,bronze,sides=8)
    marker('chair-seat-contact',(0,0,.5425));finish('casino-chair')


def wheel():
    start()
    # The actual cups, retaining walls and outer number deck share a stable origin.
    # Pockets are 41 mm below the divider crowns, rather than painted flat wedges.
    lathe('Rotor walnut body',[(0,-.03),(.79,-.03),(.79,.035),(.67,.035),(.67,-.002),(.505,-.002),(.505,.04),(.18,.06),(.07,.09),(0,.09)],wood,144)
    lathe('Inner pocket retaining gallery',[(.501,.002),(.525,.002),(.525,.042),(.522,.045),(.505,.045),(.501,.040),(.501,.002)],bronze,144)
    lathe('Outer pocket retaining gallery',[(.645,.002),(.67,.002),(.67,.036),(.665,.045),(.648,.045),(.645,.042),(.645,.002)],bronze,144)
    lathe('Outer numbered deck bronze rim',[(.78,.030),(.79,.030),(.79,.038),(.78,.038),(.78,.030)],bronze,144)

    def sector_outline(inner,outer,a,b):
        angles=[a+(b-a)*j/4 for j in range(5)]
        return [(outer*math.cos(t),outer*math.sin(t)) for t in angles]+[(inner*math.cos(t),inner*math.sin(t)) for t in reversed(angles)]

    for i,n in enumerate(ORDER):
        a,b=i/37*TAU,(i+1)/37*TAU
        colour=felt if n==0 else red if n in REDS else black
        prism('Recessed roulette pocket floor '+str(n),sector_outline(.525,.645,a,b),-.005,.004,colour)
        prism('Separate roulette number deck '+str(n),sector_outline(.67,.78,a,b),.032,.038,colour)
        divider=cube('Solid roulette pocket divider '+str(i),(.585*math.cos(a),.585*math.sin(a),.0245),(.13,.008,.041),bronze,.0012)
        divider.rotation_euler.z=a
        t=(a+b)/2
        text(str(n),(.725*math.cos(t),.725*math.sin(t),.0388),.072,ivory,flat=True,heading=t-math.pi/2)
    ring('Rotor hub bronze inlay',0,0,.065,.175,.006,bronze,96)
    lathe('Rotor spindle',[(0,.19),(.034,.19),(.049,.16),(.049,.075),(.075,.058)],bronze,48)
    for a in [0,math.pi/2]:tube('Rotor spindle cross',[(math.cos(a)*-.165,math.sin(a)*-.165,.167),(math.cos(a)*.165,math.sin(a)*.165,.167)],.014,bronze,sides=10)
    marker('roulette-rotor-origin',(0,0,0))
    marker('ball-pocket-0',(.585*math.cos(math.pi/37),.585*math.sin(math.pi/37),.034))
    marker('ball-track',(.88,0,.10))
    finish('roulette-wheel')


if __name__=='__main__':
    builders={'meridian-shell':shell,'meridian-roof':roof,'meridian-ceiling':ceiling,'meridian-chandelier':chandelier,'meridian-interior':interior,'roulette-table':roulette,'blackjack-table':blackjack,'slot-machine':slot,'casino-chair':chair,'roulette-wheel':wheel}
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for name in args or list(builders):
        if name not in builders:raise ValueError('Unknown casino asset '+name)
        builders[name]()
    stats_path=SOURCE/'meridian-assets.stats.json'
    previous=json.loads(stats_path.read_text()) if stats_path.exists() else {}
    previous.update(STATS);stats_path.write_text(json.dumps(previous,indent=2)+'\n')
