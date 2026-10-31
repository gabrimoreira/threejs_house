import * as THREE from 'three';
import type { CatalogItem, CatalogVariant } from './types';
import { itemScale, variantFile } from './catalog';
import { loadTemplate } from './modelCache';
import { buildPainting, type OwnedResources } from './procedural';

/** Template pronto de uma variante, com as medidas já em metros. */
export interface VariantTemplate {
  key: string;
  item: CatalogItem;
  variant: CatalogVariant;
  /** Não adicione na cena: use createInstance(). */
  template: THREE.Group;
  /** Largura (X), altura (Y) e profundidade (Z) com rotação 0. */
  size: THREE.Vector3;
  /** [largura, profundidade] usados em snap e colisão. */
  footprint: [number, number];
  /** Altura do tampo, se o item aceita coisas em cima. */
  surfaceHeight?: number;
}

interface Entry {
  promise: Promise<{ info: VariantTemplate; owned: OwnedResources }>;
  refs: number;
}

/**
 * Cache de templates por variante, com contagem de referências.
 *
 * Os GLBs base (modelCache) ficam em memória durante a sessão: são poucos e pequenos.
 * Já o que é criado por variante (materiais recoloridos, quadros procedurais) é
 * liberado da GPU quando o último usuário (item na cena, fantasma ou miniatura) solta a referência.
 */
const entries = new Map<string, Entry>();

export function variantKey(item: CatalogItem, variant: CatalogVariant): string {
  return `${item.id}:${variant.id}`;
}

async function buildVariant(item: CatalogItem, variant: CatalogVariant) {
  const owned: OwnedResources = { geometries: [], materials: [], textures: [] };
  let model: THREE.Object3D;
  let scale = 1;

  if (item.procedural === 'quadro') {
    if (!variant.parametros) throw new Error(`Quadro ${item.id}:${variant.id} sem parâmetros`);
    model = buildPainting(variant.parametros, owned);
  } else {
    const file = variantFile(item, variant);
    if (!file) throw new Error(`Item ${item.id} sem arquivo`);
    // clone() da hierarquia: compartilha geometrias/materiais com o GLB em cache.
    model = (await loadTemplate(file)).clone(true);
    scale = itemScale(item);
  }

  // Variante gerada: troca a cor de alguns materiais. Clonamos cada material uma vez
  // só (vários meshes podem usar o mesmo) para não alterar o original compartilhado.
  const recolor = variant.materiais;
  if (recolor) {
    const clones = new Map<THREE.Material, THREE.Material>();
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (mat: THREE.Material) => {
        const color = recolor[mat.name];
        if (!color) return mat;
        let clone = clones.get(mat);
        if (!clone) {
          clone = mat.clone();
          (clone as THREE.MeshStandardMaterial).color.set(color);
          clones.set(mat, clone);
          owned.materials.push(clone);
        }
        return clone;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  // Escala e rotação base ficam num grupo interno; o template externo é o que o
  // jogo move e gira. Como o modelo já tem o pivô no centro da base, girar em Y
  // e escalar não tiram o pivô do lugar.
  const inner = new THREE.Group();
  inner.add(model);
  inner.scale.setScalar(scale);
  inner.rotation.y = THREE.MathUtils.degToRad(item.rotacaoBase ?? 0);

  const template = new THREE.Group();
  template.name = variantKey(item, variant);
  template.add(inner);

  const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
  const info: VariantTemplate = {
    key: variantKey(item, variant),
    item,
    variant,
    template,
    size,
    footprint: item.footprint ?? [size.x, size.z],
    surfaceHeight: item.superficie ? (item.superficie.altura ?? size.y) : undefined,
  };
  return { info, owned };
}

/** Pega (e conta) uma referência ao template da variante. Devolva com releaseVariant(). */
export async function acquireVariant(item: CatalogItem, variant: CatalogVariant): Promise<VariantTemplate> {
  const key = variantKey(item, variant);
  let entry = entries.get(key);
  if (!entry) {
    entry = { promise: buildVariant(item, variant), refs: 0 };
    entries.set(key, entry);
    // Se falhar, tira do cache para uma próxima tentativa poder recarregar.
    entry.promise.catch(() => entries.delete(key));
  }
  entry.refs++;
  return (await entry.promise).info;
}

export function releaseVariant(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  entry.promise
    .then(({ owned }) => {
      // Alguém pode ter pedido a mesma variante de novo enquanto esperávamos.
      if (entry.refs > 0 || entries.get(key) !== entry) return;
      entries.delete(key);
      owned.geometries.forEach((g) => g.dispose());
      owned.materials.forEach((m) => m.dispose());
      owned.textures.forEach((t) => t.dispose());
    })
    .catch(() => {}); // falha de carregamento já foi tratada por quem chamou acquireVariant
}

/** Cria um objeto da variante para pôr na cena. Libere com destroyInstance(). */
export async function createInstance(item: CatalogItem, variant: CatalogVariant): Promise<THREE.Group> {
  const info = await acquireVariant(item, variant);
  const instance = info.template.clone(true);
  instance.userData.variantKey = info.key;
  instance.userData.footprint = info.footprint;
  instance.userData.size = info.size.clone();
  return instance;
}

/** Tira o objeto da cena e devolve a referência da variante. */
export function destroyInstance(instance: THREE.Object3D): void {
  instance.removeFromParent();
  if (typeof instance.userData.variantKey === 'string') releaseVariant(instance.userData.variantKey);
}
