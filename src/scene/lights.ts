import * as THREE from 'three';
import type { Bounds2D } from './camera';
import { isCoarsePointer } from './renderer';

/**
 * Iluminação da cena:
 * - HemisphereLight: luz ambiente com cor do céu (de cima) e do chão (de baixo). Não faz sombra.
 * - DirectionalLight: o "sol". Raios paralelos, é a única luz que projeta sombra (custa caro).
 */
export function createLights(scene: THREE.Scene, houseBounds: Bounds2D): THREE.DirectionalLight {
  const hemi = new THREE.HemisphereLight(0xe4eef7, 0x8a7a66, 1.1);
  scene.add(hemi);

  const centerX = (houseBounds.minX + houseBounds.maxX) / 2;
  const centerZ = (houseBounds.minZ + houseBounds.maxZ) / 2;

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  // A direção da luz vai da posição até o target.
  sun.position.set(centerX - 6, 15, centerZ - 9);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  sun.castShadow = true;
  // Resolução do mapa de sombra (textura renderizada do ponto de vista da luz).
  const size = isCoarsePointer ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  // Suaviza as bordas da sombra (filtro PCF).
  sun.shadow.radius = 3;

  // A sombra da DirectionalLight usa uma câmera ortográfica. Quanto mais justa
  // ela for na área da casa, mais nítida a sombra para a mesma resolução.
  const halfW = (houseBounds.maxX - houseBounds.minX) / 2 + 2;
  const halfD = (houseBounds.maxZ - houseBounds.minZ) / 2 + 2;
  const half = Math.max(halfW, halfD);
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = 45;
  cam.updateProjectionMatrix();

  // Bias evita "shadow acne" (listras causadas por imprecisão de profundidade).
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;

  return sun;
}
