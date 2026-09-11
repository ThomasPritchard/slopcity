import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture';
import { WaterMaterial } from '@babylonjs/materials/water/waterMaterial';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { FOUNTAIN_WATER as f, JET_FLIGHT_TIME, JET_RADIAL_SPEED, fountainJetPoint } from './fountainMath';
import { GRAPHICS_PRESETS, resolveGraphicsQuality, type GraphicsQuality } from '../settings/graphics';

const tau = Math.PI * 2;
const jetMath = `
const float TAU=6.28318530718;
vec3 trajectory(float angle,float t){
 float seconds=t*${JET_FLIGHT_TIME.toFixed(9)};
 float r=${f.nozzleRadius}+seconds*${JET_RADIAL_SPEED.toFixed(9)};
 return vec3(cos(angle)*r,${f.nozzleHeight}+${f.verticalSpeed}*seconds-4.905*seconds*seconds,${f.z}.0+sin(angle)*r);
}`;
const commonFragment = `precision highp float;
uniform float time; uniform vec3 eye; varying vec3 vWorld; varying vec2 vUV;
`;

// Fixed UVs tie disturbances to real impact positions; one small GPU normal map.
ShaderStore.ShadersStore.fountainNormalsPixelShader = `precision highp float;
varying vec2 vUV; uniform float time;
void main(){
 vec2 p=(vUV-.5)*5.58;
 vec2 slope=vec2(.006*cos(p.x*12.+p.y*7.+time*1.4),.006*sin(p.y*14.-p.x*5.+time));
 for(int i=0;i<8;i++){
  float a=float(i)*.7853981634;
  vec2 d=p-vec2(cos(a),sin(a))*2.3;
  float r=length(d);
  float wave=cos(r*36.-time*9.+float(i)*.7)*.10*exp(-r*2.7);
  slope+=d/max(r,.035)*wave;
 }
 vec3 n=normalize(vec3(-slope,1.));
 gl_FragColor=vec4(n*.5+.5,1.);
}`;

/** One pool, one stream mesh, one batched spray mesh and one impact overlay. */
export class FountainWater {
  readonly surface: Mesh;
  readonly water: WaterMaterial;
  private readonly normals: ProceduralTexture;
  private readonly streams: Mesh;
  private readonly spray: Mesh;
  private readonly impacts: Mesh;
  private readonly effects: ShaderMaterial[] = [];
  private elapsed = 0;
  private quality: GraphicsQuality = 'high';
  private active = true;
  private reduced = false;

  constructor(private readonly scene: Scene) {
    // XZ geometry keeps wave/displacement coordinates aligned with the world.
    this.surface = new Mesh('Fountain water surface', scene);
    const positions = [0, 0, 0], normals = [0, 1, 0], uvs = [.5, .5], indices: number[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = i / 128 * tau, x = Math.cos(a) * f.poolRadius, z = Math.sin(a) * f.poolRadius;
      positions.push(x, 0, z); normals.push(0, 1, 0); uvs.push(.5 + x / 5.58, .5 + z / 5.58);
      if (i < 128) indices.push(0, i + 2, i + 1);
    }
    const data = new VertexData(); Object.assign(data, { positions, normals, uvs, indices }); data.applyToMesh(this.surface);
    this.surface.position.set(f.x, f.level, f.z);
    this.surface.isPickable = false;
    this.normals = new ProceduralTexture('Fountain impact normals', 256, 'fountainNormals', scene, undefined, false);
    this.normals.setFloat('time', 0);
    this.water = new WaterMaterial('Living fountain water', scene, new Vector2(512, 512));
    this.water.bumpTexture = this.normals;
    this.water.windForce = 0; this.water.waveHeight = 0; this.water.waveSpeed = 0; this.water.waveLength = 1;
    this.water.bumpHeight = .12; this.water.bumpAffectsReflection = true;
    this.water.waterColor = new Color3(.07, .22, .19); this.water.colorBlendFactor = .10;
    this.water.waterColor2 = new Color3(.10, .21, .19); this.water.colorBlendFactor2 = .12;
    this.water.specularColor = new Color3(.8, .85, .82); this.water.specularPower = 180;
    this.water.backFaceCulling = false;
    this.surface.material = this.water;
    // The copied fountain includes the submerged mosaic and reflects its bronze sculpture.
    for (const mesh of scene.meshes) {
      if (!mesh.name.startsWith('fountain/')) continue;
      if (mesh.getTotalVertices() && mesh.isVisible) this.water.addToRenderList(mesh);
    }
    this.streams = this.createStreams();
    this.spray = this.createSpray();
    this.impacts = this.createImpacts();
  }

  private material(name: string, vertex: string, fragment: string, attributes = ['position', 'uv']): ShaderMaterial {
    const material = new ShaderMaterial(name, this.scene, { vertexSource: vertex, fragmentSource: fragment }, {
      attributes, uniforms: ['worldViewProjection', 'viewProjection', 'time', 'eye', 'right', 'up', 'density'], needAlphaBlending: true,
    });
    material.backFaceCulling = false; material.disableDepthWrite = true;
    material.setFloat('time', 0); material.setFloat('density', 1);
    this.effects.push(material);
    return material;
  }

  private createStreams() {
    const mesh = new Mesh('Fountain flowing jets', this.scene);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    // Attributes encode angle, flight progress and cross-section angle. Shader owns the motion.
    const sections = 72, sides = 8;
    for (let jet = 0; jet < f.jets; jet++) {
      const start = positions.length / 3;
      for (let i = 0; i <= sections; i++) for (let j = 0; j <= sides; j++) {
        positions.push(jet / f.jets * tau, i / sections, j / sides * tau); uvs.push(i / sections, j / sides);
        if (i < sections && j < sides) {
          const n = start + i * (sides + 1) + j;
          indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2);
        }
      }
    }
    const data = new VertexData(); Object.assign(data, { positions, uvs, indices }); data.applyToMesh(mesh);
    mesh.material = this.material('Fountain moving clear water', `precision highp float;
attribute vec3 position; attribute vec2 uv; uniform mat4 viewProjection; uniform float time;
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUV;
${jetMath}
void main(){
 float a=position.x,t=position.y,s=position.z;
 vec3 c=trajectory(a,t);
 vec3 tangent=normalize(trajectory(a,min(1.,t+.001))-trajectory(a,max(0.,t-.001)));
 vec3 side=vec3(-sin(a),0.,cos(a)); vec3 normal=normalize(cross(tangent,side));
 float flow=t*115.-time*19.+a*3.+.6*sin(t*193.-time*27.+a*5.);
 float radius=.023*(1.-.30*t)*(1.+(.035+.12*t*t)*sin(flow));
 c+=side*sin(flow*.67)*.003*t*t;
 vNormal=normalize(side*cos(s)+normal*sin(s));
 vWorld=c+vNormal*radius;vUV=uv;
 gl_Position=viewProjection*vec4(vWorld,1.);
}`, `${commonFragment} varying vec3 vNormal;
void main(){
 vec3 n=normalize(vNormal),v=normalize(eye-vWorld),l=normalize(vec3(-.55,1.,-.4));
 float fresnel=pow(1.-abs(dot(n,v)),3.);
 float glint=pow(max(dot(n,normalize(l+v)),0.),65.);
 float flow=.5+.5*sin(vUV.x*115.-time*19.+vWorld.x*4.);
 float breakup=smoothstep(.74,1.,vUV.x);
 float alpha=mix(.20,.72,fresnel)+glint*.35;
 alpha*=1.-breakup*.60*(1.-flow);
 vec3 colour=mix(vec3(.38,.48,.48),vec3(.89,.96,.95),fresnel*.75+glint*.6);
 gl_FragColor=vec4(colour,clamp(alpha,0.,.9));
}`);
    this.bounds(mesh); return mesh;
  }

  private createSpray() {
    const mesh = new Mesh('Fountain spray', this.scene), positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    // 32 airborne droplets + 24 small splash droplets per jet, in one draw call.
    for (let jet = 0; jet < f.jets; jet++) for (let i = 0; i < 56; i++) {
      const base = positions.length / 3;
      for (const [x, y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        positions.push(jet / f.jets * tau, i / 56, i < 32 ? 0 : 1); uvs.push(x, y);
      }
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    const data = new VertexData(); Object.assign(data, { positions, uvs, indices }); data.applyToMesh(mesh);
    mesh.material = this.material('Fountain droplets and splash', `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 viewProjection; uniform float time; uniform float density; uniform vec3 right; uniform vec3 up;
varying vec2 vUV; varying vec3 vWorld; varying float vAlpha;
${jetMath}
void main(){
 float a=position.x,seed=position.y;
 float phase=fract(time*1.13+seed*7.31+a*.37);
 float hash=fract(sin(seed*619.+a*173.)*43758.54);
 vec3 p; float size;
 if(position.z<.5){
  float t=.57+phase*.43;
  p=trajectory(a,t);
  p+=vec3(cos(a+hash*TAU),0.,sin(a+hash*TAU))*.035*phase;
  size=.008+hash*.008;vAlpha=sin(phase*3.14159)*.65;
 }else{
  p=trajectory(a,1.);
  float flight=phase*.36;
  float spread=hash*TAU+seed*21.;
  p+=vec3(cos(spread)*flight*.6,1.8*flight-4.905*flight*flight,sin(spread)*flight*.6);
  size=.008+hash*.012;vAlpha=(1.-phase)*.62;
 }
 if(hash>density)vAlpha=0.;
 vUV=uv;vWorld=p;
 gl_Position=viewProjection*vec4(p+right*uv.x*size+up*uv.y*size*1.65,1.);
}`, `${commonFragment} varying float vAlpha;
void main(){
 float r=length(vUV);if(r>1.)discard;
 float alpha=(1.-smoothstep(.35,1.,r))*vAlpha;
 gl_FragColor=vec4(.86,.94,.93,alpha);
}`);
    this.bounds(mesh); return mesh;
  }

  private createImpacts() {
    const mesh = new Mesh('Fountain impact ripples', this.scene), positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let jet = 0; jet < f.jets; jet++) {
      const p = fountainJetPoint(jet, 1), base = positions.length / 3;
      for (const [x, z] of [[-1,-1],[-1,1],[1,1],[1,-1]]) { positions.push(p.x+x*.44,f.level+.004,p.z+z*.44);uvs.push(x,z); }
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    const data = new VertexData();Object.assign(data,{positions,uvs,indices});data.applyToMesh(mesh);
    mesh.material=this.material('Fountain small impact foam', `precision highp float;
attribute vec3 position;attribute vec2 uv;uniform mat4 viewProjection;varying vec3 vWorld;varying vec2 vUV;
void main(){vWorld=position;vUV=uv;gl_Position=viewProjection*vec4(position,1.);}`, `${commonFragment}
void main(){
 float r=length(vUV);if(r>1.)discard;
 float phase=r*34.-time*9.;
 float ring=pow(max(0.,cos(phase)),16.)*(1.-smoothstep(.08,1.,r))*.16;
 float turbulence=.5+.5*sin(vUV.x*91.+time*6.)*sin(vUV.y*87.-time*4.);
 float foam=exp(-r*r*85.)*(.13+.24*turbulence);
 gl_FragColor=vec4(.82,.92,.88,ring+foam);
}`);
    mesh.isPickable=false;return mesh;
  }

  private bounds(mesh: Mesh) {
    // Encoded particle attributes are not world positions; supply the real effect bounds.
    mesh.setBoundingInfo(new BoundingInfo(new Vector3(-2.7,f.level,.3-2),new Vector3(2.7,1.7,3.7)));
    mesh.isPickable=false;
  }

  setQuality(quality: GraphicsQuality | boolean, active: boolean) {
    this.quality=resolveGraphicsQuality(quality);this.active=active;
    const budget=GRAPHICS_PRESETS[this.quality];
    for(const texture of [this.water.reflectionTexture,this.water.refractionTexture])if(texture){
      if(texture.getSize().width!==budget.waterSize)texture.resize(budget.waterSize);
      texture.refreshRate=active?budget.waterRefresh:0;
    }
    this.normals.refreshRate=this.reduced||!active?0:budget.waterNormalRefresh;
    for(const effect of this.effects)effect.setFloat('density',budget.sprayDensity);
  }

  setReducedMotion(reduced: boolean) {
    this.reduced=reduced;
    this.spray.setEnabled(!reduced&&this.active);
    this.setQuality(this.quality,this.active);
  }

  update(dt: number, camera: ArcRotateCamera) {
    const nearby=Vector3.DistanceSquared(camera.position,new Vector3(f.x,1,f.z))<45*45;
    this.streams.setEnabled(this.active&&nearby);
    this.impacts.setEnabled(this.active&&nearby);
    this.spray.setEnabled(this.active&&nearby&&!this.reduced);
    if(!this.active||!nearby)return;
    if(!this.reduced)this.elapsed+=dt;
    this.normals.setFloat('time',this.elapsed);
    const right=camera.getDirection(Vector3.Right()),up=camera.getDirection(Vector3.Up());
    for(const effect of this.effects){effect.setFloat('time',this.elapsed);effect.setVector3('eye',camera.position);effect.setVector3('right',right);effect.setVector3('up',up);}
  }
}
