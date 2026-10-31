import * as THREE from 'three';

/** Dispositivo de toque "grosso" (celular/tablet): usamos para baixar a qualidade das sombras. */
export const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

/**
 * Cria o WebGLRenderer, que desenha a cena no <canvas>.
 * Aqui ficam as configurações globais de cor, tone mapping e sombras.
 */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });

  // Telas retina têm devicePixelRatio 2 ou 3. Limitamos a 2 porque acima disso
  // o custo de GPU cresce muito e a diferença visual é pequena.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);

  // Cores: as texturas e cores dos materiais estão em sRGB; o three calcula a luz
  // em espaço linear e converte de volta para sRGB na saída.
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Tone mapping comprime o brilho "infinito" da iluminação para a faixa da tela.
  // O Neutral mantém as cores lisas dos modelos low-poly próximas do original.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Sombras: PCF filtra as bordas (o shadow.radius da luz controla a suavidade).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // A luz do sol não se mexe; só refazemos o mapa de sombra quando algo na cena muda
  // (ver SceneContext.invalidateShadows). Girar a câmera não exige recalcular sombras.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  container.appendChild(renderer.domElement);
  return renderer;
}
