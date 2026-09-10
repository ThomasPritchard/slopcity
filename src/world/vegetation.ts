import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

class PlantWind extends MaterialPluginBase {
  constructor(material: PBRMaterial, private vegetation: Vegetation, private amplitude: number) {
    super(material, 'Plant wind', 200, { PLANT_WIND: true }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName() { return 'PlantWind'; }
  getAttributes(attributes: string[]) { attributes.push('plantWind'); }
  getUniforms() {
    return { ubo: [{ name: 'plantTime', size: 1, type: 'float' }, { name: 'plantAmplitude', size: 1, type: 'float' }],
      vertex: 'uniform float plantTime;\nuniform float plantAmplitude;' };
  }
  hardBindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('plantTime', this.vegetation.elapsed);
    buffer.updateFloat('plantAmplitude', this.amplitude);
  }
  getCustomCode(type: string) {
    if (type !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: 'attribute vec2 plantWind;',
      CUSTOM_VERTEX_UPDATE_POSITION: `
        float plantPhase = plantWind.y * 6.2831853;
        float broadGust = sin(plantTime * 0.85 + positionUpdated.x * 0.7 + positionUpdated.z * 0.45);
        float smallGust = sin(plantTime * 1.8 + plantPhase) * 0.28;
        float plantBend = plantAmplitude * plantWind.x * (broadGust + smallGust);
        positionUpdated.x += plantBend;
        positionUpdated.z += plantBend * 0.48 + sin(plantTime * 1.1 + plantPhase) * plantAmplitude * plantWind.x * 0.17;
        positionUpdated.y -= abs(plantBend) * 0.12;
      `,
    };
  }
}

/** Shared GPU wind; authored weights keep grass roots fixed in the soil. */
export class Vegetation {
  elapsed = 0;
  private reduced = false;
  private detail: Mesh[] = [];
  readonly meshes: Mesh[] = [];
  constructor(scene: Scene) {
    const materials = new Set<PBRMaterial>();
    for (const mesh of scene.meshes) {
      if (!(mesh instanceof Mesh) || !(mesh.material instanceof PBRMaterial)) continue;
      const name = mesh.material.name;
      if (!/^(Tree leaves|Planting grass|Planting seed)/.test(name)) continue;
      const weights = mesh.getVerticesData(VertexBuffer.UVKind);
      if (!weights) throw new Error(`Missing authored wind weights: ${mesh.name}`);
      mesh.setVerticesData('plantWind', weights, false, 2);
      // The shader bends tips outside the static export bounds; keep those tips visible.
      const bounds = mesh.getBoundingInfo().boundingBox, padding = new Vector3(.25, .08, .18);
      mesh.setBoundingInfo(new BoundingInfo(bounds.minimum.subtract(padding), bounds.maximum.add(padding)));
      this.meshes.push(mesh);
      if (name === 'Planting grass detail') this.detail.push(mesh);
      materials.add(mesh.material);
    }
    for (const material of materials) {
      new PlantWind(material, this, material.name.startsWith('Tree leaves') ? .055 : .16);
      material.backFaceCulling = false;
      material.twoSidedLighting = true;
      // Use the same deformed geometry in the directional shadow pass.
      material.shadowDepthWrapper = new ShadowDepthWrapper(material, scene);
    }
  }
  update(dt: number, active: boolean) { if (!this.reduced && active) this.elapsed += dt; }
  setReducedMotion(reduced: boolean) { this.reduced = reduced; }
  setQuality(low: boolean) { for (const mesh of this.detail) mesh.setEnabled(!low); }
}
