import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Ray } from '@babylonjs/core/Culling/ray';
import { WALLS, SHIRTS, district, move, type Position, type Profile } from '../../shared/world';

import { type Appearance, type Outfit } from '../../shared/catalog';
import { CASINO_ANCHORS, type CasinoAnchor, type CasinoState, type CasinoPrivateState } from '../../shared/casino';
import { BENCHES } from '../../shared/social';
import { AuthoredAssets, CitizenModel } from './assets';
import { CasinoTableArt, drawSlotSymbol } from './casinoArt';
import { WaterMaterial } from '@babylonjs/materials/water/waterMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import '@babylonjs/core/Rendering/boundingBoxRenderer';

export type PlayerView = Position & Profile & Outfit & { profileId: string; seatId: string; heading: number; moving: boolean; wave: number };
export type SceneStats = { fps: number; district: string; x: number; z: number };
type Avatar = { root: TransformNode; model: CitizenModel; label: Mesh; wave: number; seatId: string; lowDetail: boolean };

export class TownScene {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private shadows: ShadowGenerator;
  private materials = new Map<string, StandardMaterial>();
  private avatars = new Map<string, Avatar>();
  private walls: Mesh[] = [];
  private localId: string | null = null;
  private desired: Position = { x: 0, z: -17 };
  private keys = new Set<string>();
  private touch = { x: 0, z: 0 };
  private remote = new Map<string, PlayerView>();
  private particles: Mesh[] = [];
  private lastStats = 0;
  private low = false;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver;
  private resizeFrame = 0;
  private requestedRadius = 7.5;
  private appliedRadius = 7.5;
  private savedView: { alpha: number; beta: number; radius: number } | null = null;
  private interactionMarker: Mesh | null = null;
  private motionClock = 0;
  private framing: { from: Vector3; to: Vector3; alpha: number; beta: number; radius: number; startAlpha: number; startBeta: number; startRadius: number; age: number } | null = null;
  onMotion?: (x: number, z: number, moving: boolean) => void;
  private clock = 0;
  onStats?: (stats: SceneStats) => void;
  onInput?: (x: number, z: number) => void;
  private inputClock = 0;
  private paused = false;
  readonly ready: Promise<void>;
  private assets: AuthoredAssets;
  private studio!: TransformNode;
  private preview: CitizenModel | null = null;
  private previewOrigin = new Vector3(80,.04,0);
  private previewAlpha = -Math.PI/2;
  private previewRotation = Math.PI;
  private mode: 'welcome' | 'customise' | 'wardrobe' | 'playing' = 'welcome';
  private mirror!: MirrorTexture;
  private water!: WaterMaterial;
  private casinoFocus: CasinoAnchor | null = null;
  private rouletteWheel!: TransformNode;
  private rouletteBall!: Mesh;
  private casinoState: CasinoState | null = null;
  private casinoTimeOffset = 0;
  private wheelVelocity = 0;
  private ballAngle = 0;
  private ballRadius = .64;
  private reelTextures = new Map<string, DynamicTexture>();
  private reelKeys = new Map<string, string>();
  private tableCards!: CasinoTableArt;

  constructor(readonly canvas: HTMLCanvasElement, low = false) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true }, true);
    this.low = low;
    this.engine.setHardwareScalingLevel(1 / (low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#cadbdfff');
    this.scene.ambientColor = new Color3(.15, .15, .15);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = .006;
    this.scene.fogColor = Color3.FromHexString('#cadbdf');
    this.camera = new ArcRotateCamera('camera', -1.98, 1.04, 37, new Vector3(0, 1, 2), this.scene);
    this.camera.minZ = .15;
    this.camera.lowerRadiusLimit = 3;
    this.camera.upperRadiusLimit = 50;
    this.camera.lowerBetaLimit = .45;
    this.camera.upperBetaLimit = 1.43;
    this.camera.wheelPrecision = 30;
    this.camera.panningSensibility = 0;
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.camera.angularSensibilityX = 1100;
    this.camera.angularSensibilityY = 1100;
    const ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = .45;
    ambient.groundColor = Color3.FromHexString('#9b8870');
    const sun = new DirectionalLight('sun', new Vector3(.55, -1, .4), this.scene);
    sun.position = new Vector3(-30, 45, -30);
    sun.intensity = .7;
    sun.diffuse = Color3.FromHexString('#fff0d5');
    sun.shadowMinZ = 1; sun.shadowMaxZ = 120;
    this.shadows = new ShadowGenerator(2048, sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = .001;
    this.shadows.normalBias = .02;
    this.shadows.setDarkness(.2);
    this.setQuality(low);
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.resizeFrame) this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; this.resize(); });
    });
    this.resizeObserver.observe(canvas);
    this.assets = new AuthoredAssets(this.scene);
    this.tableCards = new CasinoTableArt(this.scene);
    this.ready = this.initialise();
    this.scene.onBeforeRenderObservable.add(() => this.update());
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(() => this.scene.render());
  }
  private mat(hex: string, specular = .08): StandardMaterial {
    const key = `${hex}:${specular}`;
    let mat = this.materials.get(key);
    if (!mat) {
      mat = new StandardMaterial(key, this.scene);
      mat.diffuseColor = Color3.FromHexString(hex);
      mat.specularColor = new Color3(specular, specular, specular);
      this.materials.set(key, mat);
    }
    return mat;
  }
  private box(name: string, x: number, y: number, z: number, w: number, h: number, d: number, colour: string, shadow = true): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    mesh.position.set(x, y, z); mesh.material = this.mat(colour); mesh.receiveShadows = true;
    if (shadow) this.shadows.addShadowCaster(mesh);
    return mesh;
  }
  private cylinder(name: string, x: number, y: number, z: number, height: number, diameter: number, colour: string, top = diameter): Mesh {
    const mesh = MeshBuilder.CreateCylinder(name, { height, diameterBottom: diameter, diameterTop: top, tessellation: 40 }, this.scene);
    mesh.position.set(x, y, z); mesh.material = this.mat(colour); mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
    return mesh;
  }
  private sign(text: string, x: number, y: number, z: number, width: number, height: number, colour = '#e9dfbf', background = '#233b35', rotation = 0, resolution = 1024) {
    const tex = new DynamicTexture(`sign-${text}`, { width: resolution, height: resolution / 4 }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.scale(resolution / 1024, resolution / 1024);
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `500 ${text.length > 19 ? 56 : 74}px Georgia`;
    ctx.fillText(text, 512, 133); tex.update();
    const mat = new StandardMaterial(`sign-mat-${text}`, this.scene);
    mat.diffuseTexture = tex; mat.emissiveColor = new Color3(.22, .22, .22); mat.specularColor = Color3.Black();
    const plane = MeshBuilder.CreatePlane(`sign-${text}`, { width, height, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    plane.material = mat; plane.position.set(x, y, z); plane.rotation.y = rotation;
    return plane;
  }
  private placeAsset(name: string, x: number, y: number, z: number, rotation = 0, scale = 1) {
    const root = this.assets.place(name, x, y, z, rotation, scale);
    for (const mesh of root.getChildMeshes()) {
      if(mesh instanceof InstancedMesh)mesh.sourceMesh.receiveShadows=true;
      else mesh.receiveShadows = true;
      this.shadows.addShadowCaster(mesh);
    }
    return root;
  }
  private tree(x: number, z: number, scale = 1) { this.placeAsset('tree', x, .62, z, 0, scale); }
  private bench(x: number, z: number, rotation: number) { this.placeAsset('bench', x, 0, z, rotation); }
  private buildWorld(): Mesh {
    this.box('base', 0, -.22, 0, 220, .4, 220, '#b2b6a3', false);
    this.box('square', 0, -.04, 0, 54, .1, 54, '#d5cbb8', false);
    // Wide pale paths and inset paving lines make the architecture legible from the arrival camera.
    this.box('main promenade', 0, .022, -7, 8, .012, 39, '#e3dcca', false);
    this.box('cross promenade', 0, .026, -2, 52, .01, 5, '#e3dcca', false);
    for (let i = -26; i <= 26; i += 2) {
      this.box('paving joint', i, .032, 0, .016, .008, 52, '#c4bba9', false);
      this.box('paving joint', 0, .033, i, 52, .008, .016, '#c4bba9', false);
    }
    for (const wall of WALLS) {
      const mesh = this.box(wall.kind, wall.x, wall.h / 2, wall.z, wall.w, wall.h, wall.d, wall.kind === 'planter' ? '#9f9f88' : '#e6dcc8');
      this.walls.push(mesh);
      if (wall.kind === 'planter') {
        mesh.visibility = 0;
        this.placeAsset('planter', wall.x, 0, wall.z);
        this.tree(wall.x, wall.z, .9);
      }
    }
    for (const x of [-22, -17, 17, 23]) { this.tree(x, -20, 1.2); }
    // Casino facade, arcade and open doorway.
    this.box('casino floor', 0, .045, 20, 31.5, .04, 11.4, '#72756b', false);
    this.box('casino lintel', 0, 4.8, 13.9, 32.8, 2.4, .9, '#e4dac5');
    for(const z of [13.7,26.3])this.box('casino parapet',0,6.15,z,33.2,.4,.5,'#bfb49a');
    for(const x of [-16.3,16.3])this.box('casino parapet',x,6.15,20,.5,.4,13,'#bfb49a');
    // The high-level roof is open for this first movement study.
    for (const x of [-14, -10, -6, 6, 10, 14]) {
      this.box('casino panel', x, 2.6, 13.69, 2.8, 3.8, .1, '#46615a', false);
      for (const offset of [-1.45, 1.45]) this.box('brass trim', x + offset, 2.6, 13.56, .055, 3.85, .08, '#b7a57a', false);
    }
    for (const x of [-16, -2.3, 2.3, 16]) this.box('entry column', x, 2.2, 12.4, .35, 4.4, .4, '#d2c5a8');
    this.box('entry canopy', 0, 4.4, 12.4, 33, .2, 3.5, '#40534a');
    this.sign('THE MERIDIAN', 0, 5.0, 13.36, 10, 1.7);
    this.sign('C A S I N O', 0, 3.77, 11.98, 2.4, .5, '#d9cda7', '#40534a');
    this.sign('A little luck. Good company.', 0, 3.6, 25.68, 10, 2, '#ece1c1', '#536355');
    this.placeAsset('casino-kit', 0, 0, 0, Math.PI);
    const venueLight = new PointLight('Casino soft fill', new Vector3(0,4,20), this.scene);
    venueLight.diffuse = new Color3(1,.96,.89); venueLight.intensity = .22; venueLight.range = 13;
    // Restrict the venue fill to casino meshes so clothing previews remain neutral.
    venueLight.includedOnlyMeshes = this.scene.meshes.filter(mesh => mesh.name.startsWith('casino-kit/') || mesh.name === 'casino floor');
    this.rouletteWheel=this.placeAsset('roulette-wheel',-9.37,1.32,20,Math.PI);
    this.rouletteBall=MeshBuilder.CreateSphere('Ivory roulette ball',{diameter:.06,segments:12},this.scene);
    this.rouletteBall.material=this.mat('#f4edda',.4);
    this.rouletteBall.position.set(-8.72,1.365,20);
    for(const anchor of CASINO_ANCHORS.filter(anchor=>anchor.game==='slots')) {
      const texture=new DynamicTexture(`reels-${anchor.id}`,{width:768,height:256},this.scene,false);
      const material=new StandardMaterial(`reels-${anchor.id}`,this.scene);material.diffuseTexture=texture;material.emissiveColor=new Color3(.65,.65,.65);material.specularColor=Color3.Black();
      const screen=MeshBuilder.CreatePlane(`screen-${anchor.id}`,{width:1.05,height:.45},this.scene);screen.position.set(anchor.x,1.49,23.45);screen.material=material;
      this.reelTextures.set(anchor.id,texture);
      // Upload an initial frame before scene readiness; live state arrives after joining.
      texture.drawText('7       7       7',null,165,'bold 106px Georgia','#922d35','#eee3bf',true);
    }
    // Clothing store: window bays and open centre doorway.
    this.box('shop floor', 22, .05, -2, 7.5, .05, 19.5, '#dfd3bc', false);
    for (const z of [-8, 4]) {
      this.box('shop window', 17.7, 2.35, z, .08, 3.2, 5.8, '#66827a', false);
      for (const zz of [z - 3, z, z + 3]) this.box('window mullion', 17.57, 2.35, zz, .1, 3.6, .07, '#48594d', false);
      this.box('shop awning', 17.4, 4.4, z, 2, .17, 6.5, '#697961');
    }
    this.box('shop lintel', 18, 4.45, -2, .6, 1.1, 4, '#d9cdb5');
    this.sign('FORM & THREAD', 17.5, 4.48, -2, 5.5, .9, '#eee7d4', '#4f6456', Math.PI / 2);
    this.sign('Find your everyday.', 25.68, 3, -2, 6, 1.4, '#5a6151', '#dfd3bc', Math.PI / 2);
    this.placeAsset('clothing-shop', 22, 0, -2, Math.PI);
    // Western streetscape and distant skyline. These buildings are outside the walkable area.
    for (let i = 0; i < 7; i++) {
      const x = -36, z = -24 + i * 8, h = 8 + (i % 3) * 2.4;
      this.box('neighbourhood', x, h / 2, z, 14, h, 7.6, ['#bcb2a0', '#a4aa9e', '#c8b49c'][i % 3]);
      this.box('cornice', -28.9, h - .6, z, .3, .22, 7.9, '#e0d7c3');
      for (let floor = 2; floor < h - 1; floor += 2.5) for (const offset of [-2, .3, 2.5]) this.box('window', -28.9, floor, z + offset, .06, 1.5, 1.2, '#667874', false);
    }
    for (let i = 0; i < 9; i++) {
      const h = 12 + (i * 7 % 16);
      this.box('skyline', -50 + i * 13, h / 2, 50 + (i % 3) * 7, 9, h, 12, ['#a2b1ae', '#b3b9af', '#c3c4b7'][i % 3], false);
      for (let floor = 3; floor < h; floor += 3) this.box('skyline band', -50 + i * 13, floor, 43.95 + (i % 3) * 7, 8, .65, .04, '#90a5a3', false);
    }
    for (const x of [-6.5, 6.5]) for (const z of [-12, 8]) this.placeAsset('lamp', x, 0, z);
    for (const bench of BENCHES) this.bench(bench.x, bench.z, bench.heading);
    this.placeAsset('fountain', 0, 0, 1);
    const water = MeshBuilder.CreateDisc('Fountain water surface', { radius: 2.79, tessellation: 96 }, this.scene);
    water.rotation.x = Math.PI / 2; water.position.set(0, .43, 1);
    this.water = new WaterMaterial('Living fountain water', this.scene, new Vector2(512, 512));
    this.water.bumpTexture = new Texture('/textures/water-normal.png', this.scene);
    this.water.windForce = 1.4; this.water.waveHeight = .009; this.water.waveLength = .16;
    this.water.waveSpeed = .4; this.water.bumpHeight = .12;
    this.water.waterColor = new Color3(.08, .19, .17); this.water.colorBlendFactor = .2;
    this.water.waterColor2 = new Color3(.06, .15, .14); this.water.colorBlendFactor2 = .25;
    this.water.backFaceCulling = false; water.material = this.water;
    // Reflect only the fountain and nearby authored props, never citizens or distant buildings.
    for (const mesh of this.scene.meshes) {
      mesh.computeWorldMatrix(true);
      const position = mesh.getAbsolutePosition();
      if (/^(fountain|bench|lamp|planter|tree)\//.test(mesh.name) && Math.hypot(position.x, position.z - 1) < 14 && mesh.isVisible) this.water.addToRenderList(mesh);
    }
    this.setReducedMotion(this.reducedMotion);
    this.updateWaterQuality();
    // Thin continuous arcs and animated droplets give the jets a sense of flow.
    const jetMat = new StandardMaterial('Clear fountain jets', this.scene);
    jetMat.diffuseColor = new Color3(.65,.82,.78); jetMat.specularColor = Color3.White(); jetMat.alpha = .38;
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const path = Array.from({length: 32}, (_, j) => {
        const t = j / 31, r = .65 + t * 1.65;
        return new Vector3(Math.cos(angle)*r, .43+Math.sin(t*Math.PI)*.8, 1+Math.sin(angle)*r);
      });
      const jet = MeshBuilder.CreateTube('Water jet', { path, radius: .012, tessellation: 6 }, this.scene); jet.material = jetMat;
    }
    for (let i = 0; i < 40; i++) {
      const drop = MeshBuilder.CreateSphere('Spray', { diameter: .025, segments: 4 }, this.scene);
      drop.material = jetMat; this.particles.push(drop);
    }
    this.sign('TOWN SQUARE', -5.8, 1.25, -15, 3.4, .75, '#dce4b4', '#314a40');
    this.box('wayfinding post', -5.8, .6, -15, .06, 1.2, .08, '#314a40');
    return water;
  }

  private async initialise() {
    await this.assets.load();
    this.scene.environmentTexture = new HDRCubeTexture('/textures/city-light.hdr', this.scene, 128, false, true, false, true);
    this.scene.environmentIntensity = .7;
    this.buildWorld();
    this.studio = this.assets.place('changing-room', 80, 0, 0, Math.PI);
    this.mirror = new MirrorTexture('Changing room reflection', 512, this.scene, true);
    this.mirror.mirrorPlane = new Plane(0, 0, 1, -2.105);
    this.mirror.level = .8;
    for (const mesh of this.studio.getChildMeshes()) if (mesh.material?.name.includes('Mirror_Surface')) {
      const material = new StandardMaterial('Changing room mirror', this.scene);
      material.diffuseColor = Color3.Black(); material.reflectionTexture = this.mirror; mesh.material = material;
    }
    for (const mesh of this.scene.meshes) if (mesh.name.startsWith('clothing-shop/') && mesh.material?.name === 'Shop mirror') {
      const material = new StandardMaterial('Fitting room mirror', this.scene);
      material.diffuseColor = Color3.Black(); material.reflectionTexture = this.mirror; mesh.material = material;
    }
    this.studio.setEnabled(false);
    await this.scene.whenReadyAsync();
    this.resize();
  }
  customise(profile: Appearance, shop = false, wardrobe = false) {
    if (this.mode === 'playing') this.saveView();
    this.framing = null;
    this.previewOrigin.set(shop ? 23.3 : 80, shop ? .13 : .04, shop ? -8.6 : 0);
    this.previewAlpha = shop ? Math.PI : -Math.PI/2; this.previewRotation = shop ? -Math.PI/2 : Math.PI;
    this.mode = wardrobe ? 'wardrobe' : 'customise'; this.scene.shadowsEnabled = false; this.updateWaterQuality(); this.blur(); this.studio.setEnabled(!shop);
    if (this.localId) this.avatars.get(this.localId)?.root.setEnabled(false);
    this.preview?.dispose(); this.preview = this.assets.citizen('preview', profile);
    this.preview.root.position.copyFrom(this.previewOrigin);
    this.preview.root.rotation.y = this.previewRotation;
    this.mirror.mirrorPlane = shop ? new Plane(1, 0, 0, -25.28) : new Plane(0, 0, 1, -2.105);
    const roomMeshes = shop ? this.scene.meshes.filter(mesh => mesh.name.startsWith('clothing-shop/')) : this.studio.getChildMeshes();
    this.mirror.renderList = [...this.preview.meshes, ...roomMeshes.filter(mesh => !['Changing room mirror','Fitting room mirror'].includes(mesh.material?.name ?? ''))];
    this.camera.setTarget(this.previewOrigin.add(new Vector3(0,.98,0)), false, true, true);
    this.camera.alpha = this.previewAlpha; this.camera.beta = 1.46; this.camera.radius = 3.65;
    this.camera.lowerRadiusLimit = .6; this.camera.upperRadiusLimit = 4.3;
    this.camera.lowerAlphaLimit = this.previewAlpha - .75; this.camera.upperAlphaLimit = this.previewAlpha + .75;
    this.camera.upperBetaLimit = 1.65;
    this.camera.attachControl(this.canvas, true); this.resize();
  }
  updatePreview(profile: Appearance) { this.preview?.apply(profile); }
  rotatePreview(direction: number) { if (this.preview) this.preview.root.rotation.y += direction * .4; }
  framePreview(view: 'face' | 'outfit' | 'shoes') {
    if (!this.preview) return;
    const framing = view === 'face' ? { y: 1.7, radius: .9, beta: 1.46 } : view === 'shoes' ? { y: .15, radius: .85, beta: 1.0 } : { y: .98, radius: 3.65, beta: 1.46 };
    this.camera.setTarget(this.previewOrigin.add(new Vector3(0,framing.y,0)), false, true, true);
    this.camera.alpha = this.previewAlpha; this.camera.beta = framing.beta; this.camera.radius = framing.radius;
    this.preview.root.rotation.y = this.previewRotation + (view === 'shoes' ? .45 : 0);
  }
  private avatar(id: string, profile: Appearance): Avatar {
    const model = this.assets.citizen(id, profile), root = model.root;
    for (const mesh of model.meshes) { mesh.receiveShadows = true; this.shadows.addShadowCaster(mesh); }
    const label = this.sign(profile.name, 0, 2.15, 0, 1.35, .25, '#fff9e9', '#30483e', 0, 256);
    label.parent = root; label.billboardMode = Mesh.BILLBOARDMODE_ALL; label.isPickable = false;
    return { root, model, label, wave: 0, seatId: '', lowDetail: false };
  }
  enter(id: string) {
    this.avatars.get(id)?.root.setEnabled(true);
    this.casinoFocus=null;
    this.mode = 'playing'; this.scene.shadowsEnabled = true; this.updateWaterQuality(); this.preview?.dispose(); this.preview = null;
    this.studio.setEnabled(false); this.mirror.renderList = [];
    this.camera.viewport = new Viewport(0, 0, 1, 1);
    this.camera.lowerRadiusLimit = .65; this.camera.upperBetaLimit = 1.43;
    this.camera.lowerAlphaLimit = null; this.camera.upperAlphaLimit = null;
    this.localId = id; this.restoreView();
    this.camera.upperRadiusLimit = 13;
    this.camera.attachControl(this.canvas, true);
    this.canvas.focus();
  }
  sync(players: Map<string, PlayerView>) {
    this.remote = players;
    for (const [id, player] of players) {
      const created = !this.avatars.has(id);
      if (created) {
        const avatar = this.avatar(id, player);
        avatar.root.position.set(player.x, 0, player.z); avatar.root.rotation.y = player.heading;
        this.avatars.set(id, avatar);
      }
      const avatar = this.avatars.get(id)!;
      avatar.model.apply(player);
      if (avatar.seatId !== player.seatId) { avatar.seatId = player.seatId; avatar.root.position.set(player.x, 0, player.z); avatar.root.rotation.y = player.heading; }
      if (id === this.localId) {
        const error = Math.hypot(avatar.root.position.x - player.x, avatar.root.position.z - player.z);
        if (error > 2) avatar.root.position.set(player.x, 0, player.z);
        if (created) {
          this.camera.setTarget(new Vector3(player.x, 1.35, player.z), false, true, true);
          this.camera.radius = this.appliedRadius = this.requestedRadius;
        }
        this.desired = { x: player.x, z: player.z };
        avatar.label.setEnabled(false);
      }
      if (avatar.wave !== player.wave) { avatar.wave = player.wave; avatar.model.wave(); }
    }
    for (const [id, avatar] of this.avatars) if (!players.has(id)) { avatar.label.material?.dispose(false, true); avatar.model.dispose(); this.avatars.delete(id); }
  }
  syncCasino(state: CasinoState) { this.casinoState=state; this.casinoTimeOffset=state.serverTime-Date.now(); this.tableCards.sync(state); }
  syncCasinoPrivate(value:CasinoPrivateState){this.tableCards.syncPrivate(value);}
  focusCasino(anchor: CasinoAnchor | null) {
    if (anchor && !this.casinoFocus) this.saveView();
    this.casinoFocus=anchor;this.blur();
    this.updateWaterQuality();
    if(anchor) {
      this.frameCamera(new Vector3(anchor.x,1.1,anchor.z), -Math.PI/2, anchor.game==='roulette'?.64:anchor.game==='slots'?1.3:.9, anchor.game==='roulette'?7:anchor.game==='slots'?4.2:5.3);
      this.camera.lowerRadiusLimit=2.5;this.camera.upperRadiusLimit=8;
    } else {this.camera.lowerRadiusLimit=.65;this.camera.upperRadiusLimit=13;this.restoreView(true);}
    this.resize();
  }
  private animateCasino() {
    if(!this.casinoState || !this.rouletteWheel)return;
    const now=Date.now()+this.casinoTimeOffset;
    const dt=Math.min(.1,this.engine.getDeltaTime()/1000);
    const roulette=this.casinoState.tables.find(table=>table.game==='roulette');
    const order=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
    if(roulette?.game==='roulette') {
      if(roulette.phase==='spinning' && !this.reducedMotion) {
        this.wheelVelocity=2.2;this.rouletteWheel.rotation.y+=this.wheelVelocity*dt;
        this.ballAngle-=4.5*dt;this.ballRadius+=(.82-this.ballRadius)*Math.min(1,dt*8);
      } else {
        this.wheelVelocity=this.reducedMotion?0:this.wheelVelocity*Math.exp(-dt*4);this.rouletteWheel.rotation.y+=this.wheelVelocity*dt;
        const index=order.indexOf(roulette.result??roulette.history[0]??0);
        const target=(index+.5)/37*Math.PI*2-(this.rouletteWheel.rotation.y-Math.PI);
        const difference=Math.atan2(Math.sin(target-this.ballAngle),Math.cos(target-this.ballAngle));
        this.ballAngle+=difference*(this.reducedMotion?1:Math.min(1,dt*7));this.ballRadius+=(.64-this.ballRadius)*(this.reducedMotion?1:Math.min(1,dt*6));
      }
      this.rouletteBall.position.set(-9.37+Math.cos(this.ballAngle)*this.ballRadius,1.355+(this.ballRadius-.64)*.36,20+Math.sin(this.ballAngle)*this.ballRadius);
    }
    for(const table of this.casinoState.tables) if(table.game==='slots') {
      const symbols=table.phase==='spinning'&&!this.reducedMotion?Array.from({length:3},(_,i)=>(['cherry','lemon','bar','seven'] as const)[(Math.floor(now/100)+i)%4]):table.reels;
      const key=symbols.join(',');if(this.reelKeys.get(table.id)===key)continue;this.reelKeys.set(table.id,key);
      const texture=this.reelTextures.get(table.id);if(!texture)continue;
      const ctx=texture.getContext() as CanvasRenderingContext2D;ctx.fillStyle='#eee3bf';ctx.fillRect(0,0,768,256);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 106px Georgia';
      for(let i=0;i<3;i++){drawSlotSymbol(ctx,symbols[i]??'seven',128+i*256);if(i){ctx.fillStyle='#b9a780';ctx.fillRect(i*256,0,5,256);}}
      texture.update();
    }
  }
  setTouch(x: number, z: number) { this.touch = { x, z }; }
  setPaused(paused: boolean) { this.paused = paused; if (paused) this.blur(); }
  setQuality(low: boolean) {
    this.low = low;
    // Scaling is CSS pixels / render pixels: performance is CSS resolution.
    this.engine.setHardwareScalingLevel(1 / (low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)));
    this.shadows.getShadowMap()!.refreshRate = low ? 2 : 1;
    this.shadows.usePercentageCloserFiltering = !low;
    this.updateWaterQuality();
  }
  private updateWaterQuality() {
    if (!this.water) return;
    const active = this.mode !== 'wardrobe' && this.mode !== 'customise' && !this.casinoFocus;
    const rate = active ? (this.low ? 3 : 1) : 0;
    if (this.water.reflectionTexture) this.water.reflectionTexture.refreshRate = rate;
    if (this.water.refractionTexture) this.water.refractionTexture.refreshRate = rate;
  }
  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    this.tableCards?.setReducedMotion(reduced);
    if (this.water) { this.water.waveSpeed = reduced ? 0 : .4; this.water.windForce = reduced ? 0 : 1.4; }
    for (const drop of this.particles) drop.setEnabled(!reduced);
  }
  setInteractionFocus(anchor: CasinoAnchor | null) {
    if (!this.interactionMarker && anchor) {
      this.interactionMarker = MeshBuilder.CreateTorus('Focused station', { diameter: 1.25, thickness: .025, tessellation: 48 }, this.scene);
      const material = this.mat('#d4bd83', 0); material.emissiveColor = new Color3(.16,.13,.07);
      this.interactionMarker.material = material; this.interactionMarker.isPickable = false;
    }
    if (this.interactionMarker) { this.interactionMarker.setEnabled(!!anchor); if (anchor) this.interactionMarker.position.set(anchor.x,.09,anchor.z - (anchor.game === 'slots' ? 1 : anchor.game === 'blackjack' ? 2.1 : 1.6)); }
  }
  private saveView() { this.camera.inertialRadiusOffset = 0; this.savedView = { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.requestedRadius }; }
  private restoreView(smooth = false) {
    this.camera.inertialAlphaOffset = 0; this.camera.inertialBetaOffset = 0; this.camera.inertialRadiusOffset = 0;
    const view = this.savedView ?? { alpha: -Math.PI/2, beta: 1.16, radius: 7.5 };
    const local = this.localId ? this.avatars.get(this.localId)?.root.position : null;
    const target = local ? local.add(new Vector3(0,1.35,0)) : this.camera.target.clone();
    this.requestedRadius = view.radius;
    if (smooth) this.frameCamera(target,view.alpha,view.beta,view.radius);
    else {
      this.framing = null;
      this.camera.setTarget(target,false,true,true);
      this.camera.alpha = view.alpha; this.camera.beta = view.beta;
      this.camera.radius = this.appliedRadius = view.radius;
    }
    this.savedView = null;
  }
  private frameCamera(to: Vector3, alpha: number, beta: number, radius: number) {
    this.framing = { from: this.camera.target.clone(), to, alpha, beta, radius, startAlpha: this.camera.alpha, startBeta: this.camera.beta, startRadius: this.camera.radius, age: this.reducedMotion ? .25 : 0 };
  }
  recenter() { this.savedView = null; this.restoreView(); }
  private keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) { event.preventDefault(); this.keys.add(event.code); }
  };
  private keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private blur = () => { this.keys.clear(); this.touch = { x: 0, z: 0 }; this.onInput?.(0, 0); };
  private visibility = () => { if (document.hidden) this.blur(); };
  private resize = () => {
    this.engine.resize();
    if(this.casinoFocus) {this.camera.viewport=innerWidth<700 && innerHeight>innerWidth?new Viewport(0,.55,1,.45):new Viewport(0,0,innerWidth<1100?.55:.67,1);return;}
    if(this.mode==='playing')this.camera.viewport=new Viewport(0,0,1,1);
    if (this.mode === 'wardrobe') this.camera.viewport = innerWidth < 700 && innerHeight > innerWidth ? new Viewport(0,.52,1,.48) : new Viewport(0,0,innerWidth < 1000 ? .58 : .72,1);
    if (this.mode === 'customise') this.camera.viewport = innerWidth < 700 ? new Viewport(0,.42,1,.58) : new Viewport(0,0,.72,1);
  };
  private update() {
    this.tableCards.update(Math.min(.1,this.engine.getDeltaTime()/1000));
    this.animateCasino();
    const dt = Math.min(.05, this.engine.getDeltaTime() / 1000); this.clock += dt;
    if (this.framing) {
      const frame = this.framing; frame.age = Math.min(.25,frame.age+dt);
      const t = frame.age/.25, ease = t*t*(3-2*t);
      this.camera.setTarget(Vector3.Lerp(frame.from,frame.to,ease),false,true,true);
      const turn = Math.atan2(Math.sin(frame.alpha-frame.startAlpha),Math.cos(frame.alpha-frame.startAlpha));
      this.camera.alpha = frame.startAlpha+turn*ease;
      this.camera.beta = frame.startBeta+(frame.beta-frame.startBeta)*ease;
      this.camera.radius = this.appliedRadius = frame.startRadius+(frame.radius-frame.startRadius)*ease;
      if (t === 1) this.framing = null;
    }
    for (const [i, drop] of this.particles.entries()) {
      drop.setEnabled(!this.reducedMotion && Vector3.DistanceSquared(this.camera.target, new Vector3(0,0,1)) < 900);
      if (!drop.isEnabled()) continue;
      const t = (this.clock * .7 + i / this.particles.length) % 1;
      const angle = (i % 8) / 8 * Math.PI * 2, r = .65 + t * 1.65;
      drop.position.set(Math.cos(angle) * r, .43 + Math.sin(t * Math.PI) * .8, 1 + Math.sin(angle) * r);
    }
    if (this.mode === 'customise' || this.mode === 'wardrobe') { this.preview?.animate(false); return; }
    if (!this.localId || !this.avatars.has(this.localId)) return;
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - this.touch.z;
    const strafe = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.touch.x;
    const a = this.camera.alpha;
    let x = -Math.cos(a) * forward - Math.sin(a) * strafe;
    let z = -Math.sin(a) * forward + Math.cos(a) * strafe;
    if (this.paused || this.remote.get(this.localId)?.seatId) { x = 0; z = 0; }
    const len = Math.max(1, Math.hypot(x, z)); x /= len; z /= len;
    this.motionClock += dt;
    this.inputClock += dt;
    if (this.inputClock >= .05) { this.inputClock = 0; this.onInput?.(x, z); }
    for (const [id, avatar] of this.avatars) {
      const state = this.remote.get(id); if (!state) continue;
      const detailDistance = Math.hypot(avatar.root.position.x-this.camera.target.x,avatar.root.position.z-this.camera.target.z);
      const threshold = this.avatars.size >= 32 ? (this.low ? 4 : 6) : (this.low ? 7 : 10);
      const lowDetail = id !== this.localId && detailDistance > threshold + (avatar.lowDetail ? -2 : 2);
      if (lowDetail !== avatar.lowDetail) {
        const previous = avatar.model;
        const model = this.assets.citizen(id,state,lowDetail);
        model.root.position.copyFrom(avatar.root.position); model.root.rotation.copyFrom(avatar.root.rotation);
        model.root.setEnabled(avatar.root.isEnabled()); model.copyAnimationFrom(previous);
        avatar.label.parent = model.root;
        for (const mesh of previous.meshes) this.shadows.removeShadowCaster(mesh);
        avatar.model = model; avatar.root = model.root; avatar.lowDetail = lowDetail;
        previous.dispose();
        for (const mesh of model.meshes) { mesh.receiveShadows = true; this.shadows.addShadowCaster(mesh); }
      }
      let moving = state.moving;
      if (id === this.localId) {
        const next = move(avatar.root.position, { x, z }, dt);
        const displaced = Math.hypot(next.x-avatar.root.position.x, next.z-avatar.root.position.z) > dt * .08;
        avatar.root.position.x = next.x; avatar.root.position.z = next.z;
        const movingNow = Math.hypot(x, z) > .01;
        // Server reconciliation is gentle while moving and settles exactly after stopping.
        const correction = 1 - Math.exp(-dt * (movingNow ? 2 : 10));
        avatar.root.position.x += (this.desired.x - avatar.root.position.x) * correction;
        avatar.root.position.z += (this.desired.z - avatar.root.position.z) * correction;
        moving = displaced;
        if (this.motionClock >= .1) { this.motionClock = 0; this.onMotion?.(avatar.root.position.x, avatar.root.position.z, moving); }
        const heading = state.seatId ? state.heading : moving ? Math.atan2(x, z) : avatar.root.rotation.y;
        const turn = Math.atan2(Math.sin(heading-avatar.root.rotation.y),Math.cos(heading-avatar.root.rotation.y));
        avatar.root.rotation.y += turn * (1-Math.exp(-dt*14));
        const target = avatar.root.position.add(new Vector3(0, 1.35, 0));
        if(!this.casinoFocus && !this.framing)this.camera.setTarget(Vector3.Lerp(this.camera.target, target, 1 - Math.exp(-dt * 15)), false, true, true);
      } else {
        avatar.root.position.x += (state.x - avatar.root.position.x) * (1 - Math.exp(-dt * 14));
        avatar.root.position.z += (state.z - avatar.root.position.z) * (1 - Math.exp(-dt * 14));
        const delta = Math.atan2(Math.sin(state.heading - avatar.root.rotation.y), Math.cos(state.heading - avatar.root.rotation.y));
        avatar.root.rotation.y += delta * Math.min(1, dt * 12);
        const distance = Vector3.DistanceSquared(avatar.root.position, this.camera.target);
        avatar.label.setEnabled(distance < 225);
      }
      avatar.model.animate(moving, !!state.seatId);
      const animationRange = moving || avatar.model.isWaving ? (this.low ? 900 : 2025) : (this.low ? 36 : 144);
      const animate = id === this.localId || avatar.model.isTransitioning || Vector3.DistanceSquared(avatar.root.position, this.camera.target) < animationRange;
      avatar.model.setAnimationsActive(animate);
    }
    // User zoom remains independent of the temporary obstruction radius.
    if (!this.casinoFocus && !this.framing) {
      const userDelta = this.camera.radius - this.appliedRadius;
      this.requestedRadius = Math.max(3, Math.min(13, this.requestedRadius + userDelta));
      const direction = new Vector3(Math.cos(this.camera.alpha)*Math.sin(this.camera.beta), Math.cos(this.camera.beta), Math.sin(this.camera.alpha)*Math.sin(this.camera.beta));
      const hit = this.scene.pickWithRay(new Ray(this.camera.target, direction, this.requestedRadius), mesh => this.walls.includes(mesh as Mesh));
      const allowed = hit?.hit ? Math.max(.65, hit.distance-.3) : this.requestedRadius;
      const radius = Math.min(this.requestedRadius, allowed);
      this.camera.radius = radius < this.camera.radius ? radius : this.camera.radius + (radius-this.camera.radius)*(1-Math.exp(-dt*6));
      this.appliedRadius = this.camera.radius;
    }
    if (this.clock - this.lastStats > .5) {
      this.lastStats = this.clock;
      const local = this.avatars.get(this.localId)?.root.position ?? this.desired;
      // Distant citizens retain their silhouette without a second shadow draw pass.
      const shadowCitizens = new Set([...this.avatars.entries()].filter(([id]) => id !== this.localId)
        .sort(([,a],[,b]) => Vector3.DistanceSquared(a.root.position,this.camera.target)-Vector3.DistanceSquared(b.root.position,this.camera.target))
        .slice(0,this.low ? 4 : 8).map(([id]) => id));
      for (const [id, avatar] of this.avatars) {
        const near = id === this.localId || shadowCitizens.has(id) && Vector3.DistanceSquared(avatar.root.position, this.camera.target) < (this.low ? 100 : 225);
        for (const mesh of avatar.model.meshes) {
          const list = this.shadows.getShadowMap()!.renderList!;
          if (near && !list.includes(mesh)) this.shadows.addShadowCaster(mesh);
          else if (!near && list.includes(mesh)) this.shadows.removeShadowCaster(mesh);
        }
      }
      this.onStats?.({ fps: Math.round(this.engine.getFps()), district: district(local.x, local.z), x: local.x, z: local.z });
    }
  }
  dispose() {
    this.blur(); window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('resize', this.resize);
    this.resizeObserver.disconnect(); cancelAnimationFrame(this.resizeFrame); this.scene.dispose(); this.engine.dispose();
  }
}
