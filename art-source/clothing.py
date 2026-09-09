"""Modular garments sharing the existing citizen skeleton; no changes to the face."""
import math
from build_assets import material, loft, cube, tube, ellipsoid, mesh

def add_clothing(bind):
    def mat(part, name, colour, rough=.8, metallic=0):
        return material('wear_'+part+'__'+name,colour,rough,metallic)
    for part,colour in [('knit',(.56,.49,.34)),('bomber',(.39,.13,.07))]:
        cloth=mat(part,'Cloth_Main',colour);rib=mat(part,'Cloth_Rib',colour,.95)
        trim=mat(part,'Fastening',(.24,.21,.16),.4,.65)
        body=[(0,0,.915,.16,.116),(0,0,.99,.177,.119),(0,0,1.13,.173,.117),(0,0,1.32,.192,.12),(0,0,1.43,.218,.108),(0,0,1.48,.184,.079),(0,0,1.516,.063,.055)]
        bind(loft(part+' body',body,cloth,48),'spine')
        bind(loft(part+' ribbed waistband',[(0,0,.91,.159,.117),(0,0,.96,.163,.12)],rib,48),'spine')
        bind(loft(part+' collar',[(0,0,1.505,.071,.064),(0,0,1.529,.065,.060)],rib,48),'spine')
        for side in [-1,1]:
            suffix='L' if side>0 else 'R'
            bind(loft(part+' sleeve',[(side*.18,0,1.475,.028,.035),(side*.203,0,1.46,.052,.061),(side*.224,0,1.428,.066,.074),(side*.236,0,1.38,.078,.078),(side*.261,0,1.27,.07,.07),(side*.276,0,1.16,.061,.061),(side*.284,-.006,1.07,.058,.056),(side*.291,-.015,.98,.049,.046)],cloth,28),('arm',suffix))
            bind(loft(part+' cuff',[(side*.292,-.015,.944,.045,.043),(side*.291,-.014,.995,.049,.047)],rib,28),'forearm.'+suffix)
            if part=='bomber':
                bind(tube('Slanted welt',[(side*.09,-.121,1.05),(side*.143,-.12,1.16)],.006,rib,sides=8),'spine')
            else:
                # Raised raglan seam; repeated rib stitches around the hem are real geometry.
                bind(tube('Raglan seam',[(side*.06,-.057,1.51),(side*.17,-.081,1.43),(side*.21,-.071,1.37)],.0028,rib,sides=6),'spine')
        for i in range(48):
            a=i/48*math.tau
            bind(tube('Hem rib',[(math.cos(a)*.164,math.sin(a)*.122,.916),(math.cos(a)*.166,math.sin(a)*.123,.956)],.0017,rib,sides=5),'spine')
        if part=='bomber':
            bind(cube('Zip tape',(0,-.126,1.22),(.015,.007,.51),rib,.002),'spine')
            for i in range(36):bind(cube('Zip tooth',((i%2-.5)*.005,-.132,.966+i*.014),(.005,.004,.004),trim,.001),'spine')
            bind(cube('Zip pull',(0,-.14,1.45),(.013,.005,.032),trim,.003),'spine')
    for part,colour in [('jeans',(.08,.14,.22)),('cargo',(.16,.21,.12))]:
        fabric=mat(part,'Trousers',colour,.94);stitch=mat(part,'Stitch',(.38,.3,.17),.9)
        for side in [-1,1]:
            suffix='L' if side>0 else 'R';wide=1.1 if part=='cargo' else 1
            rows=[(side*.098,0,.935,.099,.108),(side*.102,0,.84,.1,.109),(side*.102,.002,.7,.085*wide,.093),(side*.105,.003,.53,.067*wide,.075),(side*.104,0,.45,.067*wide,.071),(side*.1,0,.29,.058*wide,.064),(side*.1,0,.12,.053*wide,.059)]
            bind(loft(part+' leg',rows,fabric,32),('leg',suffix))
            bind(tube(part+' side seam',[(side*.201,0,.88),(side*(.102+.085*wide),.001,.7),(side*(.105+.067*wide),0,.5),(side*(.1+.054*wide),0,.16)],.002,stitch,sides=6),('leg',suffix))
            if part=='cargo':
                bind(cube('Cargo pocket',(side*.192,-.002,.72),(.05,.136,.175),fabric,.012),('leg',suffix))
                bind(cube('Cargo flap',(side*.221,-.002,.793),(.009,.145,.035),fabric,.004),('leg',suffix))
                bind(tube('Pocket pleat',[(side*.221,-.003,.77),(side*.221,-.003,.654)],.003,stitch,sides=6),('leg',suffix))
            else:
                bind(cube('Denim back pocket',(side*.102,.107,.84),(.093,.007,.106),fabric,.009),'thigh.'+suffix)
                bind(tube('Pocket stitch',[(side*.057,.114,.88),(side*.057,.114,.80),(side*.144,.114,.80),(side*.144,.114,.88)],.002,stitch,sides=6),'thigh.'+suffix)
    for part,colour in [('boots',(.17,.065,.055)),('loafers',(.28,.14,.07))]:
        leather=mat(part,'Shoe_Leather',colour,.55);sole=mat(part,'Shoe_Rubber',(.07,.065,.055),.88)
        stitch=mat(part,'Shoe_Stitch',(.43,.33,.19),.8);skin=mat(part,'Skin',(.62,.39,.25),.65)
        for side in [-1,1]:
            cx=side*.1;bone='foot.'+('L' if side>0 else 'R')
            bind(loft(part+' sole',[(cx,-.048,.012,.062,.154),(cx,-.048,.025,.07,.158),(cx,-.048,.038,.068,.157)],sole,48),bone)
            bind(cube(part+' heel',(cx,.046,.021),(.11,.105,.035),sole,.015),bone)
            bind(loft(part+' upper',[(cx,-.049,.035,.065,.152),(cx,-.048,.065,.065,.151),(cx,-.038,.106,.059,.133),(cx,-.02,.127,.048,.102)],leather,48),bone)
            bind(tube('Welt stitch',[(cx+math.cos(i/64*math.tau)*.068,-.048+math.sin(i/64*math.tau)*.155,.04) for i in range(65)],.0018,stitch,sides=6),bone)
            if part=='boots':
                # The shaft encloses the trouser hem; the instep rises into it continuously.
                shaft=[(cx,-.015,.10,.064,.112),(cx,.003,.15,.067,.105),(cx,.013,.21,.068,.092),(cx,.013,.27,.068,.092)]
                bind(loft('Boot ankle',shaft,leather,40),bone)
                bind(loft('Boot rim',[(cx,.013,.26,.069,.093),(cx,.013,.278,.069,.093)],sole,40),bone)
                for i in range(6):
                    for sign in [-1,1]:
                        path=[]
                        for sample in range(9):
                            t=sample/8;x=sign*.023*(1-2*t);z=.143+i*.017+t*.009
                            lower,upper=next((a,b) for a,b in zip(shaft,shaft[1:]) if a[2]<=z<=b[2])
                            blend=(z-lower[2])/(upper[2]-lower[2])
                            cy,rx,ry=[lower[j]+(upper[j]-lower[j])*blend for j in [1,3,4]]
                            # Follow the curved leather surface rather than cutting through it.
                            y=cy-ry*math.sqrt(1-(x/rx)**2)-.004
                            path.append((cx+x,y,z))
                        bind(tube('Boot lace',path,.0025,stitch,sides=6),bone)
            else:
                bind(loft('Loafer ankle',[(cx,0,.095,.039,.039),(cx,0,.17,.039,.039)],skin,24),bone)
                bind(cube('Penny strap',(cx,-.06,.129),(.107,.043,.012),leather,.008),bone)
                bind(cube('Penny slot',(cx,-.065,.137),(.029,.007,.002),sole,.002),bone)
                bind(tube('Apron stitching',[(cx+math.cos(i/24*math.pi)*.046,-.085-math.sin(i/24*math.pi)*.075,.108) for i in range(25)],.002,stitch,sides=6),bone)
