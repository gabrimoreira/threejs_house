import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Mapa de ambiente: uma "foto 360°" usada para reflexos e luz indireta nos
 * materiais PBR (MeshStandardMaterial). Em vez de baixar um HDRI, usamos o
 * RoomEnvironment do three, uma sala simples gerada em código.
 *
 * O PMREMGenerator pré-filtra o ambiente em vários níveis de desfoque, para que
 * materiais ásperos recebam reflexos borrados e materiais lisos, reflexos nítidos.
 */
export function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envMap;
  // A luz principal vem das luzes; o ambiente entra só como complemento.
  scene.environmentIntensity = 0.6;

  // Depois de gerado, o ambiente intermediário e o gerador não são mais necessários.
  room.dispose();
  pmrem.dispose();

  // Fundo: cor de céu clara.
  scene.background = new THREE.Color(0xcfe0ea);
}
