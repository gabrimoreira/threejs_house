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
 * Distância para que uma esfera de raio `radius` caiba na tela. O fov da câmera é
 * vertical; numa tela em pé (aspect < 1) o ângulo horizontal é menor e é ele que limita.
 */
function fitDistance(camera: THREE.PerspectiveCamera, radius: number): number {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  return radius / Math.sin(Math.min(vFov, hFov) / 2);
}

/**
 * OrbitControls gira a câmera em volta de um ponto (target) com o mouse ou toque.
 * Os limites impedem que a câmera atravesse o chão ou se afaste demais da casa.
 */
export function createOrbitControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  houseBounds: Bounds2D,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);

  const centerX = (houseBounds.minX + houseBounds.maxX) / 2;
  const centerZ = (houseBounds.minZ + houseBounds.maxZ) / 2;
  controls.target.set(centerX, 0, centerZ);

  // Vista inicial em 3/4, do lado da entrada (sul, z menor), afastada o bastante
  // para a casa inteira caber na tela, inclusive num celular em pé.
  const halfDiagonal = Math.hypot(houseBounds.maxX - centerX, houseBounds.maxZ - centerZ);
  const direction = new THREE.Vector3(-0.3, 0.72, -0.62).normalize();
  const distance = fitDistance(camera, halfDiagonal + 0.8);
  camera.position.copy(controls.target).addScaledVector(direction, distance);

  // Inércia: o movimento desacelera suavemente. Exige chamar controls.update() a cada frame.
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  // Zoom mínimo/máximo (distância da câmera ao target).
  controls.minDistance = 2.5;
  controls.maxDistance = Math.max(32, distance * 1.2);

  // Ângulo polar: 0 = olhando de cima, PI/2 = olhando na horizontal.
  // Ficando um pouco abaixo de PI/2, a câmera nunca desce abaixo do plano do target.
  controls.maxPolarAngle = Math.PI / 2 - 0.08;

  // Pan "no chão": arrastar com o botão direito move o target no plano XZ
  // em vez de subir e descer, o que é mais natural num editor de planta.
  controls.screenSpacePanning = false;

  // O target não pode se afastar mais que maxTargetRadius do "cursor" (centro da casa).
  // Com o pan no plano XZ ele fica sempre na altura do piso, e como a câmera
  // fica sempre acima do target, ela nunca entra no chão.
  controls.cursor.set(centerX, 0, centerZ);
  controls.maxTargetRadius = halfDiagonal + 1;

  controls.update();
  return controls;
}
