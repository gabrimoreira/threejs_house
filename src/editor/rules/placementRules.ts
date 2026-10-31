import * as THREE from 'three';
import type { HouseData, WallCollider } from '../../house/types';
import { findRoomAt } from '../../house/roomLookup';
import type { Mounting } from '../../catalog/types';
import type { World } from '../../state/world';
import { boxAt, EPS, overlaps, type Box } from '../../utils/aabb';
import { rotatedExtents, roundMm, snapToGrid } from '../snapping';
import { computeWallFaces, type WallFace } from './wallFaces';

/** O que as regras precisam saber de um item para posicioná-lo. */
export interface ItemGeometry {
  montagem: Mounting;
  footprint: [number, number];
  height: number;
  /** Altura do tampo, se outros itens podem ficar em cima. */
  surfaceHeight?: number;
  colisao: boolean;
  alturaParede: number;
}

/** Posição proposta para um item, já ajustada pelas regras, e se ela é válida. */
export interface Candidate {
  x: number;
  y: number;
  z: number;
  rotation: number;
  apoio: string | null;
  parede: string | null;
  valid: boolean;
  /** Motivo de ser inválida, para mostrar ao usuário. */
  reason: string | null;
}

/** Distância (m) em que um móvel "gruda" na parede mais próxima. */
const MAGNET = 0.2;
/** Passo fino usado sobre bancadas e ao longo das paredes. */
const FINE_STEP = 0.05;

const snapFine = (v: number) => Math.round(v / FINE_STEP) * FINE_STEP;
const clamp = THREE.MathUtils.clamp;

/**
 * Regras do mundo:
 * - colisão por AABB entre itens e com paredes (e a folga das portas);
 * - nada sai da casa;
 * - itens de parede grudam na face interna da parede mais próxima, de frente para o cômodo,
 *   sem invadir portas e janelas;
 * - itens de bancada sobem no tampo de quem tem "superficie", ou ficam no piso;
 * - móveis de piso encostam na parede quando chegam perto (ímã) e são empurrados para
 *   fora dela quando a atravessam.
 */
export class PlacementRules {
  private readonly house: HouseData;
  private readonly colliders: WallCollider[];
  private readonly world: World;
  private readonly geometryOf: (uid: string) => ItemGeometry | null;
  private readonly faces: WallFace[];

  constructor(house: HouseData, colliders: WallCollider[], world: World, geometryOf: (uid: string) => ItemGeometry | null) {
    this.house = house;
    this.colliders = colliders;
    this.world = world;
    this.geometryOf = geometryOf;
    this.faces = computeWallFaces(house);
  }

  /**
   * Posição a partir do ponteiro (raio da câmera). `ignore` são os uids que não contam
   * como obstáculo (o próprio item e o que estiver em cima dele). `offset` mantém o
   * ponto agarrado de um móvel de piso sob o cursor durante o arrasto.
   */
  fromRay(geo: ItemGeometry, ray: THREE.Ray, rotation: number, ignore: Set<string>, offset: [number, number] = [0, 0]): Candidate | null {
    if (geo.montagem === 'parede') {
      // Cruzamos o raio com um plano na meia altura do item: o ponto fica perto
      // de onde o cursor está visualmente, não lá no chão.
      const p = intersectY(ray, geo.alturaParede + geo.height / 2) ?? intersectY(ray, 0);
      return p && this.onWall(geo, p.x, p.z, ignore, true);
    }
    if (geo.montagem === 'bancada') {
      const top = this.supportUnderRay(ray, ignore);
      if (top) return this.onSupport(geo, top.point.x, top.point.z, rotation, top.uid, ignore, true);
    }
    const p = intersectY(ray, 0);
    return p && this.onFloor(geo, p.x + offset[0], p.z + offset[1], rotation, ignore, true);
  }

  /** Revalida (e ajusta) uma posição dada: girar, trocar variante, duplicar. */
  fromPosition(geo: ItemGeometry, x: number, z: number, rotation: number, ignore: Set<string>, apoio: string | null): Candidate {
    if (geo.montagem === 'parede') return this.onWall(geo, x, z, ignore, false);
    if (geo.montagem === 'bancada' && apoio && this.supportRect(apoio, ignore)?.contains(x, z)) {
      return this.onSupport(geo, x, z, rotation, apoio, ignore, false);
    }
    return this.onFloor(geo, x, z, rotation, ignore, false);
  }

  /** Caixa de colisão do item. Quem tem tampo colide só até o tampo (a torneira da pia não conta). */
  boxOf(geo: ItemGeometry, x: number, y: number, z: number, rotation: number): Box {
    const [w, d] = rotatedExtents(geo.footprint[0], geo.footprint[1], rotation);
    return boxAt(x, y, z, w, d, geo.surfaceHeight ?? geo.height);
  }

  /** Motivo pelo qual a caixa não pode ficar ali, ou null se estiver tudo certo. */
  check(geo: ItemGeometry, x: number, y: number, z: number, rotation: number, ignore: Set<string>): string | null {
    const [w, d] = rotatedExtents(geo.footprint[0], geo.footprint[1], rotation);
    if (!this.insideHouse(x, z, w, d)) return 'Fora da casa';
    const box = this.boxOf(geo, x, y, z, rotation);
    for (const c of this.colliders) {
      // A folga da porta só vale para o que bloqueia a passagem: um capacho pode.
      if (c.kind === 'porta' && !geo.colisao) continue;
      if (overlaps(box, c)) return c.kind === 'porta' ? 'Bloquearia uma porta' : 'Atravessa uma parede';
    }
    if (!geo.colisao) return null; // tapetes não esbarram em nada
    for (const other of this.world.all()) {
      if (ignore.has(other.uid)) continue;
      const g = this.geometryOf(other.uid);
      if (!g || !g.colisao) continue;
      const [ox, oy, oz] = other.posicao;
      if (overlaps(box, this.boxOf(g, ox, oy, oz, other.rotacao))) return 'Esbarra em outro móvel';
    }
    return null;
  }

  // ------------------------------------------------------------ piso

  private onFloor(geo: ItemGeometry, x: number, z: number, rotation: number, ignore: Set<string>, snap: boolean): Candidate {
    const [w, d] = geo.footprint;
    if (snap) [x, z] = snapToGrid(x, z, w, d, rotation);
    [x, z] = this.pushFromWalls(x, z, rotation, geo);
    return this.finish(geo, { x: roundMm(x), y: 0, z: roundMm(z), rotation, apoio: null, parede: null }, ignore);
  }

  /**
   * Ímã + empurrão: para cada parede que bloqueia um eixo, calcula quanto mover o
   * item para ficar rente a ela. Se o item atravessa a parede, empurra para o lado
   * onde está o centro dele; se está a menos de MAGNET, puxa até encostar.
   */
  private pushFromWalls(x: number, z: number, rotation: number, geo: ItemGeometry): [number, number] {
    const [w, d] = rotatedExtents(geo.footprint[0], geo.footprint[1], rotation);
    const box = boxAt(x, 0, z, w, d, geo.height);
    const shiftOn = (axis: 'x' | 'z'): number => {
      let push = 0; // atravessando: o maior empurrão necessário
      let pull: number | null = null; // perto: o menor puxão
      for (const c of this.colliders) {
        if (c.blocks !== axis || box.minY >= c.maxY || box.maxY <= c.minY) continue;
        // A parede precisa estar "na frente" do item no outro eixo.
        const sideOverlap =
          axis === 'x' ? box.minZ < c.maxZ - EPS && box.maxZ > c.minZ + EPS : box.minX < c.maxX - EPS && box.maxX > c.minX + EPS;
        if (!sideOverlap) continue;
        const [lo, hi, center, cLo, cHi] =
          axis === 'x' ? [box.minX, box.maxX, x, c.minX, c.maxX] : [box.minZ, box.maxZ, z, c.minZ, c.maxZ];
        const after = center >= (cLo + cHi) / 2; // o item está depois da parede neste eixo?
        const shift = after ? cHi - lo : cLo - hi; // quanto mover para ficar rente
        const crossing = after ? shift > 0 : shift < 0;
        if (crossing) {
          if (Math.abs(shift) > Math.abs(push)) push = shift;
        } else if (Math.abs(shift) < MAGNET && (pull === null || Math.abs(shift) < Math.abs(pull))) {
          pull = shift;
        }
      }
      return push !== 0 ? push : (pull ?? 0);
    };
    return [x + shiftOn('x'), z + shiftOn('z')];
  }

  // ------------------------------------------------------------ bancada

  /** Tampo de apoio atingido primeiro pelo raio (o mais perto da câmera). */
  private supportUnderRay(ray: THREE.Ray, ignore: Set<string>): { uid: string; point: THREE.Vector3 } | null {
    let best: { uid: string; point: THREE.Vector3; distance: number } | null = null;
    for (const item of this.world.all()) {
      const rect = this.supportRect(item.uid, ignore);
      if (!rect) continue;
      const point = intersectY(ray, rect.top);
      if (!point || !rect.contains(point.x, point.z)) continue;
      const distance = ray.origin.distanceTo(point);
      if (!best || distance < best.distance) best = { uid: item.uid, point, distance };
    }
    return best;
  }

  /** Retângulo do tampo de um item que aceita coisas em cima. */
  supportRect(uid: string, ignore: Set<string>) {
    if (ignore.has(uid)) return null;
    const item = this.world.get(uid);
    const geo = this.geometryOf(uid);
    if (!item || !geo || geo.surfaceHeight === undefined) return null;
    const [w, d] = rotatedExtents(geo.footprint[0], geo.footprint[1], item.rotacao);
    const [x, y, z] = item.posicao;
    return {
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      top: y + geo.surfaceHeight,
      contains: (px: number, pz: number) => px >= x - w / 2 && px <= x + w / 2 && pz >= z - d / 2 && pz <= z + d / 2,
    };
  }

  private onSupport(
    geo: ItemGeometry, x: number, z: number, rotation: number, supportUid: string, ignore: Set<string>, snap: boolean,
  ): Candidate {
    const rect = this.supportRect(supportUid, ignore)!;
    const [w, d] = rotatedExtents(geo.footprint[0], geo.footprint[1], rotation);
    const base = { y: rect.top, rotation, apoio: supportUid, parede: null };
    if (w > rect.maxX - rect.minX + EPS || d > rect.maxZ - rect.minZ + EPS) {
      return { ...base, x, z, valid: false, reason: 'Não cabe em cima deste móvel' };
    }
    // Sobre o tampo o passo é fino e o item fica inteiro dentro do retângulo.
    if (snap) {
      x = snapFine(x);
      z = snapFine(z);
    }
    x = clamp(x, rect.minX + w / 2, rect.maxX - w / 2);
    z = clamp(z, rect.minZ + d / 2, rect.maxZ - d / 2);
    return this.finish(geo, { ...base, x: roundMm(x), z: roundMm(z) }, ignore);
  }

  // ------------------------------------------------------------ parede

  private onWall(geo: ItemGeometry, px: number, pz: number, ignore: Set<string>, snap: boolean): Candidate {
    const room = findRoomAt(this.house.comodos, px, pz);
    const options = room ? this.faces.filter((f) => f.roomId === room.id) : this.faces;
    const face = nearestFace(options, px, pz);
    const [w, d] = geo.footprint; // w corre ao longo da face, d sai da parede
    const y = geo.alturaParede;
    const fail = (reason: string): Candidate => ({ x: px, y, z: pz, rotation: 0, apoio: null, parede: null, valid: false, reason });
    if (!face) return fail('Nenhuma parede por perto');
    if (face.max - face.min < w) return fail('Não cabe nesta parede');

    let along = face.axis === 'x' ? px : pz;
    if (snap) along = snapFine(along);
    along = clamp(along, face.min + w / 2, face.max - w / 2);
    const free = avoidOpenings(face, along, w, y, y + geo.height);
    if (free === null) return fail('Sem espaço entre as portas e janelas');

    // Encosta as costas do item na face: o centro fica a d/2 dela, para dentro do cômodo.
    const out = face.fixed + (face.axis === 'x' ? face.normal[1] : face.normal[0]) * (d / 2);
    const [x, z] = face.axis === 'x' ? [free, out] : [out, free];
    // Gira para que a frente do item (+Z local) aponte na direção da normal.
    const rotation = (Math.round(THREE.MathUtils.radToDeg(Math.atan2(face.normal[0], face.normal[1]))) + 360) % 360;
    return this.finish(geo, { x: roundMm(x), y, z: roundMm(z), rotation, apoio: null, parede: face.id }, ignore);
  }

  // ------------------------------------------------------------ comum

  private finish(geo: ItemGeometry, c: Omit<Candidate, 'valid' | 'reason'>, ignore: Set<string>): Candidate {
    const reason = this.check(geo, c.x, c.y, c.z, c.rotation, ignore);
    return { ...c, valid: reason === null, reason };
  }

  /** Os 4 cantos do footprint caem dentro de algum cômodo? */
  private insideHouse(x: number, z: number, w: number, d: number): boolean {
    const e = 1e-3;
    return [
      [x - w / 2 + e, z - d / 2 + e],
      [x + w / 2 - e, z - d / 2 + e],
      [x - w / 2 + e, z + d / 2 - e],
      [x + w / 2 - e, z + d / 2 - e],
    ].every(([cx, cz]) => findRoomAt(this.house.comodos, cx, cz) !== undefined);
  }
}

function intersectY(ray: THREE.Ray, y: number): THREE.Vector3 | null {
  return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
}

/** Face cujo segmento passa mais perto do ponto. */
function nearestFace(faces: WallFace[], px: number, pz: number): WallFace | null {
  let best: WallFace | null = null;
  let bestDist = Infinity;
  for (const f of faces) {
    const along = f.axis === 'x' ? px : pz;
    const across = f.axis === 'x' ? pz : px;
    const overshoot = Math.max(0, f.min - along, along - f.max);
    const dist = Math.hypot(across - f.fixed, overshoot);
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  return best;
}

/**
 * Se o item (largura w, alturas y0..y1) invade um vão de porta/janela, procura a
 * posição livre mais próxima logo ao lado do vão. Devolve null se não houver.
 */
function avoidOpenings(face: WallFace, along: number, w: number, y0: number, y1: number): number | null {
  const blocked = (a: number) =>
    face.openings.some((o) => o.bottom < y1 && o.top > y0 && a - w / 2 < o.max && a + w / 2 > o.min);
  if (!blocked(along)) return along;
  const options = face.openings
    .filter((o) => o.bottom < y1 && o.top > y0)
    .flatMap((o) => [o.min - w / 2 - 0.02, o.max + w / 2 + 0.02])
    .filter((a) => a >= face.min + w / 2 && a <= face.max - w / 2 && !blocked(a))
    .sort((a, b) => Math.abs(a - along) - Math.abs(b - along));
  return options[0] ?? null;
}
