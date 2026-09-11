import { CreditBoard } from './creditBoard';
import { createMemoriesBoard } from './memoriesBoard';
import { nearMemoriesBoard, MEMORIES_BOARD } from '../../shared/memories';
import { CinemaDisplay } from './cinema';
import { CINEMA_LAYOUT, inCinema } from '../../shared/cinemaLayout';
import type { Programme } from '../../shared/community';
import { nearCreditBoard, type CreditLeaderboard } from '../../shared/creditLeaderboard';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Ray } from '@babylonjs/core/Culling/ray';
import { hopHeight, isHopping, OVERHEAD_SOLIDS } from '../../shared/mobility';
import { WALLS, PLANTING_BEDS, SHIRTS, district, move, type Position, type Profile } from '../../shared/world';

import { type Appearance, type Outfit } from '../../shared/catalog';
import { CASINO_ANCHORS, BLACKJACK_SEAT_OFFSETS, type CasinoAnchor, type CasinoState, type CasinoPrivateState, type SlotSymbol } from '../../shared/casino';
import { CASINO_LAYOUT, floorHeight } from '../../shared/casinoLayout';
import { CasinoLighting } from './casinoLighting';
import { ShopLighting, isShopMesh } from './shopLighting';
import { SHOP_LAYOUT, SHOP_FURNITURE, SHOP_PREVIEW, SHOP_SIGNS, shopPoint, inShop } from '../../shared/shopLayout';
import { PokerTableArt } from './pokerArt';
import { POKER_SEAT_OFFSETS } from '../../shared/pokerLayout';
import { CrapsTableArt } from './crapsArt';
import type { CrapsView } from '../../shared/craps';
import { sampleRouletteMotion, ROULETTE_GEOMETRY } from '../../shared/rouletteMotion';
import { BENCHES } from '../../shared/social';
import { AuthoredAssets, CitizenModel } from './assets';
import { CasinoTableArt, drawSlotSymbol } from './casinoArt';
import { WaterMaterial } from '@babylonjs/materials/water/waterMaterial';
import { FountainWater } from './fountain';
import { LAMP_POSTS, LampPostLighting } from './lampPosts';
import { Vegetation } from './vegetation';
import { DayCycle } from './dayCycle';
import { HDRCubeTexture } from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import '@babylonjs/core/Rendering/boundingBoxRenderer';

export type PlayerView = Position & Profile & Outfit & { profileId: string; seatId: string; heading: number; moving: boolean; wave: number; sprinting?: boolean; jumpAt?: number; emoteId?: string; emoteKind?: string; emoteRole?: number; emoteAt?: number };
export type SceneStats = { fps: number; district: string; x: number; z: number };
type Avatar = { root: TransformNode; model: CitizenModel; label: Mesh; wave: number; seatId: string; lowDetail: boolean; hit: Mesh; emoteId: string };

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
  private lastStats = 0;
  private low = false;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver;
  private resizeFrame = 0;
  private requestedRadius = 7.5;
  private appliedRadius = 7.5;
  private focusRadius = 7;
  private savedView: { alpha: number; beta: number; radius: number } | null = null;
  private interactionMarker: Mesh | null = null;
  private motionClock = 0;
  private framing: { from: Vector3; to: Vector3; alpha: number; beta: number; radius: number; startAlpha: number; startBeta: number; startRadius: number; age: number } | null = null;
  onMotion?: (x: number, z: number, moving: boolean) => void;
  private clock = 0;
  onStats?: (stats: SceneStats) => void;
  onInput?: (x: number, z: number, sprint: boolean) => void;
  onJump?: () => void;
  onSelectPlayer?: (profileId: string) => void;
  onCreditLeaderboard?: () => void;
  onMemory?: () => void;
  onCinema?: () => void;
  onSprintChange?: (enabled: boolean) => void;
  private sprintToggle = false;
  private pointerStarts = new Map<number, { x: number; y: number; cancelled: boolean }>();
  private selectedProfile: string | null = null;
  private selectionRing: Mesh | null = null;
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
  private shopMirror!: MirrorTexture;
  private shopMirrorMeshes: AbstractMesh[] = [];
  private shopReflectionKey = '';
  private water!: WaterMaterial;
  private fountain?: FountainWater;
  private lampPosts: TransformNode[] = [];
  private lampLighting?: LampPostLighting;
  private vegetation?: Vegetation;
  private dayCycle?: DayCycle;
  private casinoFocus: CasinoAnchor | null = null;
  private casinoRoof?: TransformNode;
  private casinoLighting?: CasinoLighting;
  private shopLighting?: ShopLighting;
  private pokerArt?: PokerTableArt;
  private crapsArt?: CrapsTableArt;
  private casinoPrivate: CasinoPrivateState = { rouletteBets: [] };
  private rouletteModels = new Map<string, { anchor: CasinoAnchor; wheel: TransformNode; ball: Mesh }>();
  private casinoState: CasinoState | null = null;
  private casinoTimeOffset = 0;
  private reelTextures = new Map<string, DynamicTexture>();
  private reelKeys = new Map<string, string>();
  private slotSpins = new Map<string,{spinning:boolean;p0:number;settle:number}>();
  private slotOffsets = new Map<string,number>();
  // Deterministic per-machine spin phase from the anchor id; no runtime randomness.
  private slotOffset(id: string): number {
    let hash = [...id].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 7);
    hash = Math.imul(hash ^ hash >>> 16, 0x45d9f3b);
    return ((hash ^ hash >>> 16) >>> 0) % 1000;
  }
  private creditBoard!: CreditBoard;
  private memoriesBoard!: ReturnType<typeof createMemoriesBoard>;
  private cinema!: CinemaDisplay;
  private communityFocus: 'board' | 'cinema' | null = null;
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
    canvas.addEventListener('pointerdown', this.playerPointerDown);
    canvas.addEventListener('pointermove', this.playerPointerMove);
    canvas.addEventListener('pointerup', this.playerPointerUp);
    canvas.addEventListener('pointercancel', this.playerPointerCancel);
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
  private bench(x: number, z: number, rotation: number) { this.placeAsset('bench', x, floorHeight(x,z), z, rotation); }
  private buildWorld(): Mesh {
    this.box('base', 0, -.22, 0, 220, .4, 220, '#b2b6a3', false);
    // Ground is an authored, batched surface: patterned stone, dressed borders and gravel.
    // Flat receivers keep the existing movement plane and avoid self-shadowing overlays.
    const ground = this.assets.place('town-ground', 0, 0, 0);
    for (const mesh of ground.getChildMeshes()) mesh.receiveShadows = true;
    for (const wall of WALLS) {
      const mesh = this.box(wall.kind, wall.x, wall.h / 2, wall.z, wall.w, wall.h, wall.d, '#e6dcc8', wall.kind === 'wall');
      // Invisible bounds retain camera avoidance; the authored masonry supplies the visible shadow.
      if (wall.kind !== 'wall') mesh.visibility = 0;
      this.walls.push(mesh);
    }
    for (const bed of PLANTING_BEDS) {
      this.placeAsset(bed.asset, bed.x, 0, bed.z);
      this.placeAsset('tree', bed.x, .52, bed.z, bed.rotation, bed.treeScale);
    }
    // Authored venue geometry uses the shared collision and surface dimensions.
    this.placeAsset('meridian-shell', 0, 0, 0, Math.PI);
    this.casinoRoof = this.placeAsset('meridian-roof', 0, 0, 0, Math.PI);
    this.placeAsset('meridian-ceiling', 0, 0, 0, Math.PI);
    this.placeAsset('meridian-chandelier', 0, 0, 0, Math.PI);
    this.placeAsset('meridian-interior', 0, 0, 0, Math.PI);
    this.creditBoard = new CreditBoard(this.scene);
    // Shared ceiling bounds keep the camera and hopping body clear of overhead geometry.
    for (const bound of OVERHEAD_SOLIDS) {
      const mesh = this.box(`Overhead camera ${bound.name}`, bound.x, (bound.bottom + bound.top) / 2, bound.z, bound.w, bound.top - bound.bottom, bound.d, '#e6dcc8', false);
      mesh.visibility = 0; this.walls.push(mesh);
    }
    this.placeAsset('casino-sign', 0, 5.4, 13.75, Math.PI);
    this.placeAsset('casino-entry-sign', 0, 3.77, 11.12, Math.PI);
    this.placeAsset('casino-tagline', 0, 4.35, 55.68, Math.PI);
    for (const anchor of CASINO_ANCHORS) {
      const y = floorHeight(anchor.x, anchor.z);
      this.placeAsset(anchor.game === 'roulette' ? 'roulette-table' : anchor.game === 'blackjack' ? 'blackjack-table' : anchor.game === 'craps' ? 'craps-table' : anchor.game === 'poker' ? 'poker-table' : 'slot-machine', anchor.x, y, anchor.z, Math.PI);
      if (anchor.game === 'poker') {
        this.pokerArt = new PokerTableArt(this.scene, anchor);
        for (const seat of POKER_SEAT_OFFSETS) this.placeAsset('casino-chair', anchor.x + seat.x, y, anchor.z + seat.z, Math.PI + seat.heading);
      }
      if (anchor.game === 'craps') this.crapsArt = new CrapsTableArt(this.scene, anchor);
      if (anchor.game === 'blackjack') for (const seat of BLACKJACK_SEAT_OFFSETS) {
        this.placeAsset('casino-chair', anchor.x + seat.x, y, anchor.z + seat.z, Math.PI + seat.heading);
      }
      if (anchor.game === 'slots') this.placeAsset('casino-chair', anchor.x, y, anchor.z - 1.25, Math.PI);
      if (anchor.game === 'roulette') {
        const wheel = this.placeAsset('roulette-wheel', anchor.x - 1.37, y + 1.32, anchor.z, Math.PI);
        const ball = MeshBuilder.CreateSphere(`Ivory roulette ball ${anchor.id}`, { diameter: ROULETTE_GEOMETRY.ballRadius * 2, segments: 16 }, this.scene);
        ball.material = this.mat('#f4edda', .4);
        ball.position.set(anchor.x - .73, y + 1.365, anchor.z);
        this.rouletteModels.set(anchor.id, { anchor, wheel, ball });
      }
      if (anchor.game !== 'slots') continue;
      const texture = new DynamicTexture(`reels-${anchor.id}`, { width: 768, height: 256 }, this.scene, false);
      const material = new StandardMaterial(`reels-${anchor.id}`, this.scene);
      material.diffuseTexture = texture; material.emissiveColor = new Color3(.65, .65, .65); material.specularColor = Color3.Black();
      const screen = MeshBuilder.CreatePlane(`screen-${anchor.id}`, { width: 1.05, height: .45 }, this.scene);
      screen.position.set(anchor.x, y + 1.49, anchor.z - .55); screen.material = material;
      this.reelTextures.set(anchor.id, texture);
      const context = texture.getContext() as CanvasRenderingContext2D;
      context.fillStyle = '#eee3bf'; context.fillRect(0, 0, 768, 256);
      context.fillStyle = '#b9a780';
      for (const x of [128, 384, 640]) { context.beginPath(); context.arc(x, 128, 15, 0, Math.PI * 2); context.fill(); }
      texture.update();
    }
    // Form & Thread: maintained assets and movement share the same local layout.
    for (const asset of ['form-thread-shell', 'form-thread-roof', 'clothing-shop']) this.placeAsset(asset, SHOP_LAYOUT.origin.x, 0, SHOP_LAYOUT.origin.z, -Math.PI / 2);
    for (const [name, point] of [['shop-sign', SHOP_SIGNS.fascia], ['shop-tagline', SHOP_SIGNS.tagline]] as const) this.placeAsset(name, point.x, point.y, point.z, -Math.PI / 2);
    for (const bound of SHOP_FURNITURE) {
      const mesh = this.box(`Shop camera ${bound.name}`, bound.x, bound.h / 2, bound.z, bound.w, bound.h, bound.d, '#e6dcc8', false);
      mesh.visibility = 0; this.walls.push(mesh);
    }
    // Window looks use the current clothing catalogue and the character's established identity.
    for (const [index, look] of SHOP_LAYOUT.mannequins.entries()) {
      const model = this.assets.citizen(`shop-mannequin-${index + 1}`, { name: '', shirt: index, skin: index % 3, top: look.top, bottoms: look.bottoms, shoes: look.shoes }, true);
      const p = shopPoint(look.x, look.y, look.height);
      model.root.position.set(p.x, p.y, p.z); model.root.rotation.y = -Math.PI / 2;
      for (const group of model.entries.animationGroups) if (group.name.endsWith('/Idle')) { group.setWeightForAllAnimatables(1); group.goToFrame(group.from); }
      model.setAnimationsActive(false);
      for (const mesh of model.meshes) { mesh.receiveShadows = true; this.shadows.addShadowCaster(mesh); }
    }
    // Western streetscape and distant skyline. These buildings are outside the walkable area.
    for (let i = 0; i < 7; i++) {
      const x = -36, z = -24 + i * 8, h = 8 + (i % 3) * 2.4;
      this.box('neighbourhood', x, h / 2, z, 14, h, 7.6, ['#bcb2a0', '#a4aa9e', '#c8b49c'][i % 3]);
      this.box('cornice', -28.9, h - .6, z, .3, .22, 7.9, '#e0d7c3');
      for (let floor = 2; floor < h - 1; floor += 2.5) for (const offset of [-2, .3, 2.5]) this.box('window', -28.9, floor, z + offset, .06, 1.5, 1.2, '#667874', false);
    }
    for (let i = 0; i < 9; i++) {
      const h = 12 + (i * 7 % 16);
      this.box('skyline', -50 + i * 13, h / 2, 80 + (i % 3) * 7, 9, h, 12, ['#a2b1ae', '#b3b9af', '#c3c4b7'][i % 3], false);
      for (let floor = 3; floor < h; floor += 3) this.box('skyline band', -50 + i * 13, floor, 73.95 + (i % 3) * 7, 8, .65, .04, '#90a5a3', false);
    }
    this.lampPosts = LAMP_POSTS.map(({ x, z }) => this.placeAsset('lamp', x, 0, z));
    const cinemaAsset = this.placeAsset('cinema',0,0,0);
    // glTF's left-handed conversion mirrors X; this world-space asset uses town X coordinates.
    cinemaAsset.scaling.x = -1;
    for (const point of CINEMA_LAYOUT.trees) this.placeAsset('tree',point.x,0,point.z,0,.8);
    this.cinema = new CinemaDisplay(this.scene);
    for (const bench of BENCHES) this.bench(bench.x, bench.z, bench.heading);
    this.memoriesBoard = createMemoriesBoard(this.scene);
    for (const mesh of this.memoriesBoard.root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    this.placeAsset('fountain', 0, 0, 1);
    this.fountain = new FountainWater(this.scene);
    this.water = this.fountain.water;
    this.setReducedMotion(this.reducedMotion);
    this.updateWaterQuality();
    this.placeAsset('signpost', -5.8, .01, -15, Math.PI);
    return this.fountain.surface;
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
    this.shopMirror = new MirrorTexture('Form & Thread reflection', 512, this.scene, true);
    this.shopMirror.mirrorPlane = new Plane(1, 0, 0, -SHOP_LAYOUT.origin.x - SHOP_LAYOUT.preview.mirrorY);
    this.shopMirror.level = .8;
    for (const mesh of this.scene.meshes) if (mesh.name.startsWith('clothing-shop/') && mesh.material?.name === 'Shop mirror') {
      const material = new StandardMaterial('Fitting room mirror', this.scene);
      material.diffuseColor = Color3.Black(); material.reflectionTexture = this.shopMirror; mesh.material = material;
    }
    this.shopMirrorMeshes = this.scene.meshes.filter(mesh => isShopMesh(mesh.name) && mesh.material?.name !== 'Fitting room mirror');
    this.shopMirror.renderList = this.shopMirrorMeshes;
    this.studio.setEnabled(false);
    this.vegetation = new Vegetation(this.scene);
    this.vegetation.setQuality(this.low);
    this.vegetation.setReducedMotion(this.reducedMotion);
    this.lampLighting = new LampPostLighting(this.scene, this.lampPosts);
    this.cinema.bindLighting(this.scene.getTransformNodeByName('cinema-instance')!,this.scene.transformNodes.filter(node=>node.name==='bench-instance'&&node.position.x<-12),this.lampLighting.glow);
    this.casinoLighting = new CasinoLighting(this.scene, this.lampLighting.glow);
    this.casinoLighting.setReducedMotion(this.reducedMotion);
    this.shopLighting = new ShopLighting(this.scene, this.lampLighting.glow);
    this.lampLighting.setQuality(this.low);
    this.dayCycle = new DayCycle(this.scene, this.scene.getLightByName('sun') as DirectionalLight, this.scene.getLightByName('sky') as HemisphericLight, this.lampLighting);
    if (this.casinoState) this.dayCycle.synchronise(Date.now() + this.casinoTimeOffset);
    await this.scene.whenReadyAsync();
    this.resize();
  }
  customise(profile: Appearance, shop = false, wardrobe = false) {
    if (this.mode === 'playing') this.saveView();
    this.framing = null;
    this.previewOrigin.set(shop ? SHOP_PREVIEW.x : 80, shop ? SHOP_PREVIEW.y : .04, shop ? SHOP_PREVIEW.z : 0);
    this.previewAlpha = shop ? Math.PI : -Math.PI/2; this.previewRotation = shop ? -Math.PI/2 : Math.PI;
    this.mode = wardrobe ? 'wardrobe' : 'customise'; this.scene.shadowsEnabled = false; this.updateWaterQuality(); this.blur(); this.studio.setEnabled(!shop);
    if (this.localId) this.avatars.get(this.localId)?.root.setEnabled(false);
    this.preview?.dispose(); this.preview = this.assets.citizen('preview', profile);
    this.preview.root.position.copyFrom(this.previewOrigin);
    this.preview.root.rotation.y = this.previewRotation;
    if (!shop) this.mirror.renderList = [...this.preview.meshes, ...this.studio.getChildMeshes().filter(mesh => mesh.material?.name !== 'Changing room mirror')];
    this.camera.setTarget(this.previewOrigin.add(new Vector3(0,.98,0)), false, true, true);
    this.camera.alpha = this.previewAlpha; this.camera.beta = 1.46; this.camera.radius = 3.65;
    this.camera.lowerRadiusLimit = .6; this.camera.upperRadiusLimit = 4.3;
    // The fitting view looks through the department aisle; its right-hand rail limits orbit.
    // Turn controls rotate the character independently for a complete outfit inspection.
    this.camera.lowerAlphaLimit = this.previewAlpha - (shop ? .2 : .75);
    this.camera.upperAlphaLimit = this.previewAlpha + (shop ? .04 : .75);
    this.camera.lowerBetaLimit = shop ? .9 : .45;
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
    const hit = MeshBuilder.CreateCapsule(`player-hit:${id}`, { height: 2.1, radius: .42, tessellation: 8, subdivisions: 1 }, this.scene);
    hit.parent = root; hit.position.y = 1.05; hit.visibility = 0; hit.isPickable = true;
    return { root, model, label, hit, wave: 0, seatId: '', lowDetail: false, emoteId: '' };
  }
  enter(id: string) {
    this.avatars.get(id)?.root.setEnabled(true);
    this.casinoFocus=null;
    this.mode = 'playing'; this.scene.shadowsEnabled = true; this.updateWaterQuality(); this.preview?.dispose(); this.preview = null;
    this.studio.setEnabled(false); this.mirror.renderList = [];
    this.camera.viewport = new Viewport(0, 0, 1, 1);
    this.camera.lowerRadiusLimit = .65; this.camera.lowerBetaLimit = .45; this.camera.upperBetaLimit = 1.43;
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
        avatar.root.position.set(player.x, floorHeight(player.x, player.z), player.z); avatar.root.rotation.y = player.heading;
        this.avatars.set(id, avatar);
      }
      const avatar = this.avatars.get(id)!;
      avatar.model.apply(player);
      if (avatar.emoteId !== (player.emoteId ?? '')) {
        avatar.emoteId = player.emoteId ?? '';
        if (id === this.localId && avatar.emoteId) this.blur();
      }
      if (avatar.seatId !== player.seatId) { avatar.seatId = player.seatId; avatar.root.position.set(player.x, floorHeight(player.x, player.z), player.z); avatar.root.rotation.y = player.heading; }
      if (id === this.localId) {
        const error = Math.hypot(avatar.root.position.x - player.x, avatar.root.position.z - player.z);
        if (error > 2) avatar.root.position.set(player.x, floorHeight(player.x, player.z), player.z);
        if (created) {
          this.camera.setTarget(new Vector3(player.x, floorHeight(player.x, player.z) + 1.35, player.z), false, true, true);
          this.camera.radius = this.appliedRadius = this.requestedRadius;
        }
        this.desired = { x: player.x, z: player.z };
        avatar.label.setEnabled(false);
      }
      if (avatar.wave !== player.wave) { avatar.wave = player.wave; avatar.model.wave(); }
    }
    for (const [id, avatar] of this.avatars) if (!players.has(id)) { avatar.label.material?.dispose(false, true); avatar.model.dispose(); this.avatars.delete(id); }
  }
  syncCreditLeaderboard(snapshot: CreditLeaderboard | null, unavailable: boolean) { this.creditBoard?.sync(snapshot, unavailable); }
  syncCommunity(programme: Programme | null) {
    this.cinema?.sync(programme);
    this.memoriesBoard?.sync(programme?.images ?? []);
  }
  focusCommunity(view: 'board' | 'cinema' | null) {
    if(view && !this.communityFocus)this.saveView();
    const previous=this.communityFocus;this.communityFocus=view;this.blur();
    if(view==='board')this.frameCamera(new Vector3(MEMORIES_BOARD.x,1.93,MEMORIES_BOARD.z),-Math.PI/2,1.43,4.2);
    else if(view==='cinema')this.frameCamera(new Vector3(CINEMA_LAYOUT.screen.x,3.7,CINEMA_LAYOUT.screen.z),0,1.43,12);
    else if(previous)this.restoreView(true);
  }
  syncCasino(state: CasinoState) { this.casinoState=state; this.casinoTimeOffset=state.serverTime-Date.now(); this.tableCards.sync(state); this.pokerArt?.sync(state.tables.find(t=>t.game==='poker') ?? null,this.casinoPrivate); this.dayCycle?.synchronise(state.serverTime); }
  syncCasinoPrivate(value:CasinoPrivateState){this.casinoPrivate=value;this.tableCards.syncPrivate(value);this.pokerArt?.sync(this.casinoState?.tables.find(t=>t.game==='poker') ?? null,value);}
  focusCasino(anchor: CasinoAnchor | null) {
    if (anchor && !this.casinoFocus) this.saveView();
    this.casinoFocus=anchor;this.blur();
    this.updateWaterQuality();
    if(anchor) {
      this.frameCamera(new Vector3(anchor.x,floorHeight(anchor.x,anchor.z)+1.1,anchor.z), -Math.PI/2, anchor.game==='roulette'||anchor.game==='craps'||anchor.game==='poker'?.64:anchor.game==='slots'?1.3:.9, anchor.game==='craps'||anchor.game==='poker'?6.4:anchor.game==='roulette'?7:anchor.game==='slots'?4.2:5.3);
      this.camera.lowerRadiusLimit=.65;this.camera.upperRadiusLimit=8;
    } else {this.camera.lowerRadiusLimit=.65;this.camera.upperRadiusLimit=13;this.restoreView(true);}
    this.resize();
  }
  private animateCasino() {
    if(!this.casinoState)return;
    const now=this.dayCycle?.clock.now() ?? Date.now()+this.casinoTimeOffset;
    this.crapsArt?.update(this.casinoState.tables.find(table=>table.game==='craps') as CrapsView|undefined ?? null,this.casinoPrivate,now,this.reducedMotion);
    for (const roulette of this.casinoState.tables) if (roulette.game === 'roulette') {
      const model = this.rouletteModels.get(roulette.id); if (!model) continue;
      const previous = roulette.history[0] ?? 0;
      const pose = this.reducedMotion
        ? sampleRouletteMotion(null, now, roulette.phase === 'result' ? roulette.result ?? previous : previous)
        : sampleRouletteMotion(roulette.motion, now, roulette.result ?? previous);
      model.wheel.rotation.y = pose.wheelAngle;
      model.ball.position.set(model.anchor.x-1.37+Math.cos(pose.ballAngle)*pose.radius,CASINO_LAYOUT.floor+1.32+pose.height,model.anchor.z+Math.sin(pose.ballAngle)*pose.radius);
    }
    const cycle:readonly SlotSymbol[]=['cherry','lemon','bar','seven'];
    for(const table of this.casinoState.tables) if(table.game==='slots') {
      const spin=this.slotSpins.get(table.id)??{spinning:false,p0:0,settle:0};
      let offset=this.slotOffsets.get(table.id);
      if(offset===undefined){offset=this.slotOffset(table.id);this.slotOffsets.set(table.id,offset);}
      const spinning=table.phase==='spinning';
      let symbols:readonly (SlotSymbol|undefined)[];
      if(spinning&&!this.reducedMotion) {
        const p=(now+offset)/100;
        symbols=Array.from({length:3},(_,i)=>cycle[(Math.floor(p)+i)%4]);
        spin.p0=Math.floor(p);spin.settle=0;
      } else if(!this.reducedMotion&&!spinning&&table.reels.length===3&&(spin.settle?now<spin.settle+300:spin.spinning)) {
        // Brief deceleration when the published result lands, so the reels appear to stop.
        if(!spin.settle){spin.settle=now;spin.p0++;}
        const u=Math.min(1,(now-spin.settle)/300);
        symbols=Array.from({length:3},(_,i)=>cycle[(Math.floor(spin.p0+3*(u-u*u/2))+i)%4]);
        if(u===1)spin.settle=0;
      } else {symbols=table.reels;spin.settle=0;}
      spin.spinning=spinning;this.slotSpins.set(table.id,spin);
      const key=symbols.join(',');if(this.reelKeys.get(table.id)===key)continue;this.reelKeys.set(table.id,key);
      const texture=this.reelTextures.get(table.id);if(!texture)continue;
      const ctx=texture.getContext() as CanvasRenderingContext2D;ctx.fillStyle='#eee3bf';ctx.fillRect(0,0,768,256);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 106px Georgia';
      for(let i=0;i<3;i++){const symbol=symbols[i];if(symbol)drawSlotSymbol(ctx,symbol,128+i*256);else{ctx.fillStyle='#b9a780';ctx.beginPath();ctx.arc(128+i*256,128,15,0,Math.PI*2);ctx.fill();}if(i){ctx.fillStyle='#b9a780';ctx.fillRect(i*256,0,5,256);}}
      texture.update();
    }
  }
  syncInteractionTime(serverTime: number) { if (Number.isFinite(serverTime)) this.casinoTimeOffset = serverTime - Date.now(); }
  setSprint(enabled: boolean) { this.sprintToggle = enabled && !this.paused; this.onSprintChange?.(this.sprintToggle); }
  stopMovement() { this.blur(); }
  jump() {
    const player = this.remote.get(this.localId ?? '');
    if (this.mode === 'playing' && !this.paused && player && !player.seatId && !player.emoteId && !isHopping(player.jumpAt ?? 0, Date.now() + this.casinoTimeOffset)) this.onJump?.();
  }
  selectPlayer(profileId: string | null) {
    this.selectedProfile = profileId;
    if (profileId && !this.selectionRing) {
      this.selectionRing = MeshBuilder.CreateTorus('selected-neighbour', { diameter: .95, thickness: .025, tessellation: 40 }, this.scene);
      const mat = new StandardMaterial('selected-neighbour-colour', this.scene); mat.diffuseColor = Color3.FromHexString('#e3ebbb'); mat.emissiveColor = mat.diffuseColor.scale(.5); mat.disableLighting = true;
      this.selectionRing.material = mat; this.selectionRing.isPickable = false;
    }
    this.selectionRing?.setEnabled(false);
  }
  private playerPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.pointerStarts.set(event.pointerId, { x: event.clientX, y: event.clientY, cancelled: this.pointerStarts.size > 0 });
    if (this.pointerStarts.size > 1) for (const start of this.pointerStarts.values()) start.cancelled = true;
  };
  private playerPointerMove = (event: PointerEvent) => {
    const start = this.pointerStarts.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.cancelled = true;
  };
  private playerPointerCancel = (event: PointerEvent) => { this.pointerStarts.delete(event.pointerId); };
  private playerPointerUp = (event: PointerEvent) => {
    const start = this.pointerStarts.get(event.pointerId); this.pointerStarts.delete(event.pointerId);
    if (!start || start.cancelled || this.paused || this.mode !== 'playing' || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    const rect = this.canvas.getBoundingClientRect();
    const proxies = new Map([...this.avatars.entries()].filter(([id]) => id !== this.localId).map(([id, avatar]) => [avatar.hit, id]));
    const citizenMeshes = new Set([...this.avatars.values()].flatMap(avatar => avatar.model.meshes));
    const hit = this.scene.pick(event.clientX - rect.left, event.clientY - rect.top, mesh => proxies.has(mesh as Mesh) || this.walls.includes(mesh as Mesh) || mesh.isPickable && mesh.isEnabled() && mesh.isVisible && mesh.visibility > 0 && !citizenMeshes.has(mesh) && !mesh.name.startsWith('player-hit:'));
    const local = this.remote.get(this.localId ?? '');
    if (local && nearMemoriesBoard(local.x, local.z) && hit?.pickedMesh && this.memoriesBoard?.root.getChildMeshes().includes(hit.pickedMesh)) {
      this.blur(); this.onMemory?.(); return;
    }
    if(local && inCinema(local.x,local.z) && hit?.pickedMesh && (hit.pickedMesh.name.startsWith('cinema/') || this.cinema?.root.getChildMeshes().includes(hit.pickedMesh))) {
      this.blur();this.onCinema?.();return;
    }
    if (local && nearCreditBoard(local.x, local.z) && hit?.pickedMesh && this.creditBoard?.root.getChildMeshes().includes(hit.pickedMesh)) {
      this.blur(); this.onCreditLeaderboard?.(); return;
    }
    const id = hit?.pickedMesh && proxies.get(hit.pickedMesh as Mesh), player = id && this.remote.get(id);
    if (player) { this.blur(); this.onSelectPlayer?.(player.profileId); }
  };
  setTouch(x: number, z: number) { this.touch = { x, z }; }
  setPaused(paused: boolean) { this.paused = paused; if (paused) this.blur(); }
  setQuality(low: boolean) {
    this.low = low;
    // Scaling is CSS pixels / render pixels: performance is CSS resolution.
    this.engine.setHardwareScalingLevel(1 / (low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75)));
    // Keep the depth-sampler type stable across quality changes (including shader fallbacks).
    // Changing PCF to a colour shadow map leaves stale sampler bindings in WebKit.
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = low ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_HIGH;
    const shadowSize = low ? 1024 : 2048;
    if (this.shadows.mapSize !== shadowSize) this.shadows.mapSize = shadowSize;
    this.shadows.getShadowMap()!.refreshRate = low ? 2 : 1;
    this.lampLighting?.setQuality(low);
    this.vegetation?.setQuality(low);
    this.updateWaterQuality();
  }
  private updateWaterQuality() {
    if (!this.water) return;
    const active = this.mode !== 'wardrobe' && this.mode !== 'customise' && !this.casinoFocus;
    this.fountain?.setQuality(this.low, active);
  }
  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    this.creditBoard?.setReducedMotion(reduced);
    this.tableCards?.setReducedMotion(reduced);
    this.fountain?.setReducedMotion(reduced);
    this.vegetation?.setReducedMotion(reduced);
    this.casinoLighting?.setReducedMotion(reduced);
  }
  setInteractionFocus(anchor: CasinoAnchor | null) {
    if (!this.interactionMarker && anchor) {
      this.interactionMarker = MeshBuilder.CreateTorus('Focused station', { diameter: 1.25, thickness: .025, tessellation: 48 }, this.scene);
      const material = this.mat('#d4bd83', 0); material.emissiveColor = new Color3(.16,.13,.07);
      this.interactionMarker.material = material; this.interactionMarker.isPickable = false;
    }
    if (this.interactionMarker) { this.interactionMarker.setEnabled(!!anchor); if (anchor) this.interactionMarker.position.set(anchor.x,floorHeight(anchor.x,anchor.z)+.09,anchor.z - (anchor.game === 'slots' ? 1 : anchor.game === 'blackjack' ? 2.1 : 1.6)); }
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
    if (this.casinoFocus) this.focusRadius = radius;
    this.framing = { from: this.camera.target.clone(), to, alpha, beta, radius, startAlpha: this.camera.alpha, startBeta: this.camera.beta, startRadius: this.camera.radius, age: this.reducedMotion ? .25 : 0 };
  }
  recenter() { this.savedView = null; this.restoreView(); }
  private keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); this.jump(); return; }
    if (['ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) { event.preventDefault(); this.keys.add(event.code); }
  };
  private keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private blur = () => { this.keys.clear(); this.touch = { x: 0, z: 0 }; this.pointerStarts.clear(); this.setSprint(false); this.onInput?.(0, 0, false); };
  private visibility = () => { if (document.hidden) this.blur(); };
  private resize = () => {
    this.engine.resize();
    if(this.casinoFocus) {this.camera.viewport=innerWidth<700 && innerHeight>innerWidth?new Viewport(0,.72,1,.28):new Viewport(0,0,innerHeight<=620?1-Math.min(460,innerWidth*.55)/innerWidth-.02:innerWidth<1100?.55:1-Math.max(.33,476/innerWidth),1);return;}
    if(this.mode==='playing')this.camera.viewport=new Viewport(0,0,1,1);
    if (this.mode === 'wardrobe') this.camera.viewport = innerWidth < 700 && innerHeight > innerWidth ? new Viewport(0,.52,1,.48) : new Viewport(0,0,innerWidth < 1000 ? .58 : .72,1);
    if (this.mode === 'customise') this.camera.viewport = innerWidth < 700 ? new Viewport(0,.42,1,.58) : new Viewport(0,0,.72,1);
  };
  private update() {
    this.cinema?.update(this.dayCycle?.state.lamps ?? 0);
    this.tableCards.update(Math.min(.1,this.engine.getDeltaTime()/1000));
    this.animateCasino();
    const dt = Math.min(.05, this.engine.getDeltaTime() / 1000); this.clock += dt;
    const boardViewer = this.remote.get(this.localId ?? '');
    this.creditBoard?.update(dt * 1000, !document.hidden && !!boardViewer && nearCreditBoard(boardViewer.x, boardViewer.z));
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
    this.dayCycle?.update(this.mode === 'customise' || this.mode === 'wardrobe');
    this.casinoLighting?.update(this.dayCycle?.clock.now() ?? Date.now(), this.dayCycle?.state.lamps ?? 0);
    const shopCharacters = [...this.avatars.values()].map(avatar => avatar.root).concat(this.preview ? [this.preview.root] : []).filter(root => root.isEnabled() && inShop(root.position.x, root.position.z));
    this.shopLighting?.setCharacters(shopCharacters);
    const reflectionKey = shopCharacters.map(root => root.uniqueId).join(',');
    if (reflectionKey !== this.shopReflectionKey && this.shopMirror) {
      this.shopReflectionKey = reflectionKey;
      this.shopMirror.renderList = [...this.shopMirrorMeshes, ...shopCharacters.flatMap(root => root.getChildMeshes())];
    }
    this.vegetation?.update(dt, !document.hidden && this.mode !== 'customise' && this.mode !== 'wardrobe');
    this.fountain?.update(dt, this.camera);
    if (this.mode === 'customise' || this.mode === 'wardrobe') { this.preview?.animate(false); return; }
    if (!this.localId || !this.avatars.has(this.localId)) return;
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - this.touch.z;
    const strafe = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.touch.x;
    const a = this.camera.alpha;
    const now = Date.now() + this.casinoTimeOffset;
    const sprint = !this.paused && (this.sprintToggle || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    let x = -Math.cos(a) * forward - Math.sin(a) * strafe;
    let z = -Math.sin(a) * forward + Math.cos(a) * strafe;
    if (this.paused || this.remote.get(this.localId)?.seatId) { x = 0; z = 0; }
    const len = Math.max(1, Math.hypot(x, z)); x /= len; z /= len;
    this.motionClock += dt;
    this.inputClock += dt;
    if (this.inputClock >= .05) { this.inputClock = 0; this.onInput?.(x, z, sprint); }
    this.selectionRing?.setEnabled(false);
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
        avatar.label.parent = model.root; avatar.hit.parent = model.root;
        for (const mesh of previous.meshes) this.shadows.removeShadowCaster(mesh);
        avatar.model = model; avatar.root = model.root; avatar.lowDetail = lowDetail;
        previous.dispose();
        for (const mesh of model.meshes) { mesh.receiveShadows = true; this.shadows.addShadowCaster(mesh); }
      }
      let moving = state.moving;
      const hopping = isHopping(state.jumpAt ?? 0, now);
      if (state.emoteId) {
        const blend = now >= (state.emoteAt ?? 0) ? 1 : 1 - Math.exp(-dt * 22);
        avatar.root.position.x += (state.x - avatar.root.position.x) * blend;
        avatar.root.position.z += (state.z - avatar.root.position.z) * blend;
        const turn = Math.atan2(Math.sin(state.heading - avatar.root.rotation.y), Math.cos(state.heading - avatar.root.rotation.y));
        avatar.root.rotation.y += turn * blend; moving = false;
      } else if (id === this.localId) {
        const next = move(avatar.root.position, { x, z, sprint }, dt, hopping);
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
        avatar.root.position.y = floorHeight(avatar.root.position.x, avatar.root.position.z);
        const target = avatar.root.position.add(new Vector3(0, 1.35, 0));
        if(!this.casinoFocus && !this.communityFocus && !this.framing)this.camera.setTarget(Vector3.Lerp(this.camera.target, target, 1 - Math.exp(-dt * 15)), false, true, true);
      } else {
        avatar.root.position.x += (state.x - avatar.root.position.x) * (1 - Math.exp(-dt * 14));
        avatar.root.position.z += (state.z - avatar.root.position.z) * (1 - Math.exp(-dt * 14));
        const delta = Math.atan2(Math.sin(state.heading - avatar.root.rotation.y), Math.cos(state.heading - avatar.root.rotation.y));
        avatar.root.rotation.y += delta * Math.min(1, dt * 12);
        const distance = Vector3.DistanceSquared(avatar.root.position, this.camera.target);
        avatar.label.setEnabled(distance < 225);
      }
      avatar.root.position.y = floorHeight(avatar.root.position.x, avatar.root.position.z) + hopHeight(state.jumpAt ?? 0, now);
      avatar.label.setEnabled(id !== this.localId && Vector3.DistanceSquared(avatar.root.position, this.camera.target) < 225);
      avatar.model.animate(moving, !!state.seatId, { sprinting: id === this.localId ? sprint : !!state.sprinting, jumpAt: hopping ? state.jumpAt : undefined, emoteKind: state.emoteKind, emoteRole: state.emoteRole, emoteAt: state.emoteAt, now });
      if (this.selectionRing && state.profileId === this.selectedProfile) { this.selectionRing.setEnabled(true); this.selectionRing.position.set(avatar.root.position.x, floorHeight(avatar.root.position.x, avatar.root.position.z) + .035, avatar.root.position.z); }
      const animationRange = moving || avatar.model.isWaving ? (this.low ? 900 : 2025) : (this.low ? 36 : 144);
      const animate = id === this.localId || !!state.emoteId || hopping || avatar.model.isTransitioning || Vector3.DistanceSquared(avatar.root.position, this.camera.target) < animationRange;
      avatar.model.setAnimationsActive(animate);
    }
    // Keep the camera within enclosed rooms, including table views and their transitions.
    // Retain the user's desired zoom so the view opens back out after the stairs.
    {
      const userDelta = this.camera.radius - this.appliedRadius;
      if (!this.framing) {
        if (this.casinoFocus) this.focusRadius = Math.max(2.5, Math.min(8, this.focusRadius + userDelta));
        else this.requestedRadius = Math.max(3, Math.min(13, this.requestedRadius + userDelta));
      }
      const desired = this.framing || this.communityFocus ? this.camera.radius : this.casinoFocus ? this.focusRadius : this.requestedRadius;
      const direction = new Vector3(Math.cos(this.camera.alpha)*Math.sin(this.camera.beta), Math.cos(this.camera.beta), Math.sin(this.camera.alpha)*Math.sin(this.camera.beta));
      const hit = this.scene.pickWithRay(new Ray(this.camera.target, direction, desired), mesh => this.walls.includes(mesh as Mesh));
      const allowed = hit?.hit ? Math.max(.65, hit.distance-.3) : desired;
      const radius = Math.min(desired, allowed);
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
    this.canvas.removeEventListener('pointerdown', this.playerPointerDown); this.canvas.removeEventListener('pointermove', this.playerPointerMove);
    this.canvas.removeEventListener('pointerup', this.playerPointerUp); this.canvas.removeEventListener('pointercancel', this.playerPointerCancel);
    this.resizeObserver.disconnect(); cancelAnimationFrame(this.resizeFrame); this.scene.dispose(); this.engine.dispose();
  }
}
