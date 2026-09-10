import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import { SHIRTS, SKINS } from '../../shared/world';
import { clothingItem, STARTER_OUTFIT, type Appearance } from '../../shared/catalog';

export class CitizenModel {
  readonly root: TransformNode;
  readonly entries: InstantiatedEntries;
  private animation = '';
  private weights = new Map<string, number>();
  private waving = false;
  private appearanceKey = '';
  private ownedMaterials: Material[] = [];
  private citizenMeshes: AbstractMesh[] = [];
  constructor(container: AssetContainer, scene: Scene, name: string, profile: Appearance) {
    this.root = new TransformNode(name, scene);
    this.entries = container.instantiateModelsToScene(original => `${name}/${original}`, true, { doNotInstantiate: true });
    for (const node of this.entries.rootNodes) node.parent = this.root;
    this.citizenMeshes = this.root.getChildMeshes();
    this.ownedMaterials = [...new Set(this.meshes.map(mesh => mesh.material).filter((material): material is Material => !!material))];
    for (const group of this.entries.animationGroups) {
      group.enableBlending = true;
      group.blendingSpeed = .12;
      if (group.name.endsWith('/Wave')) group.onAnimationGroupEndObservable.add(() => { this.waving = false; });
    }
    this.apply(profile);
    this.animate(false);
  }
  get meshes(): AbstractMesh[] { return this.citizenMeshes; }
  get isWaving() { return this.waving; }
  get isTransitioning() { return [...this.weights.values()].some(weight => weight > 0 && weight < 1); }
  apply(profile: Appearance) {
    const key = JSON.stringify([profile.shirt, profile.skin, profile.top, profile.bottoms, profile.shoes]);
    if (this.appearanceKey === key) return;
    this.appearanceKey = key;
    const worn = [clothingItem(profile.top || STARTER_OUTFIT.top)!, clothingItem(profile.bottoms || STARTER_OUTFIT.bottoms)!, clothingItem(profile.shoes || STARTER_OUTFIT.shoes)!];
    for (const mesh of this.meshes) {
      const material = mesh.material;
      if (!(material instanceof PBRMaterial)) continue;
      const model = /wear_([a-z]+)__/.exec(material.name)?.[1];
      const item = worn.find(item => item?.model === model);
      if (model) mesh.setEnabled(!!item);
      if (material.name.endsWith('Skin')) material.albedoColor = Color3.FromHexString(SKINS[profile.skin]).toLinearSpace();
      if (!item) continue;
      const mainSurface = item.slot === 'top' ? /Cloth_Main|Cloth_Rib/.test(material.name) : item.slot === 'bottoms' ? material.name.endsWith('Trousers') : material.name.endsWith('Shoe_Leather');
      if (mainSurface) material.albedoColor = Color3.FromHexString(item.id === STARTER_OUTFIT.top ? SHIRTS[profile.shirt] : item.colour).toLinearSpace();
    }
  }
  private animationsActive = true;
  setAnimationsActive(active: boolean) {
    if (active === this.animationsActive) return;
    this.animationsActive = active;
    for (const group of this.entries.animationGroups) if (group.isStarted) {
      if (active) group.play(group.loopAnimation); else group.pause();
    }
  }
  wave() { this.waving = true; }
  animate(moving: boolean, seated = false) {
    // Walking cancels the greeting; its completion follows the clip, not a frame-rate-dependent timer.
    if (moving || seated) this.waving = false;
    const next = seated ? 'Sit' : this.waving ? 'Wave' : moving ? 'Walk' : 'Idle';
    if (next !== this.animation) {
      this.animation = next;
      const incoming = this.entries.animationGroups.find(group => group.name.endsWith(`/${next}`) || group.name === next);
      if (incoming) { incoming.start(next !== 'Wave', 1); incoming.setWeightForAllAnimatables(this.weights.get(incoming.name) ?? 0); if (!this.animationsActive) incoming.pause(); }
    }
    const blend = Math.min(1, this.root.getScene().getEngine().getDeltaTime()/180);
    for (const group of this.entries.animationGroups) {
      const active = group.name.endsWith(`/${next}`) || group.name === next;
      const previous = this.weights.get(group.name) ?? 0;
      const weight = active ? Math.min(1,previous+blend) : Math.max(0,previous-blend);
      this.weights.set(group.name,weight);
      if (group.isStarted) { group.setWeightForAllAnimatables(weight); if (!active && weight === 0) group.stop(); }
    }
  }

  copyAnimationFrom(source: CitizenModel) {
    this.animation = source.animation; this.waving = source.waving;
    for (const group of this.entries.animationGroups) {
      group.stop();
      const original = source.entries.animationGroups.find(item => item.name.split('/').pop() === group.name.split('/').pop());
      if (!original?.isStarted) continue;
      const weight = source.weights.get(original.name) ?? 0;
      group.start(original.loopAnimation, original.speedRatio);
      group.goToFrame(original.animatables[0]?.masterFrame ?? original.from);
      group.setWeightForAllAnimatables(weight); this.weights.set(group.name,weight);
    }
    this.setAnimationsActive(source.animationsActive);
  }
  dispose() { this.entries.dispose(); this.root.dispose(); for (const material of this.ownedMaterials) material.dispose(false, false); this.ownedMaterials = []; }
}

export class AuthoredAssets {
  private containers = new Map<string, AssetContainer>();
  constructor(private scene: Scene) {}
  async load() {
    await Promise.all(['citizen', 'citizen-lod', 'town-ground', 'changing-room', 'fountain', 'bench', 'tree', 'planter', 'entrance-planter', 'lamp', 'clothing-shop', 'casino-kit', 'roulette-wheel', 'signpost', 'shop-sign', 'shop-tagline', 'casino-sign', 'casino-entry-sign', 'casino-tagline'].map(async name => {
      this.containers.set(name, await LoadAssetContainerAsync(`/models/${name}.glb`, this.scene));
    }));
  }
  citizen(name: string, profile: Appearance, lowDetail = false) { return new CitizenModel(this.containers.get(lowDetail ? 'citizen-lod' : 'citizen')!, this.scene, name, profile); }
  place(name: string, x: number, y: number, z: number, rotation = 0, scale = 1): TransformNode {
    const root = new TransformNode(`${name}-instance`, this.scene);
    // Unique focal props use copies to keep their PBR rendering stable across quality changes.
    const entries = this.containers.get(name)!.instantiateModelsToScene(original => `${name}/${original}`, false, { doNotInstantiate: ['town-ground', 'tree', 'planter', 'entrance-planter', 'lamp', 'fountain', 'changing-room', 'clothing-shop', 'signpost', 'shop-sign', 'shop-tagline', 'casino-sign', 'casino-entry-sign', 'casino-tagline'].includes(name) });
    for (const node of entries.rootNodes) node.parent = root;
    root.position.set(x, y, z); root.rotation.y = rotation; root.scaling.setAll(scale);
    return root;
  }
}
