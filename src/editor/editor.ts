import * as THREE from 'three';
import type { SceneContext } from '../scene/sceneContext';
import type { HouseData } from '../house/types';
import { findRoomAt } from '../house/roomLookup';
import type { CatalogItem, CatalogVariant } from '../catalog/types';
import { getItem, getVariant } from '../catalog/catalog';
import { acquireVariant, releaseVariant, type VariantTemplate } from '../catalog/variants';
import { newUid, type ItemState, type World } from '../state/world';
import type { WorldView } from '../state/worldView';
import { Emitter } from '../utils/emitter';
import { Picker } from './picking';
import { Ghost } from './ghost';
import { SelectionHighlight } from './highlight';
import { GRID_STEP, footprintInsideHouse, rotatedExtents, roundMm, snapToGrid } from './snapping';
import type { History } from './commands/History';
import { AddItems, RemoveItems, updateItem } from './commands/itemCommands';

/** Estado público do posicionamento, para a UI mostrar. */
export interface PlacementStatus {
  item: CatalogItem;
  variant: CatalogVariant;
  hasPosition: boolean;
  valid: boolean;
}

type EditorEvents = {
  placement: PlacementStatus | null;
  /** uid do item selecionado (ou null). Também é emitido quando o item selecionado muda. */
  selection: string | null;
  /** Aviso curto para o usuário (ex.: ação recusada). */
  message: string;
  /** Instrução fixa enquanto um modo estiver ativo (ou null para limpar). */
  hint: string | null;
};

interface Placement {
  info: VariantTemplate;
  ghost: Ghost;
  rotation: number;
  position: THREE.Vector3 | null;
  valid: boolean;
}

interface Drag {
  uid: string;
  pointerId: number;
  /** Diferença entre o centro do item e o ponto agarrado, para o item não "pular" para o cursor. */
  offsetX: number;
  offsetZ: number;
  startClient: { x: number; y: number };
  moved: boolean;
  x: number;
  z: number;
  valid: boolean;
}

interface FreeRotation {
  uid: string;
  startClientX: number;
  startRotation: number;
  rotation: number;
  valid: boolean;
}

/** Distância máxima (px) entre pointerdown e pointerup para contar como clique/toque. */
const CLICK_TOLERANCE = 6;
/** Graus por pixel na rotação livre. */
const FREE_ROTATION_SPEED = 0.6;

const normalizeDegrees = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/**
 * Editor da casa: uma pequena máquina de estados.
 * - posicionando: fantasma do catálogo seguindo o cursor;
 * - selecionado: item com destaque, pronto para ações (girar, excluir, duplicar...);
 * - arrastando: item selecionado seguindo o cursor no plano do piso;
 * - girando: rotação livre com o mouse (Shift+R).
 *
 * Toda alteração no mundo passa pelo History (padrão Command), para poder desfazer.
 */
export class Editor extends Emitter<EditorEvents> {
  private readonly ctx: SceneContext;
  private readonly world: World;
  private readonly view: WorldView;
  private readonly history: History;
  private readonly house: HouseData;
  /** Malhas que escondem itens atrás delas no raycasting (paredes). */
  private readonly occluders: THREE.Object3D[];
  private readonly picker: Picker;
  private readonly highlight = new SelectionHighlight();

  private placement: Placement | null = null;
  private placementToken = 0;
  private selectedUid: string | null = null;
  private drag: Drag | null = null;
  private freeRotation: FreeRotation | null = null;
  private pointerStart: { x: number; y: number; id: number } | null = null;
  private lastPointerX = 0;

  constructor(
    ctx: SceneContext,
    world: World,
    view: WorldView,
    history: History,
    house: HouseData,
    occluders: THREE.Object3D[],
  ) {
    super();
    this.ctx = ctx;
    this.world = world;
    this.view = view;
    this.history = history;
    this.house = house;
    this.occluders = occluders;
    this.picker = new Picker(ctx.camera, ctx.renderer.domElement);

    const dom = ctx.renderer.domElement;
    // pointerdown em fase de CAPTURA: roda antes do listener do OrbitControls no mesmo
    // elemento. Assim, ao agarrar um item, impedimos que a câmera comece a girar.
    dom.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);

    // Mantém a seleção coerente com o mundo (desfazer pode remover ou recriar o item).
    world.on('removed', (item) => {
      if (item.uid === this.selectedUid) this.select(null);
    });
    world.on('changed', ({ after }) => {
      if (after.uid === this.selectedUid) this.emit('selection', after.uid);
    });
    view.on('spawned', ({ uid, object }) => {
      if (uid === this.selectedUid) this.attachHighlight(object);
    });
  }

  // ---------------------------------------------------------------- seleção

  get selection(): string | null {
    return this.selectedUid;
  }

  select(uid: string | null): void {
    this.cancelFreeRotation();
    this.highlight.detach();
    this.selectedUid = uid;
    const object = uid ? this.view.objectFor(uid) : undefined;
    if (object) this.attachHighlight(object);
    this.ctx.requestRender();
    this.emit('selection', uid);
  }

  private attachHighlight(object: THREE.Object3D): void {
    this.highlight.attach(object, object.userData.footprint as [number, number]);
    this.ctx.requestRender();
  }

  /** Item do estado + do catálogo + objeto 3D do item selecionado, se tudo existir. */
  private selected() {
    const uid = this.selectedUid;
    const state = uid ? this.world.get(uid) : undefined;
    const catalogItem = state ? getItem(state.catalogId) : undefined;
    const object = uid ? this.view.objectFor(uid) : undefined;
    if (!uid || !state || !catalogItem || !object) return null;
    return { uid, state, catalogItem, object, footprint: object.userData.footprint as [number, number] };
  }

  // ---------------------------------------------------------------- regras

  /** Nesta fase, uma posição é válida se o footprint cabe dentro da casa. */
  private isValidSpot(footprint: [number, number], x: number, z: number, rotation: number): boolean {
    return footprintInsideHouse(this.house.comodos, x, z, footprint[0], footprint[1], rotation);
  }

  private roomAt(x: number, z: number): string | null {
    return findRoomAt(this.house.comodos, x, z)?.id ?? null;
  }

  // ---------------------------------------------------------------- ações no item selecionado

  rotateSelected(degrees: number): void {
    const s = this.selected();
    if (!s) return;
    const rotation = normalizeDegrees(s.state.rotacao + degrees);
    const [x, , z] = s.state.posicao;
    if (!this.isValidSpot(s.footprint, x, z, rotation)) {
      this.emit('message', 'Não dá para girar aqui: o item sairia da casa.');
      return;
    }
    this.history.execute(updateItem(this.world, s.uid, { rotacao: rotation }, `Girar ${s.catalogItem.nome}`));
  }

  /**
   * Rotação contínua (slider do inspetor): com commit=false só mostra a prévia;
   * com commit=true grava no histórico (ou volta, se for inválida).
   */
  setSelectedRotation(degrees: number, commit: boolean): void {
    const s = this.selected();
    if (!s) return;
    const rotation = normalizeDegrees(degrees);
    const [x, , z] = s.state.posicao;
    const valid = this.isValidSpot(s.footprint, x, z, rotation);
    if (!commit) {
      s.object.rotation.y = THREE.MathUtils.degToRad(rotation);
      this.highlight.setValid(valid);
      this.ctx.requestRender();
      return;
    }
    this.highlight.setValid(true);
    if (!valid) {
      this.view.resetTransform(s.uid, s.state);
      this.ctx.requestRender();
      this.emit('message', 'Não dá para girar aqui: o item sairia da casa.');
      this.emit('selection', s.uid);
      return;
    }
    if (rotation !== s.state.rotacao) {
      this.history.execute(updateItem(this.world, s.uid, { rotacao: rotation }, `Girar ${s.catalogItem.nome}`));
    }
  }

  deleteSelected(): void {
    const s = this.selected();
    if (!s) return;
    this.history.execute(new RemoveItems(this.world, [s.state], `Excluir ${s.catalogItem.nome}`));
  }

  /** Duplica ao lado do original (direita, esquerda, frente ou trás, o primeiro que couber). */
  duplicateSelected(): void {
    const s = this.selected();
    if (!s) return;
    const [x, y, z] = s.state.posicao;
    const [ew, ed] = rotatedExtents(s.footprint[0], s.footprint[1], s.state.rotacao);
    const stepX = Math.ceil(ew / GRID_STEP) * GRID_STEP;
    const stepZ = Math.ceil(ed / GRID_STEP) * GRID_STEP;
    const candidates: [number, number][] = [
      [x + stepX, z],
      [x - stepX, z],
      [x, z + stepZ],
      [x, z - stepZ],
    ];
    const spot = candidates.find(([cx, cz]) => this.isValidSpot(s.footprint, cx, cz, s.state.rotacao));
    if (!spot) {
      this.emit('message', 'Sem espaço ao lado para duplicar.');
      return;
    }
    const copy: ItemState = {
      ...s.state,
      uid: newUid(),
      posicao: [roundMm(spot[0]), y, roundMm(spot[1])],
      comodo: this.roomAt(spot[0], spot[1]),
    };
    this.history.execute(new AddItems(this.world, [copy], `Duplicar ${s.catalogItem.nome}`));
    this.select(copy.uid);
  }

  async changeSelectedVariant(variantId: string): Promise<void> {
    const s = this.selected();
    if (!s || s.state.variante === variantId) return;
    const variant = getVariant(s.catalogItem, variantId);
    // Carrega a variante para saber o footprint dela antes de decidir.
    const info = await acquireVariant(s.catalogItem, variant);
    try {
      const current = this.world.get(s.uid);
      if (!current) return;
      const [x, , z] = current.posicao;
      if (!this.isValidSpot(info.footprint, x, z, current.rotacao)) {
        this.emit('message', `"${variant.nome}" não cabe nesta posição.`);
        return;
      }
      this.history.execute(updateItem(this.world, s.uid, { variante: variant.id }, `Trocar para ${variant.nome}`));
    } finally {
      releaseVariant(info.key);
    }
  }

  undo(): void {
    this.cancelTransient();
    this.history.undo();
  }

  redo(): void {
    this.cancelTransient();
    this.history.redo();
  }

  // ---------------------------------------------------------------- rotação livre (Shift+R)

  private startFreeRotation(): void {
    const s = this.selected();
    if (!s) return;
    this.freeRotation = {
      uid: s.uid,
      startClientX: this.lastPointerX,
      startRotation: s.state.rotacao,
      rotation: s.state.rotacao,
      valid: true,
    };
    this.emit('hint', 'Rotação livre: mova o mouse para os lados · clique confirma · Esc cancela');
  }

  private updateFreeRotation(clientX: number): void {
    const r = this.freeRotation;
    const s = this.selected();
    if (!r || !s) return;
    r.rotation = normalizeDegrees(r.startRotation + (clientX - r.startClientX) * FREE_ROTATION_SPEED);
    const [x, , z] = s.state.posicao;
    r.valid = this.isValidSpot(s.footprint, x, z, r.rotation);
    s.object.rotation.y = THREE.MathUtils.degToRad(r.rotation);
    this.highlight.setValid(r.valid);
    this.ctx.requestRender();
  }

  private confirmFreeRotation(): void {
    const r = this.freeRotation;
    if (!r) return;
    const valid = r.valid;
    const rotation = r.rotation;
    this.cancelFreeRotation();
    if (!valid) {
      this.emit('message', 'Não dá para girar aqui: o item sairia da casa.');
      return;
    }
    const s = this.selected();
    if (s && rotation !== s.state.rotacao) {
      this.history.execute(updateItem(this.world, s.uid, { rotacao: rotation }, `Girar ${s.catalogItem.nome}`));
    }
  }

  /** Sai da rotação livre devolvendo o item à rotação salva no estado. */
  private cancelFreeRotation(): void {
    const r = this.freeRotation;
    if (!r) return;
    this.freeRotation = null;
    const state = this.world.get(r.uid);
    if (state) this.view.resetTransform(r.uid, state);
    this.highlight.setValid(true);
    this.ctx.requestRender();
    this.emit('hint', null);
  }

  // ---------------------------------------------------------------- arrastar

  private startDrag(event: PointerEvent): boolean {
    const s = this.selected();
    const hit = this.picker.floorPoint(0);
    if (!s || !hit) return false;
    this.drag = {
      uid: s.uid,
      pointerId: event.pointerId,
      offsetX: s.state.posicao[0] - hit.x,
      offsetZ: s.state.posicao[2] - hit.z,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
      x: s.state.posicao[0],
      z: s.state.posicao[2],
      valid: true,
    };
    // Captura o ponteiro: os eventos continuam chegando mesmo se o dedo/mouse sair do canvas.
    this.ctx.renderer.domElement.setPointerCapture(event.pointerId);
    this.ctx.renderer.domElement.style.cursor = 'grabbing';
    return true;
  }

  private updateDrag(event: PointerEvent): void {
    const d = this.drag;
    const s = this.selected();
    if (!d || !s) return;
    if (!d.moved && Math.hypot(event.clientX - d.startClient.x, event.clientY - d.startClient.y) < CLICK_TOLERANCE) return;
    d.moved = true;
    this.picker.setFromEvent(event);
    const hit = this.picker.floorPoint(0);
    if (!hit) return;
    const [x, z] = snapToGrid(hit.x + d.offsetX, hit.z + d.offsetZ, s.footprint[0], s.footprint[1], s.state.rotacao);
    d.x = x;
    d.z = z;
    d.valid = this.isValidSpot(s.footprint, x, z, s.state.rotacao);
    // Durante o arrasto mexemos só no objeto 3D; o estado muda uma vez, ao soltar.
    s.object.position.set(x, s.state.posicao[1], z);
    this.highlight.setValid(d.valid);
    this.ctx.requestRender();
  }

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.ctx.renderer.domElement.style.cursor = '';
    this.highlight.setValid(true);
    const state = this.world.get(d.uid);
    if (!state) return;
    const [x0, y, z0] = state.posicao;
    const changed = d.x !== x0 || d.z !== z0;
    if (commit && d.moved && d.valid && changed) {
      const item = getItem(state.catalogId);
      this.history.execute(
        updateItem(this.world, d.uid, { posicao: [d.x, y, d.z], comodo: this.roomAt(d.x, d.z) }, `Mover ${item?.nome ?? 'item'}`),
      );
    } else {
      this.view.resetTransform(d.uid, state);
      this.ctx.requestRender();
      if (commit && d.moved && !d.valid) this.emit('message', 'Posição inválida: o item voltou para onde estava.');
    }
  }

  /** Cancela arrasto/rotação em andamento (ex.: antes de desfazer). */
  private cancelTransient(): void {
    this.endDrag(false);
    this.cancelFreeRotation();
  }

  // ---------------------------------------------------------------- posicionar (catálogo)

  /** Entra no modo de posicionamento com a variante escolhida no catálogo. */
  async startPlacement(item: CatalogItem, variant: CatalogVariant): Promise<void> {
    this.cancelPlacement();
    this.select(null);
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
    p.rotation = normalizeDegrees(p.rotation + degrees);
    if (p.position) this.movePlacement(p.position.x, p.position.z);
  }

  /** Coloca o item onde está o fantasma. Devolve false se a posição não for válida. */
  confirmPlacement(keepPlacing = false): boolean {
    const p = this.placement;
    if (!p || !p.position || !p.valid) return false;
    const { x, y, z } = p.position;
    const item: ItemState = {
      uid: newUid(),
      catalogId: p.info.item.id,
      variante: p.info.variant.id,
      posicao: [x, y, z],
      rotacao: p.rotation,
      comodo: this.roomAt(x, z),
    };
    this.history.execute(new AddItems(this.world, [item], `Adicionar ${p.info.item.nome}`));
    if (!keepPlacing) {
      this.cancelPlacement();
      this.select(item.uid); // já deixa o item novo selecionado para ajustes
    }
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
    p.valid = this.isValidSpot(p.info.footprint, sx, sz, p.rotation);
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

  private updatePlacementFromPointer(event: PointerEvent): void {
    this.picker.setFromEvent(event);
    const point = this.picker.floorPoint(0);
    if (point) this.movePlacement(point.x, point.z);
  }

  // ---------------------------------------------------------------- raycasting

  /**
   * uid do item sob o ponteiro. Testamos itens E paredes: se uma parede vier antes,
   * o item está escondido atrás dela e não deve ser selecionado.
   */
  private pickItem(): string | null {
    const hits = this.picker.raycaster.intersectObjects([this.view.group, ...this.occluders], true);
    const first = hits[0];
    if (!first) return null;
    let obj: THREE.Object3D | null = first.object;
    while (obj && obj.userData.uid === undefined) obj = obj.parent;
    return obj ? (obj.userData.uid as string) : null;
  }

  // ---------------------------------------------------------------- eventos

  private onPointerDown = (event: PointerEvent) => {
    // Durante um arrasto, outros dedos não fazem nada (nem giram a câmera).
    if (this.drag) {
      event.stopImmediatePropagation();
      return;
    }
    if (this.freeRotation) {
      event.stopImmediatePropagation();
      this.confirmFreeRotation();
      return;
    }
    this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (this.placement || (event.pointerType === 'mouse' && event.button !== 0)) return;

    // Agarrou o item selecionado? Então é arrasto, e a câmera não deve se mexer.
    this.picker.setFromEvent(event);
    if (this.selectedUid && this.pickItem() === this.selectedUid && this.startDrag(event)) {
      event.stopImmediatePropagation();
      this.pointerStart = null;
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    this.lastPointerX = event.clientX;
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.updateDrag(event);
      return;
    }
    if (this.freeRotation) {
      this.updateFreeRotation(event.clientX);
      return;
    }
    // Com mouse, o fantasma segue o cursor (exceto enquanto arrasta a câmera).
    // No toque não existe "hover": o fantasma só se move quando o usuário toca.
    if (event.pointerType === 'touch' || event.buttons !== 0) return;
    if (this.placement) {
      this.updatePlacementFromPointer(event);
    } else if (this.selectedUid) {
      // Cursor de "mãozinha" ao passar sobre o item selecionado: dá para arrastar.
      this.picker.setFromEvent(event);
      this.ctx.renderer.domElement.style.cursor = this.pickItem() === this.selectedUid ? 'grab' : '';
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      // Se não houve movimento, foi só um clique no item já selecionado: endDrag não grava nada.
      this.endDrag(true);
      return;
    }

    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > CLICK_TOLERANCE) return; // foi um arrasto de câmera, não um clique
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    if (this.placement) {
      this.updatePlacementFromPointer(event);
      // Mouse: o clique já coloca (Shift mantém o modo para colocar vários).
      // Toque: o toque só posiciona a prévia; o botão "Colocar" confirma.
      if (event.pointerType !== 'touch') this.confirmPlacement(event.shiftKey);
      return;
    }

    // Clique/toque simples: seleciona o item sob o ponteiro, ou desmarca se for o vazio.
    this.picker.setFromEvent(event);
    this.select(this.pickItem());
  };

  private onPointerCancel = (event: PointerEvent) => {
    if (this.drag && event.pointerId === this.drag.pointerId) this.endDrag(false);
    this.pointerStart = null;
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;

    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      this.redo();
    } else if (mod && key === 'd') {
      event.preventDefault(); // Ctrl+D no navegador = favoritar a página
      this.duplicateSelected();
    } else if (key === 'escape') {
      if (this.freeRotation) this.cancelFreeRotation();
      else if (this.drag) this.endDrag(false);
      else if (this.placement) this.cancelPlacement();
      else this.select(null);
    } else if (key === 'r' && !mod) {
      if (this.placement) this.rotatePlacement(90);
      else if (this.freeRotation) this.confirmFreeRotation();
      else if (event.shiftKey) this.startFreeRotation();
      else this.rotateSelected(90);
    } else if (key === 'delete' || key === 'backspace') {
      if (!this.selectedUid) return;
      event.preventDefault();
      this.cancelTransient();
      this.deleteSelected();
    }
  };
}
