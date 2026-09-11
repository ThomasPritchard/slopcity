import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CINEMA_LAYOUT } from '../../shared/cinemaLayout';
import { BRIDGEMIND_TWITCH_CHANNEL, type Programme } from '../../shared/community';
import { TwitchCinemaPlayer, cinemaProximityVolume } from './twitchPlayer';

export interface CinemaPoint { x: number; y: number }
export type CinemaPlayerReason = 'disabled' | 'hidden' | 'offline' | 'invalid-source' | 'behind' | 'clipped' | 'settling' | 'mounted' | 'disposed';
export interface CinemaPlayerStatus {
 mounted: boolean; reason: CinemaPlayerReason; source: string | null;
 projectedWidth: number; projectedHeight: number; blockedBy: string | null;
 corners: readonly CinemaPoint[];
}
const WIDTH=960, HEIGHT=540, MOUNT_DELAY_MS=300, SCREEN=CINEMA_LAYOUT.screen;
const IDENTITY=Matrix.Identity();

/** Maps the complete provider rectangle onto a clockwise TL/TR/BR/BL quadrilateral. */
export function cinemaHomography([tl,tr,br,bl]:readonly CinemaPoint[],width=WIDTH,height=HEIGHT):number[] {
 const dx1=tr.x-br.x,dx2=bl.x-br.x,dx3=tl.x-tr.x+br.x-bl.x,dy1=tr.y-br.y,dy2=bl.y-br.y,dy3=tl.y-tr.y+br.y-bl.y,det=dx1*dy2-dx2*dy1;
 const g=Math.abs(det)<1e-8?0:(dx3*dy2-dx2*dy3)/det,h=Math.abs(det)<1e-8?0:(dx1*dy3-dx3*dy1)/det;
 return [(tr.x-tl.x+g*tr.x)/width,(tr.y-tl.y+g*tr.y)/width,0,g/width,(bl.x-tl.x+h*bl.x)/height,(bl.y-tl.y+h*bl.y)/height,0,h/height,0,0,1,0,tl.x,tl.y,0,1];
}

/** Conservative convex-polygon overlap, including edge contact. */
export function cinemaPolygonsOverlap(a:readonly CinemaPoint[],b:readonly CinemaPoint[]):boolean {
 if(a.length<3||b.length<3)return false;
 for(const polygon of[a,b])for(let i=0;i<polygon.length;i++) {
  const p=polygon[i],q=polygon[(i+1)%polygon.length],x=p.y-q.y,y=q.x-p.x;
  const first=a.map(point=>point.x*x+point.y*y),second=b.map(point=>point.x*x+point.y*y);
  if(Math.max(...first)<Math.min(...second)-1e-6||Math.max(...second)<Math.min(...first)-1e-6)return false;
 }
 return true;
}
/** Cheap rejection before DOM hit testing or a scene-wide geometry pick. */
export function cinemaContainsPoint(corners:readonly CinemaPoint[],point:CinemaPoint):boolean {
 if(corners.length!==4||!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;
 let direction=0;
 for(let i=0;i<corners.length;i++){
  const a=corners[i],b=corners[(i+1)%corners.length];
  const cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);
  if(!Number.isFinite(cross))return false;
  if(Math.abs(cross)<=1e-6)continue;
  const sign=Math.sign(cross);
  if(direction&&sign!==direction)return false;
  direction=sign;
 }
 return direction!==0;
}
function source(programme:Programme|null):{key:string;url:string;title:string}|null {
 if(!programme||programme.mode!=='live')return null;
 if(programme.platform==='twitch'&&programme.twitchChannel===BRIDGEMIND_TWITCH_CHANNEL)return {key:`twitch:${BRIDGEMIND_TWITCH_CHANNEL}`,url:`https://player.twitch.tv/?channel=${BRIDGEMIND_TWITCH_CHANNEL}&parent=${encodeURIComponent(location.hostname)}&autoplay=true&muted=true`,title:'BridgeMind live on Twitch at The Bridge Picture House'};
 if(programme.platform==='youtube'&&/^[A-Za-z0-9_-]{11}$/.test(programme.youtubeVideoId))return {key:`youtube:${programme.youtubeVideoId}`,url:`https://www.youtube.com/embed/${programme.youtubeVideoId}?autoplay=1&mute=1&controls=1&playsinline=1`,title:'YouTube at The Bridge Picture House'};
 return null;
}

/**
 * Official browser player behind a depth-tested transparent screen in the canvas.
 * World geometry provides normal per-pixel occlusion; provider media stays inside
 * the iframe. The same player survives changes in distance, angle and visibility.
 */
export class WorldCinemaPlayer {
 private programme:Programme|null=null;
 private enabled=false;
 private disposed=false;
 private root:HTMLDivElement;
 private surface:HTMLDivElement;
 private iframe:HTMLIFrameElement|null=null;
 private twitch:TwitchCinemaPlayer|null=null;
 private twitchMuted:boolean|undefined;
 private soundButton:HTMLButtonElement;
 private volume=0;
 private mountedSource='';
 private eligibleSince:number|null=null;
 private screenMesh:AbstractMesh;
 private posterMaterial:Material|null;
 private portalMaterial:ShaderMaterial;
 private pointer:{x:number;y:number}|null=null;
 private pointerDragging=false;
 private pointerPick:{frame:number;x:number;y:number;nativeControls:boolean}|null=null;
 private state:CinemaPlayerStatus={mounted:false,reason:'disabled',source:null,projectedWidth:0,projectedHeight:0,blockedBy:null,corners:[]};
 get status():Readonly<CinemaPlayerStatus>{return this.state;}
 get usesNativeControls(){return this.canvas.style.pointerEvents==='none'&&this.screenMesh.material===this.portalMaterial;}
 constructor(private readonly scene:Scene,private readonly camera:Camera,private readonly canvas:HTMLCanvasElement) {
  this.root=document.createElement('div');this.root.className='world-cinema-player';
  Object.assign(this.root.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'0',overflow:'hidden'});
  this.surface=document.createElement('div');this.surface.className='world-cinema-player-surface';
  Object.assign(this.surface.style,{position:'absolute',left:'0',top:'0',width:`${WIDTH}px`,height:`${HEIGHT}px`,transformOrigin:'0 0',pointerEvents:'none',display:'none'});
  this.root.append(this.surface);canvas.insertAdjacentElement('beforebegin',this.root);
  this.soundButton=document.createElement('button');this.soundButton.type='button';this.soundButton.className='cinema-sound-action';
  this.soundButton.textContent='Enable cinema sound';this.soundButton.hidden=true;
  this.soundButton.addEventListener('click',()=>{this.twitch?.playWithSound();this.canvas.focus({preventScroll:true});});
  canvas.insertAdjacentElement('afterend',this.soundButton);
  this.screenMesh=scene.getMeshByName('cinema-screen')!;
  this.posterMaterial=this.screenMesh.material;
  this.portalMaterial=new ShaderMaterial('cinema-player-depth-window',scene,{
   vertexSource:'precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;void main(){gl_Position=worldViewProjection*vec4(position,1.0);}',
   fragmentSource:'precision highp float;void main(){gl_FragColor=vec4(0.0);}'
  },{attributes:['position'],uniforms:['worldViewProjection'],needAlphaBlending:false,needAlphaTesting:false});
  this.portalMaterial.alphaMode=Constants.ALPHA_DISABLE;
  this.portalMaterial.forceDepthWrite=true;
  window.addEventListener('pointermove',this.pointerMoved,true);
  window.addEventListener('pointerdown',this.pointerDown,true);
  window.addEventListener('pointerup',this.pointerUp,true);
  window.addEventListener('pointercancel',this.pointerUp,true);
  window.addEventListener('blur',this.focusChanged);
  document.addEventListener('visibilitychange',this.visibilityChanged);
 }
 /** The listener is the walking character, independent of camera orbit and zoom. */
 setListenerPosition(position:{x:number;z:number}|null){
  this.volume=cinemaProximityVolume(position?Math.hypot(position.x-SCREEN.x,position.z-SCREEN.z):Infinity);
  this.twitch?.setVolume(this.volume);
 }
 sync(programme:Programme|null) {
  if(this.disposed)return;
  const previous=source(this.programme)?.key;this.programme=programme;
  if(previous!==source(programme)?.key)this.unmount();
  if(!programme||programme.mode!=='live')this.reject('offline');
  else if(!source(programme))this.reject('invalid-source');
 }
 setEnabled(enabled:boolean){if(this.disposed)return;this.enabled=enabled;if(!enabled)this.reject('disabled');}
 private visibilityChanged=()=>{if(document.hidden)this.releasePointer();};
 private unmount(){
  const focused=this.surface.contains(document.activeElement)||document.activeElement===this.soundButton;
  if(this.twitch){if(this.twitch.status.ready)this.twitchMuted=this.twitch.status.muted;this.twitch.dispose();this.twitch=null;}
  this.iframe?.remove();this.iframe=null;this.mountedSource='';this.surface.style.display='none';this.eligibleSince=null;
  this.soundButton.hidden=true;this.screenMesh.material=this.posterMaterial;this.releasePointer();
  if(focused&&this.canvas.isConnected&&!document.hidden)this.canvas.focus({preventScroll:true});
 }
 private reject(reason:CinemaPlayerReason,blockedBy:string|null=null){this.unmount();this.state={...this.state,mounted:false,reason,blockedBy};}
 private releasePointer=()=>{this.pointer=null;this.pointerDragging=false;this.pointerPick=null;this.canvas.style.pointerEvents='';};
 // Focusing the native iframe must not put the canvas back between pointerdown and pointerup.
 private focusChanged=()=>{if(!this.surface.contains(document.activeElement))this.releasePointer();};
 private pointerMoved=(event:PointerEvent)=>{
  this.pointer={x:event.clientX,y:event.clientY};
  if(!event.buttons)this.pointerDragging=false;
  this.routePointer();
 };
 private pointerDown=(event:PointerEvent)=>{this.pointer={x:event.clientX,y:event.clientY};this.pointerDragging=event.target===this.canvas;};
 private pointerUp=()=>{this.pointerDragging=false;this.routePointer();};
 private routePointer(){
  if(this.pointerDragging)return;
  let nativeControls=false;
  if(this.pointer&&this.screenMesh.material===this.portalMaterial&&this.surface.style.visibility!=='hidden'&&cinemaContainsPoint(this.state.corners,this.pointer)){
   const{x,y}=this.pointer;
   const foreground=document.elementFromPoint(x,y);
   if(foreground===this.canvas||foreground===this.root||this.surface.contains(foreground)){
    const rect=this.canvas.getBoundingClientRect(),pickX=x-rect.left,pickY=y-rect.top,frame=this.scene.getFrameId();
    // Reuse only the same ray in the same rendered frame. Moving avatars and
    // other occluders are tested afresh next frame, even with a stationary camera.
    if(this.pointerPick?.frame!==frame||this.pointerPick.x!==pickX||this.pointerPick.y!==pickY){
     // Babylon applies hardware scaling internally; pointer coordinates are CSS pixels.
     const hit=this.scene.pick(pickX,pickY,
      mesh=>mesh.isEnabled()&&mesh.isVisible&&mesh.visibility>0&&!mesh.infiniteDistance&&mesh.getTotalVertices()>0&&mesh.material?.alpha!==0,false,this.camera);
     this.pointerPick={frame,x:pickX,y:pickY,nativeControls:hit?.pickedMesh===this.screenMesh};
    }
    nativeControls=this.pointerPick.nativeControls;
   }
  }
  this.canvas.style.pointerEvents=nativeControls?'none':'';
 }
 /** Call after scene.render(), so bounds and view/projection matrices belong to this frame. */
 update(){
  if(this.disposed)return;
  const current=source(this.programme);this.state={...this.state,source:current?.key??null,blockedBy:null};
  if(!this.enabled){this.reject('disabled');return;}
  if(!current){this.reject(this.programme?.mode==='live'?'invalid-source':'offline');return;}
  // Background tabs may stop animation frames. Keep the existing player, volume
  // and transform intact; the browser/provider owns background media scheduling.
  if(document.hidden)return;
  const rect=this.canvas.getBoundingClientRect(),eye=this.camera.globalPosition;
  const viewport=this.camera.viewport.toGlobal(rect.width,rect.height),transform=this.scene.getTransformMatrix();
  // CSS viewport dimensions already account for render scaling / devicePixelRatio.
  const project=(point:Vector3)=>{const p=Vector3.Project(point,IDENTITY,transform,viewport);p.x+=rect.left;p.y+=rect.top;return p;};
  const corners=[[-1,1],[1,1],[1,-1],[-1,-1]].map(([horizontal,vertical])=>project(new Vector3(SCREEN.x,SCREEN.y+vertical*SCREEN.height/2,SCREEN.z+horizontal*SCREEN.width/2)));
  const [tl,tr,br,bl]=corners,width=Math.min(tr.x,br.x)-Math.max(tl.x,bl.x),height=Math.min(bl.y,br.y)-Math.max(tl.y,tr.y);
  this.state={...this.state,projectedWidth:width,projectedHeight:height,corners:corners.map(({x,y})=>({x,y}))};
  const left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(innerWidth,rect.right),bottom=Math.min(innerHeight,rect.bottom);
  // Perspective can extend beyond any edge; the browser clips it naturally.
  // Only a camera-plane crossing or the back of the physical screen has no valid front image.
  const projectable=eye.x>SCREEN.x+.01&&rect.width>0&&rect.height>0&&corners.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.z>0&&p.z<1);
  const visible=projectable&&cinemaPolygonsOverlap(corners,[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}]);
  if(!visible){
   this.surface.style.visibility='hidden';this.screenMesh.material=this.posterMaterial;this.soundButton.hidden=true;this.releasePointer();
   this.state={...this.state,mounted:!!this.mountedSource,reason:eye.x<=SCREEN.x+.01?'behind':'clipped'};return;
  }
  if(this.mountedSource&&this.mountedSource!==current.key)this.unmount();
  if(this.eligibleSince===null)this.eligibleSince=performance.now();
  if(!this.mountedSource&&performance.now()-this.eligibleSince<MOUNT_DELAY_MS){this.state={...this.state,mounted:false,reason:'settling'};return;}
  const matrix=cinemaHomography(corners);if(matrix.some(value=>!Number.isFinite(value))){this.reject('clipped');return;}
  this.surface.style.transform=`matrix3d(${matrix.join(',')})`;this.surface.style.visibility='visible';
  if(!this.mountedSource){
   this.mountedSource=current.key;this.surface.style.display='block';
   if(this.programme?.platform==='twitch'){
    this.twitch=new TwitchCinemaPlayer(this.surface,{muted:this.twitchMuted});
    this.twitch.setVolume(this.volume);
   }else{
   const frame=document.createElement('iframe');frame.className='world-cinema-player-frame';frame.title=current.title;frame.src=current.url;
   frame.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
   Object.assign(frame.style,{display:'block',border:'0',width:`${WIDTH}px`,height:`${HEIGHT}px`,pointerEvents:'auto',background:'#080f0b'});
   this.surface.append(frame);this.iframe=frame;this.mountedSource=current.key;this.surface.style.display='block';
   }
  }
  const audio=this.twitch?.status;
  this.screenMesh.material=(!this.twitch||audio?.ready&&!audio.error)?this.portalMaterial:this.posterMaterial;
  this.routePointer();
  // Keep the opt-in below the screen, outside the complete native player.
  this.soundButton.hidden=!audio?.ready||!audio.playing||!audio.muted||this.volume===0;
  if(!this.soundButton.hidden){
   const buttonWidth=220,buttonHeight=44,x=Math.max(left+12,Math.min(right-buttonWidth-12,(Math.min(tl.x,bl.x)+Math.max(tr.x,br.x)-buttonWidth)/2)),y=Math.max(12,Math.max(bl.y,br.y)+12);
   this.soundButton.style.left=`${x}px`;this.soundButton.style.top=`${y}px`;
   this.soundButton.hidden=y+buttonHeight>bottom-100;
  }
  this.state={...this.state,mounted:true,reason:'mounted'};
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.reject('disposed');document.removeEventListener('visibilitychange',this.visibilityChanged);window.removeEventListener('pointermove',this.pointerMoved,true);window.removeEventListener('pointerdown',this.pointerDown,true);window.removeEventListener('pointerup',this.pointerUp,true);window.removeEventListener('pointercancel',this.pointerUp,true);window.removeEventListener('blur',this.focusChanged);this.portalMaterial.dispose();this.soundButton.remove();this.root.remove();}
}
