import * as THREE from 'three';

/**
 * Libera da GPU as geometrias de uma hierarquia. O three não faz isso sozinho:
 * remover um objeto da cena tira ele do desenho, mas os buffers continuam na memória.
 *
 * `skip` permite pular objetos cuja geometria é compartilhada (ex.: instâncias de um
 * modelo em cache), que não podem ser descartados enquanto outros ainda os usam.
 */
export function disposeGeometries(root: THREE.Object3D, skip?: (obj: THREE.Object3D) => boolean): void {
  root.traverse((obj) => {
    if (skip?.(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}
