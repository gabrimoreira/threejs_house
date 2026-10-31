import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** URL de um arquivo em public/assets, respeitando o "base" do Vite. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}assets/${path}`;
}

// O GLTFLoader lê arquivos glTF/GLB (o "JPEG do 3D"): malhas, materiais e hierarquia de nós.
const loader = new GLTFLoader();

// Guardamos a Promise (e não o resultado) para que dois pedidos simultâneos
// do mesmo arquivo compartilhem um único download.
const templates = new Map<string, Promise<THREE.Group>>();

/**
 * Carrega um GLB uma única vez e devolve um "template" normalizado:
 * o pivô fica no centro da base do modelo (os modelos da Kenney vêm com o pivô
 * num canto), e todas as malhas projetam e recebem sombra.
 *
 * Não adicione o template na cena: use instantiate() para criar cópias.
 */
export function loadTemplate(path: string): Promise<THREE.Group> {
  let promise = templates.get(path);
  if (!promise) {
    promise = loader.loadAsync(assetUrl(path)).then((gltf) => {
      const model = gltf.scene;
      model.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      // Box3.setFromObject considera as transformações de todos os nós filhos.
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      // Desloca o modelo para que (0, 0, 0) do template seja o centro da base.
      model.position.set(-center.x, -box.min.y, -center.z);

      const template = new THREE.Group();
      template.name = path;
      template.add(model);
      return template;
    });
    templates.set(path, promise);
  }
  return promise;
}

/**
 * Cria uma cópia do template. clone() duplica a hierarquia de Object3D, mas
 * geometrias e materiais continuam compartilhados com o template (cópia barata).
 */
export function instantiate(template: THREE.Group): THREE.Group {
  return template.clone(true);
}

/** Tamanho (largura X, altura Y, profundidade Z) do template em metros. */
export function templateSize(template: THREE.Group): THREE.Vector3 {
  return new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
}
