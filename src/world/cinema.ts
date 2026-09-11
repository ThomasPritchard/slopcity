import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Light } from '@babylonjs/core/Lights/light';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CINEMA_LAYOUT } from '../../shared/cinemaLayout';
import { communitySlide, type Programme } from '../../shared/community';

/** Approved reel and fallback artwork beneath the world-aligned official player. */
export class CinemaDisplay {
  readonly root: TransformNode;
  private screen: DynamicTexture;
  private notice: DynamicTexture;
  private programme: Programme | null = null;
  private offset = 0;
  private key = '';
  private disposed = false;
  private lights: PointLight[] = [];
  private emissive = new Map<PBRMaterial,Color3>();
  private pictures = new Map<string, HTMLImageElement>();
  constructor(scene: Scene) {
    this.root = new TransformNode('cinema-display', scene);
    const make = (name: string, width: number, height: number, x: number, y: number, z: number, resolution: number) => {
      const texture = new DynamicTexture(name, { width: resolution, height: resolution * height / width }, scene, false);
      const mat = new StandardMaterial(`${name}-material`, scene);
      mat.diffuseTexture = texture; mat.emissiveColor.set(.7,.7,.7); mat.specularColor = Color3.Black();
      const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
      mesh.parent = this.root; mesh.position.set(x,y,z); mesh.rotation.y = -Math.PI / 2; mesh.material = mat;
      return texture;
    };
    const s = CINEMA_LAYOUT.screen, n = CINEMA_LAYOUT.notice;
    this.screen = make('cinema-screen',s.width,s.height,s.x,s.y,s.z,1920);
    this.notice = make('cinema-programme-board',1.58,1.75,n.x+.205,1.38,n.z,632);
    for (const z of [-6,2]) {
      const light = new PointLight(`cinema-warm-${z}`,new Vector3(-19.5,2.9,z),scene);
      light.diffuse = Color3.FromHexString('#ffd29b'); light.specular = Color3.Black(); light.range = 9;
      light.falloffType=Light.FALLOFF_STANDARD;light.shadowEnabled=false;
      this.lights.push(light);
    }
    this.paint();
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }
  bindLighting(venue: TransformNode, benches: TransformNode[], glow: GlowLayer) {
    const meshes=[...venue.getChildMeshes(),...benches.flatMap(bench=>bench.getChildMeshes())];
    for(const light of this.lights)light.includedOnlyMeshes=meshes;
    for(const mesh of meshes) {
      if(mesh.material instanceof PBRMaterial)mesh.material.maxSimultaneousLights=10;
      if(mesh instanceof Mesh && mesh.material instanceof PBRMaterial && /Cinema warm (string bulb|bench edge) glow/.test(mesh.material.name)) {
        glow.addIncludedOnlyMesh(mesh);this.emissive.set(mesh.material,mesh.material.emissiveColor.clone());
      }
    }
  }
  sync(programme: Programme | null) {
    this.programme = programme;
    if (programme) this.offset = programme.serverNowMs - Date.now();
    // Evict revoked media even if it was cached while approved.
    const urls = new Set(programme?.images.map(image => image.imageUrl) ?? []);
    for (const [url,picture] of this.pictures) if (!urls.has(url)) { picture.onload=null; this.pictures.delete(url); }
    this.key=''; this.update();
  }
  update(lamps = 0) {
    for (const light of this.lights) light.intensity = .08 + lamps * .6;
    for(const [material,colour] of this.emissive)colour.scaleToRef(.22+lamps*.78,material.emissiveColor);
    if (this.disposed) return;
    const p=this.programme, slide=p ? communitySlide(p,Date.now()+this.offset) : null;
    const key = !p ? 'unavailable' : `${p.revision}:${p.mode}:${slide?.kind==='image'?slide.image.id:'schedule'}`;
    if (key!==this.key) { this.key=key; this.paint(); }
  }
  private paint() {
    if(this.disposed)return;
    const ctx=this.screen.getContext() as CanvasRenderingContext2D, p=this.programme;
    ctx.fillStyle='#122b24';ctx.fillRect(0,0,1920,1080);
    ctx.strokeStyle='#b9a578';ctx.lineWidth=2;ctx.strokeRect(40,40,1840,1000);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#c8b88a';ctx.font='24px sans-serif';ctx.fillText('THE BRIDGE PICTURE HOUSE',960,96);
    const slide=p?communitySlide(p,Date.now()+this.offset):null;
    if(p?.mode==='live') {
      ctx.fillStyle='#df987d';ctx.font='27px sans-serif';ctx.fillText('ON AIR',960,312);
      ctx.fillStyle='#f3ead4';ctx.font='104px Georgia';ctx.fillText('BridgeMind',960,470);
      ctx.font='42px Georgia';ctx.fillText('The stream that brings us together.',960,586);
      ctx.fillStyle='#c8b88a';ctx.font='28px sans-serif';ctx.fillText('FIND A CLEAR VIEW · SOUND FOLLOWS YOUR DISTANCE',960,789);
    } else if(slide?.kind==='image') {
      const info=slide.image;
      let pic=this.pictures.get(info.imageUrl);
      if(!pic) {
        if(this.pictures.size>=12) { const oldest=this.pictures.keys().next().value; if(oldest)this.pictures.delete(oldest); }
        pic=new Image();this.pictures.set(info.imageUrl,pic);
        const requested=this.key;pic.onload=()=>{if(!this.disposed&&requested===this.key)this.paint();};pic.src=info.imageUrl;
      }
      if(pic.complete&&pic.naturalWidth) {
        const scale=Math.min(1700/pic.naturalWidth,740/pic.naturalHeight), w=pic.naturalWidth*scale,h=pic.naturalHeight*scale;
        ctx.drawImage(pic,(1920-w)/2,170+(740-h)/2,w,h);
      } else {ctx.fillStyle='#e8dec4';ctx.font='40px Georgia';ctx.fillText('A memory from the square',960,530);}
      ctx.fillStyle='#eee5cf';ctx.font='31px Georgia';ctx.fillText(info.title,960,953,1680);
      ctx.fillStyle='#b7bfaa';ctx.font='21px sans-serif';ctx.fillText(info.credit?`SHARED BY ${info.credit}`:'SLOP CITY MEMORIES',960,1002,1680);
    } else {
      ctx.fillStyle='#eee5cf';ctx.font='86px Georgia';ctx.fillText('Coming up',960,294);
      const upcoming=p?.schedule.filter(entry=>Date.parse(entry.startsAt)>Date.now()+this.offset).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)).slice(0,3) ?? [];
      if(upcoming.length)upcoming.forEach((entry,i)=>{
        ctx.fillStyle='#c8b88a';ctx.font='27px sans-serif';
        ctx.fillText(new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London',timeZoneName:'short'}).format(new Date(entry.startsAt)),960,456+i*152);
        ctx.fillStyle='#eee5cf';ctx.font='42px Georgia';ctx.fillText(entry.title,960,513+i*152,1600);
      });
      else {ctx.fillStyle='#c8bfa5';ctx.font='40px Georgia';ctx.fillText(p?'Next stream to be announced.':'The programme is being refreshed.',960,535);}
      ctx.fillStyle='#b7bfaa';ctx.font='27px sans-serif';ctx.fillText('GOOD COMPANY. SHARED STORIES.',960,928);
    }
    this.screen.update();
    const n=this.notice.getContext() as CanvasRenderingContext2D;
    n.fillStyle='#e7dfc8';n.fillRect(0,0,632,700);n.strokeStyle='#95845d';n.lineWidth=2;n.strokeRect(20,20,592,660);
    n.textAlign='center';n.textBaseline='middle';n.fillStyle='#243b30';n.font='22px sans-serif';n.fillText('THE BRIDGE',316,84);
    n.font='54px Georgia';n.fillText('Make yourself',316,170);n.fillText('at home.',316,230);
    n.font='25px sans-serif';n.fillText(p?.mode==='live'?'BRIDGEMIND · ON AIR':'MEMES & MEMORIES',316,350);
    n.fillText('Watch together',316,438);n.fillText('See what’s coming up',316,492);n.fillText('Submit a meme',316,546);
    n.font='italic 23px Georgia';n.fillText('For the streams that brought',316,612);n.fillText('us together.',316,641);
    this.notice.update();
  }
  dispose() { if(this.disposed)return;this.disposed=true;for(const pic of this.pictures.values())pic.onload=null;this.pictures.clear();for(const light of this.lights)light.dispose();this.root.dispose(false,true);this.screen.dispose();this.notice.dispose(); }
}
