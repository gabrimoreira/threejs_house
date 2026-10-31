import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HouseData, Opening, Room, Wall, WallCollider } from './types';
import { HouseMaterials, WALL_COLORS } from './materials';
import { findRoomAt } from './roomLookup';
import { instantiate, loadTemplate, templateSize } from '../catalog/modelCache';
import { disposeGeometries } from '../utils/dispose';

const DEFAULT_DOOR_MODEL = 'models/casa/doorwayOpen.glb';
/** Folga (m) na frente de cada porta onde não se pode colocar móveis. */
const DOOR_CLEARANCE = 0.5;

/**
 * Trecho de vértices de uma parede pintado com a cor de um cômodo
 * (roomId null = face externa). Usado para repintar sem reconstruir a geometria.
 */
export interface PaintRange {
  roomId: string | null;
  start: number;
  count: number;
}

/** As partes de uma parede, para o modo de visualização cortar/esconder cada uma. */
export interface WallParts {
  wall: Wall;
  group: THREE.Group;
  masonry: THREE.Mesh;
  /** Caixilhos das janelas (ficam fora da alvenaria para sumirem quando a parede é cortada). */
  frames: THREE.Mesh | null;
  glass: THREE.Mesh | null;
  doors: THREE.Object3D[];
}

export interface BuiltHouse {
  group: THREE.Group;
  materials: HouseMaterials;
  /** Malha de piso de cada cômodo, por id. */
  floors: Map<string, THREE.Mesh>;
  /** Malha de alvenaria de cada parede, por id. */
  walls: Map<string, THREE.Mesh>;
  /** Todas as partes de cada parede, por id. */
  wallParts: Map<string, WallParts>;
  /** Caixas de colisão das paredes e das portas, em coordenadas de mundo. */
  colliders: WallCollider[];
  dispose(): void;
}

/**
 * Gera a casa inteira a partir dos dados da planta (house.json):
 * gramado, um piso por cômodo e as paredes com vãos de portas e janelas.
 */
export async function buildHouse(house: HouseData, maxAnisotropy: number): Promise<BuiltHouse> {
  const materials = new HouseMaterials(maxAnisotropy);
  const group = new THREE.Group();
  group.name = 'casa';

  group.add(buildGround(materials));

  const floors = new Map<string, THREE.Mesh>();
  for (const room of house.comodos) {
    const floor = buildFloor(room, house, materials);
    floors.set(room.id, floor);
    group.add(floor);
  }

  const walls = new Map<string, THREE.Mesh>();
  const wallParts = new Map<string, WallParts>();
  const colliders: WallCollider[] = [];
  const doorJobs: Promise<void>[] = [];
  for (const wall of house.paredes) {
    const parts = buildWall(wall, house, materials, colliders);
    walls.set(wall.id, parts.masonry);
    wallParts.set(wall.id, parts);
    group.add(parts.group);
    for (const op of wall.aberturas ?? []) {
      if (op.tipo !== 'porta') continue;
      doorJobs.push(
        addDoor(parts.group, op, house.espessuraParede).then((door) => {
          if (door) parts.doors.push(door);
        }),
      );
    }
  }
  await Promise.all(doorJobs);

  return {
    group,
    materials,
    floors,
    walls,
    wallParts,
    colliders,
    dispose() {
      // As portas usam geometria do cache de modelos: não podem ser descartadas aqui.
      disposeGeometries(group, (obj) => obj.userData.sharedGeometry === true);
      materials.dispose();
    },
  };
}

function buildGround(materials: HouseMaterials): THREE.Mesh {
  // PlaneGeometry nasce no plano XY (de pé); giramos -90° em X para deitá-la no chão.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  ground.name = 'gramado';
  return ground;
}

function buildFloor(room: Room, house: HouseData, materials: HouseMaterials): THREE.Mesh {
  const style = house.pisos[room.piso] ?? { nome: '?', padrao: 'liso', cor: '#bbbbbb' };
  const geometry = new THREE.PlaneGeometry(room.largura, room.profundidade);

  // As UVs da PlaneGeometry vão de 0 a 1. Multiplicando pelo tamanho do cômodo,
  // 1 unidade de UV = 1 metro, e o padrão do piso fica na mesma escala em todo cômodo.
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * room.largura, uv.getY(i) * room.profundidade);
  }

  const floor = new THREE.Mesh(geometry, materials.floor(room.piso, style));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(room.x + room.largura / 2, 0, room.z + room.profundidade / 2);
  floor.receiveShadow = true;
  floor.name = `piso:${room.id}`;
  floor.userData.roomId = room.id;
  return floor;
}

/**
 * Grava uma cor por face numa BoxGeometry (atributo "color", lido quando o material
 * tem vertexColors). A BoxGeometry tem 6 faces de 4 vértices, nesta ordem:
 * +X, -X, +Y, -Y, +Z, -Z.
 */
function paintBox(geometry: THREE.BufferGeometry, faceColors: THREE.Color[]): void {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const c = faceColors[Math.floor(i / 4)];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Uma parede vira um Group posicionado no ponto "de" e girado para que o eixo X local
 * aponte para "ate". Assim todas as contas de vãos são feitas em 1D, ao longo de X.
 *
 * A parede é fatiada em caixas: trechos inteiros entre vãos, e acima/abaixo de cada vão.
 * Também cortamos onde o cômodo vizinho muda, para que cada face receba a cor do cômodo
 * daquele lado. No fim, todas as caixas são fundidas numa única geometria com cores
 * por vértice: uma parede = um draw call. Caixilhos e vidros ficam em malhas à parte.
 */
function buildWall(wall: Wall, house: HouseData, materials: HouseMaterials, colliders: WallCollider[]): WallParts {
  const t = house.espessuraParede;
  const H = house.alturaParede;
  const [x0, z0] = wall.de;
  const [x1, z1] = wall.ate;
  const length = Math.hypot(x1 - x0, z1 - z0);
  const dirX = (x1 - x0) / length;
  const dirZ = (z1 - z0) / length;
  // Normal do lado "A" (eixo +Z local) em coordenadas de mundo.
  const nX = -dirZ;
  const nZ = dirX;

  const group = new THREE.Group();
  group.name = `parede:${wall.id}`;
  group.position.set(x0, 0, z0);
  // rotation.y = θ leva o X local para (cos θ, 0, -sin θ). Queremos (dirX, 0, dirZ).
  group.rotation.y = Math.atan2(-dirZ, dirX);

  const openings = [...(wall.aberturas ?? [])].sort((a, b) => a.offset - b.offset);
  for (const op of openings) {
    if (op.offset < 0 || op.offset + op.largura > length) {
      console.warn(`Vão fora da parede ${wall.id}:`, op);
    }
  }

  // Esticamos meia espessura em cada ponta para fechar os cantos entre paredes.
  const start = -t / 2;
  const end = length + t / 2;
  const cuts = new Set<number>([start, end]);
  for (const op of openings) {
    cuts.add(op.offset);
    cuts.add(op.offset + op.largura);
  }
  // Cantos de cômodos que encostam nesta parede, projetados no eixo dela.
  for (const room of house.comodos) {
    const corners: [number, number][] = [
      [room.x, room.z],
      [room.x + room.largura, room.z],
      [room.x, room.z + room.profundidade],
      [room.x + room.largura, room.z + room.profundidade],
    ];
    for (const [cx, cz] of corners) {
      const along = (cx - x0) * dirX + (cz - z0) * dirZ;
      const across = (cx - x0) * nX + (cz - z0) * nZ;
      if (Math.abs(across) < t && along > start && along < end) cuts.add(along);
    }
  }
  const positions = [...cuts].sort((a, b) => a - b);

  const trim = new THREE.Color(WALL_COLORS.trim);
  const top = new THREE.Color(WALL_COLORS.top);
  const frameColor = new THREE.Color(WALL_COLORS.windowFrame);

  const pieces: THREE.BufferGeometry[] = [];
  const paintRanges: PaintRange[] = [];
  let vertexOffset = 0;

  // Uma parede ao longo de X bloqueia movimento em Z, e vice-versa. Paredes
  // diagonais não empurram móveis, só bloqueiam (a planta atual não tem nenhuma).
  const blocks = Math.abs(dirZ) < 1e-6 ? 'z' : Math.abs(dirX) < 1e-6 ? 'x' : null;

  // Converte uma caixa no espaço da parede (s ao longo dela, y, e a na espessura)
  // para uma AABB de mundo, transformando os 4 cantos da base.
  const addCollider = (s0: number, s1: number, y0: number, y1: number, a: number, kind: WallCollider['kind']) => {
    const xs: number[] = [];
    const zs: number[] = [];
    for (const s of [s0, s1]) {
      for (const across of [-a, a]) {
        xs.push(x0 + dirX * s + nX * across);
        zs.push(z0 + dirZ * s + nZ * across);
      }
    }
    colliders.push({
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: y0,
      maxY: y1,
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      kind,
      blocks: kind === 'parede' ? blocks : null,
      wallId: wall.id,
    });
  };

  const addPiece = (a: number, b: number, y0: number, y1: number) => {
    const len = b - a;
    const h = y1 - y0;
    if (len < 1e-4 || h < 1e-4) return;
    const mid = (a + b) / 2;

    // Para descobrir o cômodo de cada lado, testamos um ponto logo à frente de cada face.
    const s = THREE.MathUtils.clamp(mid, 0.01, length - 0.01);
    const wx = x0 + dirX * s;
    const wz = z0 + dirZ * s;
    const probe = t / 2 + 0.05;
    const roomA = findRoomAt(house.comodos, wx + nX * probe, wz + nZ * probe);
    const roomB = findRoomAt(house.comodos, wx - nX * probe, wz - nZ * probe);
    const colorA = new THREE.Color(roomA?.corParede ?? house.corExterna);
    const colorB = new THREE.Color(roomB?.corParede ?? house.corExterna);

    addCollider(a, b, y0, y1, t / 2, 'parede');

    const geometry = new THREE.BoxGeometry(len, h, t);
    paintBox(geometry, [trim, trim, top, trim, colorA, colorB]);
    // Move os vértices para a posição final no espaço da parede antes de fundir.
    geometry.translate(mid, y0 + h / 2, 0);
    pieces.push(geometry);

    // Faces +Z (lado A) e -Z (lado B): vértices 16–19 e 20–23 desta caixa.
    paintRanges.push({ roomId: roomA?.id ?? null, start: vertexOffset + 16, count: 4 });
    paintRanges.push({ roomId: roomB?.id ?? null, start: vertexOffset + 20, count: 4 });
    vertexOffset += geometry.attributes.position.count;
  };

  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    const mid = (a + b) / 2;
    const op = openings.find((o) => mid > o.offset && mid < o.offset + o.largura);
    if (!op) {
      addPiece(a, b, 0, H);
    } else {
      const bottom = op.tipo === 'janela' ? (op.peitoril ?? 0.9) : 0;
      const topY = Math.min(bottom + op.altura, H);
      addPiece(a, b, 0, bottom); // peitoril (só janelas)
      addPiece(a, b, topY, H); // verga acima do vão
    }
  }

  // Portas: o vão e uma folga dos dois lados ficam reservados para a passagem.
  for (const op of openings) {
    if (op.tipo !== 'porta') continue;
    const reach = t / 2 + DOOR_CLEARANCE;
    addCollider(op.offset, op.offset + op.largura, 0, op.altura, reach, 'porta');
  }

  const masonry = new THREE.Mesh(mergeGeometries(pieces), materials.walls);
  pieces.forEach((g) => g.dispose());
  masonry.name = 'alvenaria';
  masonry.castShadow = true;
  masonry.receiveShadow = true;
  masonry.userData = { wallId: wall.id, paintRanges };
  group.add(masonry);

  // Janelas: caixilhos (com o mesmo material de cor por vértice) e vidros, cada um numa malha.
  const frameBars: THREE.BufferGeometry[] = [];
  const glassPanes: THREE.BufferGeometry[] = [];
  for (const op of openings) {
    if (op.tipo !== 'janela') continue;
    for (const g of buildWindowFrame(op)) {
      paintBox(g, Array(6).fill(frameColor));
      frameBars.push(g);
    }
    glassPanes.push(buildWindowGlass(op));
  }

  let frames: THREE.Mesh | null = null;
  let glass: THREE.Mesh | null = null;
  if (frameBars.length > 0) {
    frames = new THREE.Mesh(mergeGeometries(frameBars), materials.walls);
    frameBars.forEach((g) => g.dispose());
    frames.name = 'caixilhos';
    frames.castShadow = true;
    group.add(frames);

    glass = new THREE.Mesh(mergeGeometries(glassPanes), materials.glass);
    glassPanes.forEach((g) => g.dispose());
    glass.name = 'vidros';
    // O vidro não projeta sombra: o sol entra pela janela.
    glass.castShadow = false;
    group.add(glass);
  }

  return { wall, group, masonry, frames, glass, doors: [] };
}

const FRAME = 0.06;
const FRAME_DEPTH = 0.08;

/** Caixilho de janela: 4 barras (+ divisória no meio se for larga), já posicionadas no espaço da parede. */
function buildWindowFrame(op: Opening): THREE.BufferGeometry[] {
  const w = op.largura;
  const h = op.altura;
  const cx = op.offset + w / 2;
  const y0 = op.peitoril ?? 0.9;
  const bar = (bw: number, bh: number, x: number, y: number) =>
    new THREE.BoxGeometry(bw, bh, FRAME_DEPTH).translate(cx + x, y0 + y, 0);

  const bars = [
    bar(w, FRAME, 0, FRAME / 2),
    bar(w, FRAME, 0, h - FRAME / 2),
    bar(FRAME, h - 2 * FRAME, -w / 2 + FRAME / 2, h / 2),
    bar(FRAME, h - 2 * FRAME, w / 2 - FRAME / 2, h / 2),
  ];
  if (w > 1) bars.push(bar(FRAME * 0.7, h - 2 * FRAME, 0, h / 2));
  return bars;
}

function buildWindowGlass(op: Opening): THREE.BufferGeometry {
  const w = op.largura;
  const h = op.altura;
  return new THREE.PlaneGeometry(w - 2 * FRAME, h - 2 * FRAME).translate(op.offset + w / 2, (op.peitoril ?? 0.9) + h / 2, 0);
}

/** Porta: modelo da Kenney esticado para caber exatamente no vão. */
async function addDoor(wallGroup: THREE.Group, op: Opening, wallThickness: number): Promise<THREE.Object3D | null> {
  const path = op.modelo ?? DEFAULT_DOOR_MODEL;
  try {
    const template = await loadTemplate(path);
    const size = templateSize(template);
    const door = instantiate(template);
    door.scale.set(op.largura / size.x, op.altura / size.y, (wallThickness + 0.02) / size.z);
    door.position.set(op.offset + op.largura / 2, 0, 0);
    door.traverse((obj) => (obj.userData.sharedGeometry = true));
    wallGroup.add(door);
    return door;
  } catch (err) {
    console.warn(`Não foi possível carregar a porta ${path}`, err);
    return null;
  }
}
