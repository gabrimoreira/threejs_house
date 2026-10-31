import * as THREE from 'three';

const ACCENT = new THREE.Color('#2f9e6a');
const INVALID = new THREE.Color('#e0483e');

/**
 * Destaque do item selecionado:
 * - brilho (emissive) nos materiais do item;
 * - uma moldura no chão com o footprint (verde, ou vermelha se a posição for inválida).
 *
 * Os materiais são compartilhados entre todas as cópias de um modelo, então NÃO
 * podemos mudar o emissive deles direto: o sofá inteiro da casa brilharia junto.
 * Clonamos os materiais só deste objeto e devolvemos os originais ao desmarcar.
 */
export class SelectionHighlight {
  private target: THREE.Object3D | null = null;
  private swaps: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
  private clones: THREE.Material[] = [];
  private readonly frameMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85, depthWrite: false });
  private frame: THREE.Mesh | null = null;

  attach(object: THREE.Object3D, footprint: [number, number]): void {
    this.detach();
    this.target = object;

    object.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const tint = (mat: THREE.Material) => {
        const clone = mat.clone() as THREE.MeshStandardMaterial;
        if (clone.emissive) {
          clone.emissive.copy(ACCENT);
          clone.emissiveIntensity = 0.28;
        }
        this.clones.push(clone);
        return clone;
      };
      this.swaps.push({ mesh, original: mesh.material });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });

    this.frame = new THREE.Mesh(frameGeometry(footprint[0], footprint[1]), this.frameMaterial);
    this.frame.rotation.x = -Math.PI / 2;
    this.frame.renderOrder = 1;
    // Filho do objeto: acompanha arrasto e rotação sem código extra.
    object.add(this.frame);
    this.syncFrameHeight();
  }

  /** Mantém a moldura no chão (itens de parede ficam acima do piso). */
  syncFrameHeight(): void {
    if (this.frame && this.target) this.frame.position.y = 0.013 - this.target.position.y;
  }

  setValid(valid: boolean): void {
    this.frameMaterial.color.copy(valid ? ACCENT : INVALID);
  }

  detach(): void {
    for (const { mesh, original } of this.swaps) mesh.material = original;
    for (const clone of this.clones) clone.dispose();
    this.swaps = [];
    this.clones = [];
    if (this.frame) {
      this.frame.removeFromParent();
      this.frame.geometry.dispose();
      this.frame = null;
    }
    this.target = null;
    this.setValid(true);
  }
}

/** Retângulo vazado (moldura) de w × d, com bordas de 4 cm, no plano XY. */
function frameGeometry(w: number, d: number): THREE.ShapeGeometry {
  const border = 0.04;
  const outer = new THREE.Shape();
  outer.moveTo(-w / 2 - border, -d / 2 - border);
  outer.lineTo(w / 2 + border, -d / 2 - border);
  outer.lineTo(w / 2 + border, d / 2 + border);
  outer.lineTo(-w / 2 - border, d / 2 + border);
  outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w / 2, -d / 2);
  hole.lineTo(-w / 2, d / 2);
  hole.lineTo(w / 2, d / 2);
  hole.lineTo(w / 2, -d / 2);
  hole.closePath();
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer);
}
