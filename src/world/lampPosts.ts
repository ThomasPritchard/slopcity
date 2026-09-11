import { Scene } from '@babylonjs/core/scene';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Light } from '@babylonjs/core/Lights/light';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { GRAPHICS_PRESETS, resolveGraphicsQuality, type GraphicsQuality } from '../settings/graphics';

export const LAMP_POSTS = [
  { x: -6.5, z: -12 }, { x: -6.5, z: 8 },
  { x: 6.5, z: -12 }, { x: 6.5, z: 8 },
] as const;

/** Four fixed lantern sources, plus a small bloom restricted to their opal chimneys. */
export class LampPostLighting {
  readonly lights: PointLight[] = [];
  readonly glow: GlowLayer;
  private opal = new Map<PBRMaterial, Color3>();

  constructor(scene: Scene, posts: TransformNode[]) {
    // Sky + sun + four posts + two marquee lights. Venue fills only affect the excluded interior.
    // Apply this to newly cloned citizen materials too, so every pole can light visitors.
    const configureMaterial = (material: Material) => {
      if ('maxSimultaneousLights' in material && typeof material.maxSimultaneousLights === 'number') {
        material.maxSimultaneousLights = Math.max(material.maxSimultaneousLights, 8);
      }
    };
    scene.materials.forEach(configureMaterial);
    scene.onNewMaterialAddedObservable.add(material => {
      // Material construction registers with the scene before subclass defaults are assigned.
      queueMicrotask(() => { if (!scene.isDisposed) configureMaterial(material); });
    });
    const interior = scene.meshes.filter(mesh => /^(meridian-.*\/|roulette-.*\/|blackjack-table\/|slot-machine\/|casino-chair\/|craps-(?:table|live)\/|poker-(?:table|live)\/|clothing-shop\/|form-thread-(?:shell|roof)\/|shop-mannequin-\d+\/|changing-room\/)/.test(mesh.name) || mesh.name === 'casino floor' || mesh.name.startsWith('Ivory roulette ball '));
    this.glow = new GlowLayer('Lantern glass glow', scene, { mainTextureRatio: .25, blurKernelSize: 16 });
    this.glow.intensity = .25;
    posts.forEach((root, index) => {
      root.computeWorldMatrix(true);
      const marker = root.getChildTransformNodes(false).find(node => node.name.endsWith('/lamp-light-source'));
      if (!marker) throw new Error('Lamp export is missing its light-source marker');
      marker.computeWorldMatrix(true);
      const light = new PointLight(`Lamp post light ${index + 1}`, marker.getAbsolutePosition().clone(), scene);
      light.diffuse = new Color3(1, .79, .48);
      light.specular = new Color3(1, .85, .63);
      light.intensity = .65;
      light.range = 8.4;
      light.radius = .12;
      // Consistent finite falloff across the town's Standard and PBR materials.
      light.falloffType = Light.FALLOFF_STANDARD;
      // Existing sunlight supplies shadows; avoid four additional cube shadow maps.
      light.shadowEnabled = false;
      light.excludedMeshes = [...interior, ...root.getChildMeshes()];
      this.lights.push(light);
      for (const mesh of root.getChildMeshes()) {
        if (mesh instanceof Mesh && mesh.material instanceof PBRMaterial && mesh.material.name === 'Lamp warm opal light') {
          this.glow.addIncludedOnlyMesh(mesh);
          this.opal.set(mesh.material, mesh.material.emissiveColor.clone());
        }
      }
    });
  }

  setNightWeight(weight: number) {
    for (const light of this.lights) light.intensity = .65 * weight;
    for (const [material, colour] of this.opal) colour.scaleToRef(weight, material.emissiveColor);
    this.glow.intensity = .25 * weight;
  }

  setQuality(quality: GraphicsQuality | boolean) {
    // All presets retain the actual lights; only decorative bloom changes.
    this.glow.isEnabled = GRAPHICS_PRESETS[resolveGraphicsQuality(quality)].glow;
  }
}
