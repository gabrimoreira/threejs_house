import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from './renderer';
import { createCamera, createOrbitControls, type Bounds2D } from './camera';
import { createLights } from './lights';
import { applyEnvironment } from './environment';

/** Tudo que os outros módulos precisam para mexer na cena. */
export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  /** Pede um novo frame. A cena só é redesenhada quando algo muda. */
  requestRender(): void;
  /** Avisa que objetos mudaram e o mapa de sombra precisa ser refeito. */
  invalidateShadows(): void;
}

export function createSceneContext(container: HTMLElement, houseBounds: Bounds2D): SceneContext {
  const renderer = createRenderer(container);
  // A Scene é a raiz do grafo de cena: tudo que for desenhado precisa estar nela.
  const scene = new THREE.Scene();
  const camera = createCamera(container.clientWidth / container.clientHeight);
  const controls = createOrbitControls(camera, renderer.domElement, houseBounds);
  const sun = createLights(scene, houseBounds);
  applyEnvironment(renderer, scene);

  let needsRender = true;
  const requestRender = () => {
    needsRender = true;
  };
  const invalidateShadows = () => {
    renderer.shadowMap.needsUpdate = true;
    needsRender = true;
  };

  controls.addEventListener('change', requestRender);

  // O canvas acompanha o tamanho do container (janela, rotação do celular etc.).
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // Toda mudança em fov/aspect/near/far precisa recalcular a matriz de projeção.
    camera.updateProjectionMatrix();
    requestRender();
  });
  resizeObserver.observe(container);

  // Loop de animação. O requestAnimationFrame roda sempre (sincronizado com a tela),
  // mas só desenhamos quando há mudança: economiza bateria no notebook e no celular.
  renderer.setAnimationLoop(() => {
    // Com damping, o update() continua movendo a câmera por alguns frames
    // depois que o usuário solta o mouse; ele dispara 'change' enquanto isso.
    controls.update();
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
  });

  return { renderer, scene, camera, controls, sun, requestRender, invalidateShadows };
}
