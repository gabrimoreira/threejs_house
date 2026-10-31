import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Bounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Câmera em perspectiva: fov vertical em graus, proporção da tela,
 * e os planos near/far que limitam o que é desenhado.
 */
export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 200);
  return camera;
}

/**
 * Distância para que uma esfera de raio `radius` caiba numa região visível de
 * visibleW × visibleH pixels de um canvas com fullH pixels de altura.
 *
 * O fov da câmera é o ângulo VERTICAL do canvas inteiro. A tangente do meio-ângulo
 * cresce linearmente com a distância em pixels a partir do centro, então o
 * meio-ângulo de uma região menor é atan(tan(fov/2) × tamanho / fullH). O lado
 * mais curto da região (na tela em pé, a largura) é o que limita.
 */
function fitDistance(fovDegrees: number, visibleW: number, visibleH: number, fullH: number, radius: number): number {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  const halfAngle = Math.atan((tanHalf * Math.min(visibleW, visibleH)) / fullH);
  return radius / Math.sin(halfAngle);
}

function houseCenter(bounds: Bounds2D): THREE.Vector3 {
  return new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
}

function halfDiagonal(bounds: Bounds2D): number {
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
}

/**
 * Vista em 3/4 do lado da entrada (sul, z menor), afastada o bastante para a casa
 * inteira caber na área visível (a parte do canvas que os painéis não cobrem).
 */
export function frameHouse(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  bounds: Bounds2D,
  visible: { width: number; height: number; fullHeight: number },
): void {
  const distance = fitDistance(camera.fov, visible.width, visible.height, visible.fullHeight, halfDiagonal(bounds) + 0.8);
  const direction = new THREE.Vector3(-0.3, 0.72, -0.62).normalize();
  controls.target.copy(houseCenter(bounds));
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  controls.maxDistance = Math.max(32, distance * 1.2);
  controls.update();
}

/**
 * OrbitControls gira a câmera em volta de um ponto (target) com o mouse ou toque.
 * Os limites impedem que a câmera atravesse o chão ou se afaste demais da casa.
 */
export function createOrbitControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  bounds: Bounds2D,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);

  // Inércia: o movimento desacelera suavemente. Exige chamar controls.update() a cada frame.
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  // Zoom mínimo (distância da câmera ao target). O máximo é definido em frameHouse().
  controls.minDistance = 2.5;

  // Ângulo polar: 0 = olhando de cima, PI/2 = olhando na horizontal.
  // Ficando um pouco abaixo de PI/2, a câmera nunca desce abaixo do plano do target.
  controls.maxPolarAngle = Math.PI / 2 - 0.08;

  // Pan "no chão": arrastar com o botão direito move o target no plano XZ
  // em vez de subir e descer, o que é mais natural num editor de planta.
  controls.screenSpacePanning = false;

  // O target não pode se afastar mais que maxTargetRadius do "cursor" (centro da casa).
  // Com o pan no plano XZ ele fica sempre na altura do piso, e como a câmera
  // fica sempre acima do target, ela nunca entra no chão.
  controls.cursor.copy(houseCenter(bounds));
  controls.maxTargetRadius = halfDiagonal(bounds) + 1;

  frameHouse(camera, controls, bounds, { width: camera.aspect, height: 1, fullHeight: 1 });
  return controls;
}
