import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { FIRST_MEMORY, MEMORIES_BOARD } from '../../shared/memories';

export function createMemoriesBoard(scene: Scene) {
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
 const texture = new DynamicTexture('Town memories first post', { width: 1536, height: 1152 }, scene, false);
 const material = new StandardMaterial('Town memories display', scene); material.diffuseTexture = texture; material.emissiveColor.set(.25,.25,.25); material.specularColor = Color3.Black();
 const face = MeshBuilder.CreatePlane('Town memories first memory', { width: 2.92, height: 2.19 }, scene); face.parent = root; face.position.set(0,1.93,-.156); face.material = material;
 const ctx = texture.getContext() as CanvasRenderingContext2D;
 const draw = (photo?: HTMLImageElement) => {
  ctx.fillStyle = '#243c30'; ctx.fillRect(0,0,1536,1152);
  ctx.strokeStyle = '#bba775'; ctx.lineWidth = 3; ctx.strokeRect(24,24,1488,1104);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#eae5cb'; ctx.font = '70px Georgia'; ctx.fillText('Slop City memories',768,106);
  ctx.fillStyle = '#b9c7a8'; ctx.font = '22px sans-serif'; ctx.fillText('SMALL TOWN. GOOD STORIES.',768,170);
  ctx.fillStyle = '#e9e2cb'; ctx.fillRect(96,228,620,813);
  if (photo) ctx.drawImage(photo,116,248,580,725);
  ctx.fillStyle = '#3a4a34'; ctx.font = '20px sans-serif'; ctx.fillText('MEMORY 001  /  OUR FIRST MEME',406,1006);
  ctx.textAlign = 'left'; ctx.fillStyle = '#d0bd85'; ctx.font = '22px sans-serif'; ctx.fillText('OPENING DAY · v0.1',785,315);
  ctx.fillStyle = '#eee8d0'; ctx.font = '59px Georgia'; ctx.fillText('Already making',785,405); ctx.fillText('memories.',785,475);
  ctx.fillStyle = '#c5d0b8'; ctx.font = '29px sans-serif';
  ['The gates are open.', 'The neighbours are here.', 'The first meme has arrived.'].forEach((line,i) => ctx.fillText(line,785,590+i*50));
  ctx.fillStyle = '#e3e7c1'; ctx.font = 'italic 39px Georgia'; ['Make a memory.', 'Share a laugh.'].forEach((line,i) => ctx.fillText(line,785,825+i*50));
  ctx.textAlign = 'center'; ctx.fillStyle = '#b9c7a8'; ctx.font = '20px sans-serif'; ctx.fillText('COME CLOSER TO READ THE STORY',768,1090);
  texture.update();
 };
 draw();
 const photo = new Image(); photo.onload = () => draw(photo); photo.src = FIRST_MEMORY.image;
 scene.onDisposeObservable.addOnce(() => { photo.onload = null; });
 return root;
}
