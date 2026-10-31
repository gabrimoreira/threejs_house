import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from './renderer';
import { createCamera, createOrbitControls, frameHouse, type Bounds2D } from './camera';
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
  /**
   * Informa quanto da tela os painéis cobrem (px à esquerda e embaixo), para
   * centralizar a imagem na área livre.
   */
  setViewInsets(left: number, bottom: number): void;
  /** Reposiciona a câmera na vista inicial, enquadrando a casa na área livre. */
  frameHouse(): void;
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

  // Painéis por cima do canvas: deslocamos o centro da projeção com setViewOffset,
  // como se a imagem fosse um recorte de uma tela maior. A câmera continua no mesmo
  // lugar; só o ponto para onde ela olha vai parar no meio da área livre.
  const insets = { left: 0, bottom: 0 };
  const applyViewOffset = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (insets.left === 0 && insets.bottom === 0) camera.clearViewOffset();
    else camera.setViewOffset(w, h, -insets.left / 2, insets.bottom / 2, w, h);
  };
  const setViewInsets = (left: number, bottom: number) => {
    insets.left = left;
    insets.bottom = bottom;
    applyViewOffset();
    requestRender();
  };
  const frame = () => {
    const fullHeight = container.clientHeight;
    frameHouse(camera, controls, houseBounds, {
      width: Math.max(1, container.clientWidth - insets.left),
      height: Math.max(1, fullHeight - insets.bottom),
      fullHeight,
    });
    requestRender();
  };

  // O canvas acompanha o tamanho do container (janela, rotação do celular etc.).
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    applyViewOffset();
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

  return { renderer, scene, camera, controls, sun, requestRender, invalidateShadows, setViewInsets, frameHouse: frame };
}
