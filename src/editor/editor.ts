import * as THREE from 'three';
import type { SceneContext } from '../scene/sceneContext';
import type { HouseData } from '../house/types';
import { findRoomAt } from '../house/roomLookup';
import type { CatalogItem, CatalogVariant } from '../catalog/types';
import { acquireVariant, releaseVariant, type VariantTemplate } from '../catalog/variants';
import { newUid, type World } from '../state/world';
import { Emitter } from '../utils/emitter';
import { Picker } from './picking';
import { Ghost } from './ghost';
import { footprintInsideHouse, snapToGrid } from './snapping';

/** Estado público do posicionamento, para a UI mostrar. */
export interface PlacementStatus {
  item: CatalogItem;
  variant: CatalogVariant;
  hasPosition: boolean;
  valid: boolean;
}

type EditorEvents = {
  placement: PlacementStatus | null;
};

interface Placement {
  info: VariantTemplate;
  ghost: Ghost;
  rotation: number;
  position: THREE.Vector3 | null;
  valid: boolean;
}

/** Distância máxima (px) entre pointerdown e pointerup para contar como clique/toque. */
const CLICK_TOLERANCE = 6;

/**
 * Editor da casa. Nesta fase: modo de posicionamento de itens do catálogo, com
 * fantasma verde/vermelho seguindo o cursor sobre o piso e snap no grid.
 */
export class Editor extends Emitter<EditorEvents> {
  private readonly ctx: SceneContext;
  private readonly world: World;
  private readonly house: HouseData;
  private readonly picker: Picker;
  private placement: Placement | null = null;
  private placementToken = 0;
  private pointerStart: { x: number; y: number; id: number } | null = null;

  constructor(ctx: SceneContext, world: World, house: HouseData) {
    super();
    this.ctx = ctx;
    this.world = world;
    this.house = house;
    this.picker = new Picker(ctx.camera, ctx.renderer.domElement);

    const dom = ctx.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Entra no modo de posicionamento com a variante escolhida no catálogo. */
  async startPlacement(item: CatalogItem, variant: CatalogVariant): Promise<void> {
    this.cancelPlacement();
    const token = ++this.placementToken;
    const info = await acquireVariant(item, variant);
    if (token !== this.placementToken) {
      releaseVariant(info.key); // o usuário escolheu outra coisa enquanto carregava
      return;
    }
    const ghost = new Ghost(info);
    ghost.object.visible = false; // aparece quando o cursor passar sobre o piso
    this.ctx.scene.add(ghost.object);
    this.placement = { info, ghost, rotation: 0, position: null, valid: false };
    this.emitPlacement();
  }

  cancelPlacement(): void {
    this.placementToken++;
    const p = this.placement;
    if (!p) return;
    p.ghost.dispose();
    releaseVariant(p.info.key);
    this.placement = null;
    this.ctx.requestRender();
    this.emit('placement', null);
  }

  rotatePlacement(degrees: number): void {
    const p = this.placement;
    if (!p) return;
    p.rotation = (p.rotation + degrees + 360) % 360;
    if (p.position) this.movePlacement(p.position.x, p.position.z);
  }

  /** Coloca o item onde está o fantasma. Devolve false se a posição não for válida. */
  confirmPlacement(keepPlacing = false): boolean {
    const p = this.placement;
    if (!p || !p.position || !p.valid) return false;
    const { x, y, z } = p.position;
    this.world.add({
      uid: newUid(),
      catalogId: p.info.item.id,
      variante: p.info.variant.id,
      posicao: [x, y, z],
      rotacao: p.rotation,
      comodo: findRoomAt(this.house.comodos, x, z)?.id ?? null,
    });
    if (!keepPlacing) this.cancelPlacement();
    return true;
  }

  /** Move o fantasma para o ponto (x, z) do piso, aplicando snap e validação. */
  private movePlacement(x: number, z: number): void {
    const p = this.placement;
    if (!p) return;
    const { item } = p.info;
    const [w, d] = p.info.footprint;
    const [sx, sz] = snapToGrid(x, z, w, d, p.rotation);
    // Itens de parede flutuam na altura definida no catálogo (na Fase 4 eles grudam na parede).
    const y = item.montagem === 'parede' ? (item.alturaParede ?? 1.2) : 0;

    p.position = new THREE.Vector3(sx, y, sz);
    p.valid = footprintInsideHouse(this.house.comodos, sx, sz, w, d, p.rotation);
    p.ghost.object.visible = true;
    p.ghost.update(p.position, p.rotation, p.valid);
    this.ctx.requestRender();
    this.emitPlacement();
  }

  private emitPlacement(): void {
    const p = this.placement;
    this.emit(
      'placement',
      p && { item: p.info.item, variant: p.info.variant, hasPosition: p.position !== null, valid: p.valid },
    );
  }

  private updateFromPointer(event: PointerEvent): void {
    this.picker.setFromEvent(event);
    const point = this.picker.floorPoint(0);
    if (point) this.movePlacement(point.x, point.z);
  }

  private onPointerMove = (event: PointerEvent) => {
    // Com mouse, o fantasma segue o cursor (exceto enquanto arrasta a câmera).
    // No toque não existe "hover": o fantasma só se move quando o usuário toca.
    if (!this.placement || event.pointerType === 'touch' || event.buttons !== 0) return;
    this.updateFromPointer(event);
  };

  private onPointerDown = (event: PointerEvent) => {
    this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };

  private onPointerUp = (event: PointerEvent) => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > CLICK_TOLERANCE) return; // foi um arrasto de câmera, não um clique
    if (event.button !== 0 || !this.placement) return;

    this.updateFromPointer(event);
    // Mouse: o clique já coloca (Shift mantém o modo para colocar vários).
    // Toque: o toque só posiciona a prévia; o botão "Colocar" confirma.
    if (event.pointerType !== 'touch') this.confirmPlacement(event.shiftKey);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (!this.placement) return;
    if (event.key === 'Escape') this.cancelPlacement();
    else if (event.key === 'r' || event.key === 'R') this.rotatePlacement(90);
  };
}
