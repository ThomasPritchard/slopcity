import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Light } from '@babylonjs/core/Lights/light';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { inShop, shopPoint } from '../../shared/shopLayout';

export const isShopMesh = (name: string) => /^(form-thread-(?:shell|roof)|clothing-shop|shop-sign|shop-tagline|shop-mannequin-\d+)\//.test(name);

/** Steady warm interior light, confined to the boutique and its current occupants. */
export class ShopLighting {
  private lights: PointLight[] = [];
  private fixed;
  private characterKey = '';
  constructor(scene: Scene, glow: GlowLayer) {
    this.fixed = scene.meshes.filter(mesh => isShopMesh(mesh.name));
    for (const [index, [x, depth]] of [[0, 3.5], [-5, 12.5], [5, 12.5]].entries()) {
      const p = shopPoint(x, depth, 3.8);
      const light = new PointLight(`Form & Thread interior fill ${index + 1}`, new Vector3(p.x, p.y, p.z), scene);
      light.diffuse = new Color3(1, .88, .72); light.specular = Color3.Black();
      light.intensity = .65; light.range = 15; light.falloffType = Light.FALLOFF_STANDARD;
      light.shadowEnabled = false; light.includedOnlyMeshes = this.fixed;
      this.lights.push(light);
    }
    for (const mesh of this.fixed) if (mesh instanceof Mesh && /^Shop .*glow/.test(mesh.material?.name ?? '')) glow.addIncludedOnlyMesh(mesh);
  }
  setCharacters(roots: TransformNode[]) {
    const occupants = roots.filter(root => root.isEnabled() && !root.isDisposed() && inShop(root.position.x, root.position.z));
    const key = occupants.map(root => root.uniqueId).join(',');
    if (key === this.characterKey) return;
    this.characterKey = key;
    const meshes = [...this.fixed, ...occupants.flatMap(root => root.getChildMeshes())];
    for (const light of this.lights) light.includedOnlyMeshes = meshes;
  }
}
