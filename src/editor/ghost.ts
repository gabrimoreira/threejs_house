import * as THREE from 'three';
import type { VariantTemplate } from '../catalog/variants';

// Dois materiais compartilhados por todos os fantasmas: verde (pode) e vermelho (não pode).
// Translúcidos e sem escrever no depth buffer, para não esconder o que está atrás.
const makeGhostMaterial = (color: string) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
const VALID = makeGhostMaterial('#3fbf6f');
const INVALID = makeGhostMaterial('#e0483e');
const OUTLINE_VALID = new THREE.MeshBasicMaterial({ color: '#3fbf6f', transparent: true, opacity: 0.3, depthWrite: false });
const OUTLINE_INVALID = new THREE.MeshBasicMaterial({ color: '#e0483e', transparent: true, opacity: 0.3, depthWrite: false });

/**
 * Prévia do item que está sendo posicionado: uma cópia do modelo com material
 * translúcido e um retângulo no chão mostrando o footprint.
 */
export class Ghost {
  readonly object = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly footprint: THREE.Mesh;

  constructor(info: VariantTemplate) {
    const model = info.template.clone(true);
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.meshes.push(mesh);
    });

    const [w, d] = info.footprint;
    this.footprint = new THREE.Mesh(new THREE.PlaneGeometry(w, d), OUTLINE_VALID);
    this.footprint.rotation.x = -Math.PI / 2;
    // Desenhado por último: fica visível mesmo "dentro" do piso.
    this.footprint.renderOrder = 1;

    this.object.name = 'fantasma';
    this.object.add(model, this.footprint);
    this.setValid(true);
  }

  update(position: THREE.Vector3, rotationDeg: number, valid: boolean): void {
    this.object.position.copy(position);
    this.object.rotation.y = THREE.MathUtils.degToRad(rotationDeg);
    // O retângulo fica sempre no chão, mesmo para itens de parede (que flutuam).
    this.footprint.position.y = 0.012 - position.y;
    this.setValid(valid);
  }

  private setValid(valid: boolean): void {
    for (const mesh of this.meshes) mesh.material = valid ? VALID : INVALID;
    this.footprint.material = valid ? OUTLINE_VALID : OUTLINE_INVALID;
  }

  /** Tira da cena e libera o que é só do fantasma (o modelo é compartilhado com o template). */
  dispose(): void {
    this.object.removeFromParent();
    this.footprint.geometry.dispose();
  }
}
