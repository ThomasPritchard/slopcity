import { Scene } from '@babylonjs/core/scene';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Light } from '@babylonjs/core/Lights/light';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { marqueeBrightness } from './casinoLightingMath';

/** Modelled bulbs share the town bloom pass; only two entrance lights illuminate the square. */
export class CasinoLighting {
  private entrance: PointLight[] = [];
  private emission = new Map<PBRMaterial, { colour: Color3; group: number; groups: number }>();
  private reducedMotion = false;
  constructor(scene: Scene, glow: GlowLayer) {
    const interior = scene.meshes.filter(mesh => /^(meridian-(?:interior|shell|ceiling|chandelier)|roulette-(?:table|wheel)|blackjack-table|slot-machine|casino-chair|craps-table|craps-live|poker-table|poker-live)\//.test(mesh.name) || mesh.name.startsWith('Ivory roulette ball '));
    for (const [index, z] of [18, 32, 47].entries()) {
      const fill = new PointLight(`Meridian interior fill ${index + 1}`, new Vector3(0, z === 18 ? 3.3 : 6.5, z), scene);
      fill.diffuse = new Color3(1, .87, .68); fill.intensity = .55; fill.range = 24;
      fill.falloffType = Light.FALLOFF_STANDARD; fill.shadowEnabled = false;
      fill.includedOnlyMeshes = interior;
    }
    const excluded = scene.meshes.filter(mesh => /^(changing-room|clothing-shop|form-thread-(?:shell|roof)|shop-mannequin-\d+|meridian-(?:interior|ceiling|chandelier)|roulette-(?:table|wheel)|blackjack-table|slot-machine|casino-chair|craps-table|craps-live|poker-table|poker-live)\//.test(mesh.name) || mesh.name.startsWith('Ivory roulette ball '));
    for (const x of [-8, 8]) {
      const light = new PointLight(`Meridian marquee light ${x}`, new Vector3(x, 3.6, 11.5), scene);
      light.diffuse = new Color3(1, .60, .30); light.specular = new Color3(1, .75, .45);
      light.range = 13; light.radius = .6; light.falloffType = Light.FALLOFF_STANDARD;
      light.shadowEnabled = false; light.excludedMeshes = excluded;
      this.entrance.push(light);
    }
    for (const mesh of scene.meshes) {
      if (!(mesh instanceof Mesh) || !(mesh.material instanceof PBRMaterial)) continue;
      if (/^Meridian (interior opal|ceiling warm cove|chandelier opal)/.test(mesh.material.name)) glow.addIncludedOnlyMesh(mesh);
      if (/^Meridian (neon red|bulb glow|glass glow)/.test(mesh.material.name)) {
        glow.addIncludedOnlyMesh(mesh);
        const match = /chase (\d+)/.exec(mesh.material.name);
        this.emission.set(mesh.material, { colour: mesh.material.emissiveColor.clone(), group: Number(match?.[1] ?? 0), groups: match ? mesh.material.name.includes('bulb') ? 8 : 3 : 0 });
      }
    }
    this.update(0, 0);
  }
  setReducedMotion(reduced: boolean) { this.reducedMotion = reduced; }
  update(timeMs: number, weight: number) {
    // Keep the paving illumination and room lights steady; the authored facade carries the chase.
    for (const light of this.entrance) light.intensity = .9 * weight;
    for (const [material, { colour, group, groups }] of this.emission) {
      const rhythm = groups ? marqueeBrightness(timeMs, group, groups, this.reducedMotion) : 1;
      colour.scaleToRef((.18 + .82 * weight) * rhythm, material.emissiveColor);
    }
  }
}
