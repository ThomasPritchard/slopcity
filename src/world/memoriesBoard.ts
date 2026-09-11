import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { FIRST_MEMORY, MEMORIES_BOARD } from '../../shared/memories';
import { communityImages, type CommunityImage } from '../../shared/community';

export interface MemoriesBoard { root: TransformNode; sync(images: CommunityImage[]): void; dispose(): void }

export function createMemoriesBoard(scene: Scene): MemoriesBoard {
 const board = MEMORIES_BOARD, root = new TransformNode('town-memories-board', scene);
 root.position.set(board.x, 0, board.z);
 const wood = new StandardMaterial('Memories board walnut', scene); wood.diffuseColor = Color3.FromHexString('#534335'); wood.specularColor.set(.08,.08,.08);
 const brass = new StandardMaterial('Memories board brass', scene); brass.diffuseColor = Color3.FromHexString('#b4a16c'); brass.specularColor.set(.2,.18,.1);
 const box = (name: string, x: number, y: number, width: number, height: number, depth: number, material = wood) => {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene); mesh.parent = root; mesh.position.set(x,y,0); mesh.material = material; mesh.receiveShadows = true; return mesh;
 };
 box('Memories board case',0,1.93,board.width,2.36,.26);
 for (const x of [-1.25,1.25]) { box('Memories board post',x,1.54,.12,3.08,.3); box('Memories board foot',x,.06,.27,.12,.3,brass); }
 box('Memories board cap',0,3.1,board.width,.1,.3,brass);
 const texture = new DynamicTexture('Town community Polaroids', { width:1536, height:1152 }, scene, false);
 const material = new StandardMaterial('Town memories display', scene); material.diffuseTexture = texture; material.emissiveColor.set(.25,.25,.25); material.specularColor = Color3.Black();
 const face = MeshBuilder.CreatePlane('Town memories Polaroid board', { width:2.92, height:2.19 }, scene); face.parent = root; face.position.set(0,1.93,-.156); face.material = material;
 const ctx = texture.getContext() as CanvasRenderingContext2D;
 let photos:CommunityImage[] = [], signature = '', disposed = false;
 const loaded = new Map<string,HTMLImageElement>();
 function textFit(text:string, x:number, y:number, width:number) {
  let value=text; while (value.length>1 && ctx.measureText(value).width>width) value=value.slice(0,-1);
  ctx.fillText(value===text?value:`${value.slice(0,-1)}…`,x,y);
 }
 function polaroid(photo:CommunityImage,x:number,y:number,width:number,height:number,angle:number) {
  ctx.save(); ctx.translate(x,y); ctx.rotate(angle*Math.PI/180);
  ctx.shadowColor='#0a17178a'; ctx.shadowBlur=15; ctx.shadowOffsetX=4; ctx.shadowOffsetY=9;
  ctx.fillStyle='#f1ead7'; ctx.fillRect(-width/2,-height/2,width,height); ctx.shadowColor='transparent';
  const inset=18, imageX=-width/2+inset, imageY=-height/2+inset, imageW=width-inset*2, imageH=height-110;
  ctx.fillStyle='#dcd7c7'; ctx.fillRect(imageX,imageY,imageW,imageH);
  const image=loaded.get(photo.imageUrl);
  if(image?.complete && image.naturalWidth) { const scale=Math.min(imageW/image.naturalWidth,imageH/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,imageX+(imageW-w)/2,imageY+(imageH-h)/2,w,h); }
  ctx.textAlign='left';ctx.fillStyle='#293f30';ctx.font=`${width>500?36:28}px Georgia`;textFit(photo.title,-width/2+22,height/2-54,width-44);
  ctx.fillStyle='#5d6245';ctx.font=`${width>500?21:17}px sans-serif`;textFit(photo.credit?`By ${photo.credit}`:photo.id==='first-memory'?'OUR FIRST PLAYER-MADE MEME':'FROM THE NEIGHBOURHOOD',-width/2+22,height/2-23,width-44);
  ctx.save();ctx.translate(0,-height/2);ctx.rotate(.06);ctx.fillStyle='#dfce9ebe';ctx.fillRect(-63,-15,126,36);ctx.restore();
  ctx.restore();
 }
 function draw() {
  if(disposed)return;
  ctx.fillStyle='#253d30';ctx.fillRect(0,0,1536,1152);
  // Quiet grain in the backing keeps the board tactile without competing with photos.
  ctx.fillStyle='#c3ba9520';for(let y=28;y<1125;y+=22)for(let x=28;x<1510;x+=24)ctx.fillRect(x+(y%7),y,2,2);
  ctx.strokeStyle='#bba775';ctx.lineWidth=3;ctx.strokeRect(24,24,1488,1104);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#eee8d1';ctx.font='70px Georgia';ctx.fillText('Slop City memories',768,104);
  ctx.fillStyle='#c7d1b3';ctx.font='22px sans-serif';ctx.fillText('SMALL TOWN. GOOD STORIES.',768,166);
  if(photos.length===1) {
   polaroid(photos[0],416,641,564,784,-2);
   ctx.textAlign='left';ctx.fillStyle='#d1bf88';ctx.font='22px sans-serif';ctx.fillText('THE FIRST OF MANY',800,316);
   ctx.fillStyle='#f0e8d0';ctx.font='59px Georgia';ctx.fillText('Already making',800,408);ctx.fillText('memories.',800,478);
   ctx.fillStyle='#cbd4bc';ctx.font='28px sans-serif';['The gates are open.','The neighbours are here.','The first meme has arrived.'].forEach((line,index)=>ctx.fillText(line,800,598+index*49));
   ctx.fillStyle='#e7e9c4';ctx.font='italic 39px Georgia';ctx.fillText('Make a memory.',800,835);ctx.fillText('Share a laugh.',800,885);
  } else photos.slice(0,6).forEach((photo,index)=>polaroid(photo,292+(index%3)*476,438+Math.floor(index/3)*407,390,361,[-2,1.5,-.8,2.2,-1.5,1][index]));
  ctx.textAlign='center';ctx.fillStyle='#cbd3b7';ctx.font='21px sans-serif';ctx.fillText(`EXAMINE THE BOARD · ${photos.length} ${photos.length===1?'MEMORY':'MEMORIES'} · OPEN ANY PHOTO IN FULL`,768,1090);
  texture.update();
 }
 function sync(images:CommunityImage[]) {
  if(disposed)return;
  const next=communityImages(images), nextSignature=JSON.stringify(next);
  if(signature===nextSignature)return;signature=nextSignature;photos=next;
  const urls=new Set(photos.slice(0,6).map(photo=>photo.imageUrl));
  for(const [url,image] of loaded)if(!urls.has(url)){image.onload=null;image.onerror=null;loaded.delete(url);}
  for(const url of urls)if(!loaded.has(url)){const image=new Image();loaded.set(url,image);image.onload=draw;image.onerror=draw;image.src=url;}
  draw();
 }
 function dispose() { if(disposed)return;disposed=true;for(const image of loaded.values()){image.onload=null;image.onerror=null;}loaded.clear();root.dispose();texture.dispose();material.dispose();wood.dispose();brass.dispose(); }
 sync([]);scene.onDisposeObservable.addOnce(dispose);
 return {root,sync,dispose};
}
