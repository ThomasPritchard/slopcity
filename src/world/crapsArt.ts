import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CRAPS_GEOMETRY as g, DIE_NORMALS, sampleCrapsMotion } from '../../shared/crapsMotion';
import { CRAPS_POINTS, type CrapsView } from '../../shared/craps';
import type { CasinoAnchor, CasinoPrivateState } from '../../shared/casino';
import { CASINO_LAYOUT } from '../../shared/casinoLayout';

/** Chamfered six-faced die; pip normals remain independent of the motion sampler. */
function dieBody(scene: Scene, name: string) {
  const mesh = new Mesh(name, scene), positions: number[] = [], indices: number[] = [];
  const h = g.dieSize / 2, b = h - .008;
  const face = (points: number[][]) => {
    const p = points.map(v => Vector3.FromArray(v));
    const centre = p.reduce((sum, v) => sum.add(v), Vector3.Zero());
    if (Vector3.Dot(Vector3.Cross(p[1].subtract(p[0]), p[2].subtract(p[0])), centre) < 0) points.reverse();
    const start = positions.length / 3; points.forEach(v => positions.push(...v));
    // Babylon's left-handed mesh winding is clockwise when viewed from outside.
    for (let i = 1; i < points.length - 1; i++) indices.push(start, start + i + 1, start + i);
  };
  for (let a = 0; a < 3; a++) for (const sign of [-1, 1]) {
    const other = [0, 1, 2].filter(i => i !== a);
    face([[-b, -b], [b, -b], [b, b], [-b, b]].map(([u, v]) => { const p = [0, 0, 0]; p[a] = sign * h; p[other[0]] = u; p[other[1]] = v; return p; }));
  }
  for (let edge = 0; edge < 3; edge++) for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const [a, c] = [0, 1, 2].filter(i => i !== edge);
    face([[h, b, -b], [b, h, -b], [b, h, b], [h, b, b]].map(([u, v, w]) => { const p = [0, 0, 0]; p[a] = s * u; p[c] = t * v; p[edge] = w; return p; }));
  }
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) face([[x * h, y * b, z * b], [x * b, y * h, z * b], [x * b, y * b, z * h]]);
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = [];
  VertexData.ComputeNormals(positions, indices, data.normals); data.applyToMesh(mesh);
  return mesh;
}

const patterns = [
  [[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
];

export class CrapsTableArt {
  readonly dice: [TransformNode, TransformNode];
  private puck: Mesh;
  private chips: Mesh[] = [];
  private ownChip: Mesh;
  private markerTexture: DynamicTexture;
  private markerKey = '';
  constructor(private scene: Scene, private anchor: CasinoAnchor) {
    const material = (name: string, colour: string) => { const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(colour); m.specularColor.set(.16, .16, .16); return m; };
    const ivory = material('Craps warm ivory', '#f5eddc'), ink = material('Craps inset pips', '#24342d');
    this.dice = [0, 1].map(index => {
      const root = new TransformNode(`craps-die-${index}`, scene);
      const body = dieBody(scene, `craps-live/die-${index}`); body.material = ivory; body.parent = root;
      const pips: Mesh[] = [];
      DIE_NORMALS.forEach((normal, face) => {
        const n = Vector3.FromArray(normal), u = Math.abs(n.y) > .5 ? new Vector3(1, 0, 0) : Vector3.Cross(new Vector3(0, 1, 0), n).normalize(), v = Vector3.Cross(n, u);
        patterns[face].forEach(([x, y]) => {
          const pip = MeshBuilder.CreateSphere('pip', { diameter: .025, segments: 8 }, scene);
          pip.scaling.z = .13;
          pip.rotationQuaternion = Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), n, Quaternion.Identity());
          pip.position.copyFrom(n.scale(g.dieSize / 2 - .0007).add(u.scale(x * .033)).add(v.scale(y * .033)));
          pips.push(pip);
        });
      });
      const dots = Mesh.MergeMeshes(pips, true)!; dots.name = `craps-live/pips-${index}`; dots.material = ink; dots.parent = root;
      // Independent face markers let renderer tests verify the actual top face after rotation.
      DIE_NORMALS.forEach((normal, face) => { const marker = new TransformNode(`craps-face-${index}-${face + 1}`, scene); marker.position.copyFromFloats(...normal).scaleInPlace(g.dieSize / 2); marker.parent = root; });
      return root;
    }) as [TransformNode, TransformNode];
    this.markerTexture = new DynamicTexture('Craps ON OFF puck', { width: 256, height: 256 }, scene, false);
    const puckMaterial = material('Craps point marker', '#f6edda'); puckMaterial.diffuseTexture = this.markerTexture; puckMaterial.emissiveColor.set(.12, .12, .12);
    this.puck = MeshBuilder.CreateCylinder('craps-live/point-puck', { diameter: .28, height: .035, tessellation: 40 }, scene); this.puck.material = puckMaterial;
    const chipMaterial = material('Craps shared chip stacks', '#b78643'), ownMaterial = material('Craps own line wager', '#a4483d');
    for (let i = 0; i < 7; i++) {
      const chip = MeshBuilder.CreateCylinder(`craps-live/chip-${i}`, { diameter: .14, height: .035, tessellation: 24 }, scene);
      chip.material = i ? chipMaterial : ownMaterial; this.chips.push(chip); chip.setEnabled(false);
    }
    this.ownChip = this.chips[0];
    this.update(null, { rouletteBets: [] }, 0, false);
  }
  update(table: CrapsView | null, privateState: CasinoPrivateState, now: number, reducedMotion: boolean) {
    const poses = sampleCrapsMotion(table?.motion, now, reducedMotion);
    poses.forEach((pose, i) => {
      this.dice[i].position.set(this.anchor.x + pose.x, CASINO_LAYOUT.floor + g.feltHeight + pose.y, this.anchor.z + pose.z);
      this.dice[i].rotationQuaternion ??= Quaternion.Identity(); this.dice[i].rotationQuaternion!.copyFromFloats(...pose.rotation);
    });
    const point = table?.point ?? null, markerKey = point === null ? 'OFF' : 'ON';
    if (markerKey !== this.markerKey) {
      this.markerKey = markerKey;
      const ctx = this.markerTexture.getContext() as CanvasRenderingContext2D;
      ctx.fillStyle = point === null ? '#233b30' : '#efe3bf'; ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#b59860'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(128, 128, 104, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = point === null ? '#efe3bf' : '#233b30'; ctx.font = 'bold 64px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(markerKey, 128, 128); this.markerTexture.update();
    }
    this.puck.position.set(this.anchor.x + (point === null ? -2.05 : -1.5 + CRAPS_POINTS.indexOf(point) * .6), CASINO_LAYOUT.floor + g.feltHeight + .02, this.anchor.z + g.pointZ);
    const own = privateState.crapsBets?.find(bet => bet.tableId === this.anchor.id && bet.roundId === table?.roundId);
    this.ownChip.setEnabled(!!own);
    if (own) { this.ownChip.scaling.y = Math.min(6, own.bet.stake / 10); this.ownChip.position.set(this.anchor.x, CASINO_LAYOUT.floor + g.feltHeight + this.ownChip.scaling.y * .0175 + .006, this.anchor.z + (own.bet.kind === 'pass' ? g.passZ : g.dontPassZ)); }
    const count = Math.max(0, (table?.betCount ?? 0) - (own ? 1 : 0));
    for (let i = 1; i < this.chips.length; i++) {
      const chip = this.chips[i]; chip.setEnabled(count >= i);
      chip.scaling.y = Math.min(6, Math.ceil(count / 6));
      // Aggregate spectator chips on the dealer's rack: never fabricate private line choices.
      chip.position.set(this.anchor.x - 1.85 + i * .23, CASINO_LAYOUT.floor + g.feltHeight + chip.scaling.y * .0175 + .006, this.anchor.z + .92);
    }
  }
}
