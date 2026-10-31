import * as THREE from 'three';
import type { SceneContext } from '../scene/sceneContext';
import { getItem, getVariant } from '../catalog/catalog';
import { createInstance, destroyInstance } from '../catalog/variants';
import type { ItemState, World } from './world';

/**
 * Reflete o World na cena: cria, move e remove os Object3D dos itens.
 * Cada objeto guarda o uid em userData, para o raycasting achar o item clicado.
 */
export class WorldView {
  readonly group = new THREE.Group();
  private readonly objects = new Map<string, THREE.Object3D>();
  // Carregamento é assíncrono: se o item mudar/sair antes de terminar, o token muda
  // e o objeto que acabou de carregar é descartado.
  private readonly tokens = new Map<string, number>();
  private nextToken = 1;
  private readonly ctx: SceneContext;

  constructor(world: World, ctx: SceneContext) {
    this.ctx = ctx;
    this.group.name = 'itens';
    world.on('added', (item) => void this.spawn(item));
    world.on('removed', (item) => this.despawn(item.uid));
    world.on('changed', ({ before, after }) => {
      const sameModel = before.catalogId === after.catalogId && before.variante === after.variante;
      const obj = this.objects.get(after.uid);
      if (sameModel && obj) {
        this.applyTransform(obj, after);
        this.ctx.invalidateShadows();
      } else {
        void this.spawn(after);
      }
    });
  }

  objectFor(uid: string): THREE.Object3D | undefined {
    return this.objects.get(uid);
  }

  private async spawn(item: ItemState): Promise<void> {
    const token = this.nextToken++;
    this.tokens.set(item.uid, token);
    const catalogItem = getItem(item.catalogId);
    if (!catalogItem) {
      console.warn(`Item de catálogo desconhecido: ${item.catalogId}`);
      return;
    }
    const obj = await createInstance(catalogItem, getVariant(catalogItem, item.variante)).catch((err) => {
      console.warn(`Falha ao carregar ${item.catalogId}:${item.variante}`, err);
      return null;
    });
    if (!obj) return;
    if (this.tokens.get(item.uid) !== token) {
      destroyInstance(obj); // ficou obsoleto enquanto carregava
      return;
    }
    // Troca de variante: o objeto antigo sai só agora, sem "piscar" vazio.
    const old = this.objects.get(item.uid);
    if (old) destroyInstance(old);

    obj.userData.uid = item.uid;
    this.applyTransform(obj, item);
    this.group.add(obj);
    this.objects.set(item.uid, obj);
    this.ctx.invalidateShadows();
  }

  private despawn(uid: string): void {
    this.tokens.delete(uid);
    const obj = this.objects.get(uid);
    if (!obj) return;
    destroyInstance(obj);
    this.objects.delete(uid);
    this.ctx.invalidateShadows();
  }

  private applyTransform(obj: THREE.Object3D, item: ItemState): void {
    obj.position.set(...item.posicao);
    obj.rotation.y = THREE.MathUtils.degToRad(item.rotacao);
  }
}
