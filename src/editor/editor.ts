import * as THREE from 'three';
import type { SceneContext } from '../scene/sceneContext';
import type { HouseData, WallCollider } from '../house/types';
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
import { GRID_STEP, rotatedExtents } from './snapping';
import { PlacementRules, type Candidate, type ItemGeometry } from './rules/placementRules';
import type { History } from './commands/History';
import { AddItems, RemoveItems, UpdateItems, type ItemChange, type ItemPatch } from './commands/itemCommands';

/** Estado público do posicionamento, para a UI mostrar. */
export interface PlacementStatus {
  item: CatalogItem;
  variant: CatalogVariant;
  hasPosition: boolean;
  valid: boolean;
  reason: string | null;
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
  geo: ItemGeometry;
  ghost: Ghost;
  rotation: number;
  candidate: Candidate | null;
  lastRay: THREE.Ray | null;
}

/** Alterações planejadas para um item e para o que estiver apoiado nele. */
interface GroupPlan {
  changes: ItemChange[];
  valid: boolean;
  reason: string | null;
}

interface Drag {
  uid: string;
  pointerId: number;
  /** Diferença entre o centro do item e o ponto agarrado no piso, para o item não "pular". */
  offset: [number, number];
  startClient: { x: number; y: number };
  moved: boolean;
  plan: GroupPlan | null;
}

interface FreeRotation {
  uid: string;
  startClientX: number;
  startRotation: number;
  plan: GroupPlan | null;
}

/** Distância máxima (px) entre pointerdown e pointerup para contar como clique/toque. */
const CLICK_TOLERANCE = 6;
/** Graus por pixel na rotação livre. */
const FREE_ROTATION_SPEED = 0.6;
const WALL_ITEM_ROTATION = 'Itens de parede ficam sempre de frente para o cômodo.';
const NOTHING_IGNORED = new Set<string>();

const normalizeDegrees = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/**
 * Editor da casa: uma pequena máquina de estados.
 * - posicionando: fantasma do catálogo seguindo o cursor;
 * - selecionado: item com destaque, pronto para ações (girar, excluir, duplicar...);
 * - arrastando: item selecionado seguindo o cursor;
 * - girando: rotação livre com o mouse (Shift+R).
 *
 * As regras (colisão, paredes, bancadas) ficam em PlacementRules. Toda alteração no
 * mundo passa pelo History (padrão Command), para poder desfazer.
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
  private readonly rules: PlacementRules;
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
    walls: { occluders: THREE.Object3D[]; colliders: WallCollider[] },
  ) {
    super();
    this.ctx = ctx;
    this.world = world;
    this.view = view;
    this.history = history;
    this.house = house;
    this.occluders = walls.occluders;
    this.picker = new Picker(ctx.camera, ctx.renderer.domElement);
    this.rules = new PlacementRules(house, walls.colliders, world, this.geometryOf);

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
      if (after.uid === this.selectedUid) {
        this.highlight.syncFrameHeight();
        this.emit('selection', after.uid);
      }
    });
    view.on('spawned', ({ uid, object }) => {
      if (uid === this.selectedUid) this.attachHighlight(object);
    });
  }

  // ---------------------------------------------------------------- geometria dos itens

  /** Geometria de um item já colocado (depende do modelo ter carregado). */
  private geometryOf = (uid: string): ItemGeometry | null => {
    const state = this.world.get(uid);
    const item = state && getItem(state.catalogId);
    const object = this.view.objectFor(uid);
    if (!item || !object) return null;
    return {
      montagem: item.montagem,
      footprint: object.userData.footprint as [number, number],
      height: (object.userData.size as THREE.Vector3).y,
      surfaceHeight: object.userData.surfaceHeight as number | undefined,
      colisao: item.colisao !== false,
      alturaParede: item.alturaParede ?? 1.2,
    };
  };

  private geometryFromTemplate(info: VariantTemplate): ItemGeometry {
    return {
      montagem: info.item.montagem,
      footprint: info.footprint,
      height: info.size.y,
      surfaceHeight: info.surfaceHeight,
      colisao: info.item.colisao !== false,
      alturaParede: info.item.alturaParede ?? 1.2,
    };
  }

  /** Itens apoiados em cima de `uid` (micro-ondas sobre o balcão, abajur sobre o criado-mudo...). */
  private dependentsOf(uid: string): ItemState[] {
    return this.world.all().filter((item) => item.apoio === uid);
  }

  /** O item e o que está em cima dele não contam como obstáculo para eles mesmos. */
  private groupOf(uid: string): Set<string> {
    return new Set([uid, ...this.dependentsOf(uid).map((d) => d.uid)]);
  }

  private roomAt(x: number, z: number): string | null {
    return findRoomAt(this.house.comodos, x, z)?.id ?? null;
  }

  /**
   * Planeja mover/girar/trocar um item para a posição `c`, levando junto (transladados e
   * girados em torno dele) os itens apoiados em cima. `supportGeo` permite usar a
   * geometria de uma variante nova (altura do tampo e tamanho podem mudar).
   */
  private planGroup(uid: string, c: Candidate, extra: ItemPatch = {}, supportGeo?: ItemGeometry): GroupPlan {
    const state = this.world.get(uid)!;
    const after: ItemPatch = {
      ...extra,
      posicao: [c.x, c.y, c.z],
      rotacao: c.rotation,
      apoio: c.apoio,
      parede: c.parede,
      comodo: this.roomAt(c.x, c.z),
    };
    const changes: ItemChange[] = [{ uid, before: pick(state, after), after }];
    if (!c.valid) return { changes, valid: false, reason: c.reason };

    const geo = supportGeo ?? this.geometryOf(uid);
    const dependents = this.dependentsOf(uid);
    if (!geo || dependents.length === 0) return { changes, valid: true, reason: null };
    if (geo.surfaceHeight === undefined) {
      return { changes, valid: false, reason: 'Esta variante não tem tampo para o que está em cima' };
    }

    const delta = c.rotation - state.rotacao;
    const rad = THREE.MathUtils.degToRad(delta);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const [sw, sd] = rotatedExtents(geo.footprint[0], geo.footprint[1], c.rotation);
    const ignore = this.groupOf(uid);
    for (const dep of dependents) {
      const depGeo = this.geometryOf(dep.uid);
      if (!depGeo) continue;
      // Mesma rotação do three (rotation.y): (x, z) → (x·cos + z·sin, −x·sin + z·cos).
      const dx = dep.posicao[0] - state.posicao[0];
      const dz = dep.posicao[2] - state.posicao[2];
      const x = c.x + dx * cos + dz * sin;
      const z = c.z - dx * sin + dz * cos;
      const y = c.y + geo.surfaceHeight;
      const rotation = normalizeDegrees(dep.rotacao + delta);
      const [dw, dd] = rotatedExtents(depGeo.footprint[0], depGeo.footprint[1], rotation);
      const onTop = Math.abs(x - c.x) + dw / 2 <= sw / 2 + 0.01 && Math.abs(z - c.z) + dd / 2 <= sd / 2 + 0.01;
      const reason = onTop ? this.rules.check(depGeo, x, y, z, rotation, ignore) : 'Cairia de cima do móvel';
      if (reason) {
        const name = getItem(dep.catalogId)?.nome ?? 'Item';
        return { changes, valid: false, reason: `${name} em cima: ${reason.toLowerCase()}` };
      }
      const depAfter: ItemPatch = { posicao: [x, y, z], rotacao: rotation, comodo: this.roomAt(x, z) };
      changes.push({ uid: dep.uid, before: pick(dep, depAfter), after: depAfter });
    }
    return { changes, valid: true, reason: null };
  }

  /** Mostra o plano na cena (só os objetos 3D; o estado não muda). */
  private previewPlan(plan: GroupPlan): void {
    for (const change of plan.changes) {
      const obj = this.view.objectFor(change.uid);
      if (!obj) continue;
      if (change.after.posicao) obj.position.set(...change.after.posicao);
      if (change.after.rotacao !== undefined) obj.rotation.y = THREE.MathUtils.degToRad(change.after.rotacao);
    }
    this.highlight.syncFrameHeight();
    this.highlight.setValid(plan.valid);
    this.ctx.requestRender();
  }

  /** Devolve o item e o que está em cima dele à posição salva no estado. */
  private resetGroup(uid: string): void {
    for (const id of this.groupOf(uid)) {
      const state = this.world.get(id);
      if (state) this.view.resetTransform(id, state);
    }
    this.highlight.syncFrameHeight();
    this.highlight.setValid(true);
    this.ctx.requestRender();
  }

  private commitPlan(plan: GroupPlan, label: string): void {
    const [main] = plan.changes;
    const state = this.world.get(main.uid);
    const unchanged =
      state &&
      plan.changes.length === 1 &&
      Object.entries(main.after).every(([k, v]) => JSON.stringify(v) === JSON.stringify(state[k as keyof ItemState]));
    if (!unchanged) this.history.execute(new UpdateItems(this.world, plan.changes, label));
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

  /** Item do estado + do catálogo + geometria do item selecionado, se tudo existir. */
  private selected() {
    const uid = this.selectedUid;
    const state = uid ? this.world.get(uid) : undefined;
    const catalogItem = state ? getItem(state.catalogId) : undefined;
    const geo = uid ? this.geometryOf(uid) : null;
    if (!uid || !state || !catalogItem || !geo) return null;
    return { uid, state, catalogItem, geo };
  }

  // ---------------------------------------------------------------- ações no item selecionado

  /** Planeja girar o item selecionado para `degrees` (ajustando posição se encostar em parede). */
  private planRotation(degrees: number): GroupPlan | null {
    const s = this.selected();
    if (!s) return null;
    const [x, , z] = s.state.posicao;
    const c = this.rules.fromPosition(s.geo, x, z, normalizeDegrees(degrees), this.groupOf(s.uid), s.state.apoio ?? null);
    return this.planGroup(s.uid, c);
  }

  rotateSelected(degrees: number): void {
    const s = this.selected();
    if (!s) return;
    if (s.geo.montagem === 'parede') {
      this.emit('message', WALL_ITEM_ROTATION);
      return;
    }
    const plan = this.planRotation(s.state.rotacao + degrees)!;
    if (!plan.valid) this.emit('message', `Não dá para girar aqui: ${plan.reason?.toLowerCase()}.`);
    else this.commitPlan(plan, `Girar ${s.catalogItem.nome}`);
  }

  /**
   * Rotação contínua (slider do inspetor): com commit=false só mostra a prévia;
   * com commit=true grava no histórico (ou volta, se for inválida).
   */
  setSelectedRotation(degrees: number, commit: boolean): void {
    const s = this.selected();
    if (!s) return;
    if (s.geo.montagem === 'parede') {
      if (commit) {
        this.emit('message', WALL_ITEM_ROTATION);
        this.emit('selection', s.uid); // devolve o slider ao valor real
      }
      return;
    }
    const plan = this.planRotation(degrees)!;
    if (!commit) {
      this.previewPlan(plan);
      return;
    }
    if (plan.valid) {
      this.commitPlan(plan, `Girar ${s.catalogItem.nome}`);
    } else {
      this.resetGroup(s.uid);
      this.emit('message', `Não dá para girar aqui: ${plan.reason?.toLowerCase()}.`);
    }
    this.emit('selection', s.uid);
  }

  deleteSelected(): void {
    const s = this.selected();
    if (!s) return;
    const dependents = this.dependentsOf(s.uid);
    const label = `Excluir ${s.catalogItem.nome}${dependents.length ? ` e ${dependents.length} item(ns) em cima` : ''}`;
    this.history.execute(new RemoveItems(this.world, [s.state, ...dependents], label));
  }

  /** Duplica ao lado do original (direita, esquerda, frente ou trás, o primeiro que couber). */
  duplicateSelected(): void {
    const s = this.selected();
    if (!s) return;
    const [x, , z] = s.state.posicao;
    const [ew, ed] = rotatedExtents(s.geo.footprint[0], s.geo.footprint[1], s.state.rotacao);
    // No piso, passos múltiplos do grid; sobre bancadas e paredes, colado ao lado.
    const onGrid = s.geo.montagem === 'piso' || !s.state.apoio;
    const stepX = onGrid ? Math.ceil(ew / GRID_STEP) * GRID_STEP : ew + 0.02;
    const stepZ = onGrid ? Math.ceil(ed / GRID_STEP) * GRID_STEP : ed + 0.02;
    const offsets: [number, number][] = [[stepX, 0], [-stepX, 0], [0, stepZ], [0, -stepZ]];
    for (const [dx, dz] of offsets) {
      const c = this.rules.fromPosition(s.geo, x + dx, z + dz, s.state.rotacao, NOTHING_IGNORED, s.state.apoio ?? null);
      const moved = Math.abs(c.x - x) > 0.01 || Math.abs(c.z - z) > 0.01;
      if (!c.valid || !moved) continue;
      const copy: ItemState = {
        ...s.state,
        uid: newUid(),
        posicao: [c.x, c.y, c.z],
        rotacao: c.rotation,
        apoio: c.apoio,
        parede: c.parede,
        comodo: this.roomAt(c.x, c.z),
      };
      this.history.execute(new AddItems(this.world, [copy], `Duplicar ${s.catalogItem.nome}`));
      this.select(copy.uid);
      return;
    }
    this.emit('message', 'Sem espaço ao lado para duplicar.');
  }

  async changeSelectedVariant(variantId: string): Promise<void> {
    const s = this.selected();
    if (!s || s.state.variante === variantId) return;
    const variant = getVariant(s.catalogItem, variantId);
    // Carrega a variante para saber o tamanho dela antes de decidir.
    const info = await acquireVariant(s.catalogItem, variant);
    try {
      const current = this.world.get(s.uid);
      if (!current) return;
      const geo = this.geometryFromTemplate(info);
      const [x, , z] = current.posicao;
      const c = this.rules.fromPosition(geo, x, z, current.rotacao, this.groupOf(s.uid), current.apoio ?? null);
      const plan = this.planGroup(s.uid, c, { variante: variant.id }, geo);
      if (!plan.valid) {
        this.emit('message', `"${variant.nome}" não cabe aqui: ${plan.reason?.toLowerCase()}.`);
        return;
      }
      this.commitPlan(plan, `Trocar para ${variant.nome}`);
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
    if (s.geo.montagem === 'parede') {
      this.emit('message', WALL_ITEM_ROTATION);
      return;
    }
    this.freeRotation = { uid: s.uid, startClientX: this.lastPointerX, startRotation: s.state.rotacao, plan: null };
    this.emit('hint', 'Rotação livre: mova o mouse para os lados · clique confirma · Esc cancela');
  }

  private updateFreeRotation(clientX: number): void {
    const r = this.freeRotation;
    if (!r) return;
    r.plan = this.planRotation(r.startRotation + (clientX - r.startClientX) * FREE_ROTATION_SPEED);
    if (r.plan) this.previewPlan(r.plan);
  }

  private confirmFreeRotation(): void {
    const r = this.freeRotation;
    if (!r) return;
    const plan = r.plan;
    this.cancelFreeRotation();
    if (!plan) return;
    if (!plan.valid) {
      this.emit('message', `Não dá para girar aqui: ${plan.reason?.toLowerCase()}.`);
      return;
    }
    const name = getItem(this.world.get(r.uid)?.catalogId ?? '')?.nome ?? 'item';
    this.commitPlan(plan, `Girar ${name}`);
  }

  /** Sai da rotação livre devolvendo o item à rotação salva no estado. */
  private cancelFreeRotation(): void {
    const r = this.freeRotation;
    if (!r) return;
    this.freeRotation = null;
    this.resetGroup(r.uid);
    this.emit('hint', null);
  }

  // ---------------------------------------------------------------- arrastar

  private startDrag(event: PointerEvent): boolean {
    const s = this.selected();
    const hit = this.picker.floorPoint(0);
    if (!s || !hit) return false;
    // Só móveis de piso mantêm o ponto agarrado; itens de parede e de bancada
    // seguem o cursor diretamente (são pequenos e mudam de superfície).
    const offset: [number, number] =
      s.geo.montagem === 'piso' ? [s.state.posicao[0] - hit.x, s.state.posicao[2] - hit.z] : [0, 0];
    this.drag = {
      uid: s.uid,
      pointerId: event.pointerId,
      offset,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
      plan: null,
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
    const c = this.rules.fromRay(s.geo, this.picker.raycaster.ray, s.state.rotacao, this.groupOf(s.uid), d.offset);
    if (!c) return;
    // Durante o arrasto mexemos só nos objetos 3D; o estado muda uma vez, ao soltar.
    d.plan = this.planGroup(s.uid, c);
    this.previewPlan(d.plan);
  }

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.ctx.renderer.domElement.style.cursor = '';
    const name = getItem(this.world.get(d.uid)?.catalogId ?? '')?.nome ?? 'item';
    if (commit && d.moved && d.plan?.valid) {
      this.commitPlan(d.plan, `Mover ${name}`);
      this.highlight.setValid(true);
      return;
    }
    this.resetGroup(d.uid);
    if (commit && d.moved && d.plan && !d.plan.valid) {
      this.emit('message', `${d.plan.reason ?? 'Posição inválida'}: o item voltou para onde estava.`);
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
    this.placement = { info, geo: this.geometryFromTemplate(info), ghost, rotation: 0, candidate: null, lastRay: null };
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
    if (p.geo.montagem === 'parede') {
      this.emit('message', WALL_ITEM_ROTATION);
      return;
    }
    p.rotation = normalizeDegrees(p.rotation + degrees);
    if (p.lastRay) this.movePlacement(p.lastRay);
  }

  /** Coloca o item onde está o fantasma. Devolve false se a posição não for válida. */
  confirmPlacement(keepPlacing = false): boolean {
    const p = this.placement;
    const c = p?.candidate;
    if (!p || !c || !c.valid) return false;
    const item: ItemState = {
      uid: newUid(),
      catalogId: p.info.item.id,
      variante: p.info.variant.id,
      posicao: [c.x, c.y, c.z],
      rotacao: c.rotation,
      comodo: this.roomAt(c.x, c.z),
      apoio: c.apoio,
      parede: c.parede,
    };
    this.history.execute(new AddItems(this.world, [item], `Adicionar ${p.info.item.nome}`));
    if (keepPlacing) {
      if (p.lastRay) this.movePlacement(p.lastRay); // revalida: agora há um item ali
    } else {
      this.cancelPlacement();
      this.select(item.uid); // já deixa o item novo selecionado para ajustes
    }
    return true;
  }

  /** Move o fantasma para onde o raio aponta, aplicando as regras. */
  private movePlacement(ray: THREE.Ray): void {
    const p = this.placement;
    if (!p) return;
    p.lastRay = ray.clone();
    const c = this.rules.fromRay(p.geo, ray, p.rotation, NOTHING_IGNORED);
    if (!c) return;
    p.candidate = c;
    p.ghost.object.visible = true;
    p.ghost.update(new THREE.Vector3(c.x, c.y, c.z), c.rotation, c.valid);
    this.ctx.requestRender();
    this.emitPlacement();
  }

  private emitPlacement(): void {
    const p = this.placement;
    this.emit(
      'placement',
      p && {
        item: p.info.item,
        variant: p.info.variant,
        hasPosition: p.candidate !== null,
        valid: p.candidate?.valid ?? false,
        reason: p.candidate?.reason ?? null,
      },
    );
  }

  private updatePlacementFromPointer(event: PointerEvent): void {
    this.picker.setFromEvent(event);
    this.movePlacement(this.picker.raycaster.ray);
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

/** Valores atuais dos mesmos campos de `patch` (o "antes" de um comando). */
function pick(state: ItemState, patch: ItemPatch): ItemPatch {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = state[key as keyof ItemState] ?? null;
  return before as ItemPatch;
}
