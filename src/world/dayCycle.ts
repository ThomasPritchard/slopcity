import { Scene } from '@babylonjs/core/scene';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { LampPostLighting } from './lampPosts';
import { DAYLIGHT_PHASE, TownDayClock, dayCycleState } from './dayCycleMath';

const vertexSource = `precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 skyDirection;
void main(){skyDirection=normalize(position);gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSource = `precision highp float;
varying vec3 skyDirection;
uniform vec3 zenithColor, horizonColor, solarDirection;
uniform float daylight, twilight;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
void main(){
 vec3 d=normalize(skyDirection);
 float height=pow(max(d.y,0.0),0.65);
 vec3 sky=mix(horizonColor,zenithColor,height);
 float sunDot=dot(d,solarDirection),moonDot=dot(d,-solarDirection);
 sky+=vec3(0.38,0.15,0.035)*pow(max(sunDot,0.0),12.0)*twilight;
 sky+=vec3(1.0,0.80,0.48)*smoothstep(0.99955,0.99982,sunDot)*daylight;
 float moon=smoothstep(0.99945,0.99978,moonDot);
 sky+=vec3(0.65,0.73,0.85)*moon*(1.0-daylight);
 vec3 cell=floor(d*360.0);
 float stars=step(0.9985,hash(cell))*pow(max(hash(cell+3.4),0.0),3.0);
 sky+=vec3(stars)*smoothstep(0.02,0.30,d.y)*(1.0-daylight)*0.65;
 gl_FragColor=vec4(sky,1.0);
}`;

/** Thirty-minute UTC cycle; one directional shadow pass follows the sun or moon. */
export class DayCycle {
  readonly clock = new TownDayClock();
  private previewPhase: number | null = null;
  private skyMaterial: ShaderMaterial;
  private solarDirection = new Vector3();
  private direction = new Vector3();
  private zenith = new Color3();
  private horizon = new Color3();
  private dayZenith = new Color3(.34, .55, .68);
  private nightZenith = new Color3(.012, .024, .058);
  private dayHorizon = Color3.FromHexString('#cadbdf');
  private nightHorizon = new Color3(.075, .105, .15);
  private sunsetHorizon = new Color3(.64, .39, .27);
  private noonLight = Color3.FromHexString('#fff0d5');
  private sunsetLight = new Color3(1, .57, .29);
  private moonLight = new Color3(.55, .68, 1);
  state = dayCycleState(DAYLIGHT_PHASE);

  constructor(private scene: Scene, private sun: DirectionalLight, private sky: HemisphericLight, private lamps: LampPostLighting) {
    const dome = MeshBuilder.CreateSphere('Town day-night sky', { diameter: 800, segments: 24 }, scene);
    dome.infiniteDistance = true; dome.isPickable = false; dome.alwaysSelectAsActiveMesh = true;
    this.skyMaterial = new ShaderMaterial('Town sky gradient', scene, { vertexSource, fragmentSource }, {
      attributes: ['position'], uniforms: ['worldViewProjection', 'zenithColor', 'horizonColor', 'solarDirection', 'daylight', 'twilight'],
    });
    this.skyMaterial.backFaceCulling = false; this.skyMaterial.disableDepthWrite = true;
    dome.material = this.skyMaterial;
    this.update(false);
  }
  /** Local art inspection only. Normal gameplay leaves this null. */
  setPreviewPhase(phase: number | null) {
    this.previewPhase = phase === null ? null : ((phase % 1) + 1) % 1;
  }
  synchronise(serverTime: number) { this.clock.synchronise(serverTime); }
  update(neutralPreview: boolean) {
    const phase = neutralPreview ? DAYLIGHT_PHASE : this.previewPhase ?? this.clock.phase();
    const state = this.state = dayCycleState(phase), angle = phase * Math.PI * 2;
    this.solarDirection.set(-Math.cos(angle), state.elevation, Math.cos(angle) * .34).normalize();
    // The single shadow-casting key changes from warm sunlight to soft moonlight.
    this.direction.copyFrom(this.solarDirection).scaleInPlace(state.elevation >= 0 ? 1 : -1);
    this.direction.y = Math.max(.14, this.direction.y); this.direction.normalize();
    this.sun.position.copyFrom(this.direction).scaleInPlace(65);
    this.sun.direction.copyFrom(this.direction).scaleInPlace(-1);
    this.sun.intensity = state.sunIntensity + state.moonIntensity;
    Color3.LerpToRef(this.noonLight, this.sunsetLight, state.twilight * .65, this.sun.diffuse);
    Color3.LerpToRef(this.moonLight, this.sun.diffuse, state.daylight, this.sun.diffuse);
    this.sky.intensity = state.skyIntensity;
    this.sky.diffuse.set(.76 + .24 * state.daylight, .83 + .17 * state.daylight, 1);
    this.scene.environmentIntensity = state.environmentIntensity;
    Color3.LerpToRef(this.nightZenith, this.dayZenith, state.daylight, this.zenith);
    Color3.LerpToRef(this.nightHorizon, this.dayHorizon, state.daylight, this.horizon);
    Color3.LerpToRef(this.horizon, this.sunsetHorizon, state.twilight * .62, this.horizon);
    this.scene.fogColor.copyFrom(this.horizon);
    this.scene.clearColor.set(this.horizon.r, this.horizon.g, this.horizon.b, 1);
    this.skyMaterial.setColor3('zenithColor', this.zenith).setColor3('horizonColor', this.horizon)
      .setVector3('solarDirection', this.solarDirection).setFloat('daylight', state.daylight).setFloat('twilight', state.twilight);
    this.lamps.setNightWeight(state.lamps);
  }
}
