import type { HouseData, Opening, Room, Wall } from '../../house/types';

/** Trecho de um vão projetado na face: [min, max] ao longo da face e [bottom, top] em altura. */
export interface FaceOpening {
  min: number;
  max: number;
  bottom: number;
  top: number;
}

/**
 * Face interna de uma parede, vista de dentro de um cômodo: onde se penduram
 * TVs, quadros e armários aéreos.
 */
export interface WallFace {
  id: string;
  roomId: string;
  /** Eixo ao longo do qual a face corre. */
  axis: 'x' | 'z';
  /** Coordenada do plano da face no outro eixo. */
  fixed: number;
  /** Normal [x, z], apontando para dentro do cômodo. */
  normal: [number, number];
  /** Trecho utilizável ao longo do eixo (já descontando as paredes perpendiculares). */
  min: number;
  max: number;
  openings: FaceOpening[];
}

const EPS = 1e-6;

function openingHeight(op: Opening): [number, number] {
  const bottom = op.tipo === 'janela' ? (op.peitoril ?? 0.9) : 0;
  return [bottom, bottom + op.altura];
}

/**
 * Gera as faces a partir dos dados: para cada lado de cada cômodo, procura as paredes
 * que estão sobre aquela linha e recorta o trecho comum. Funciona para plantas com
 * cômodos retangulares e paredes alinhadas aos eixos (o formato do house.json).
 */
export function computeWallFaces(house: HouseData): WallFace[] {
  const t = house.espessuraParede;
  const faces: WallFace[] = [];

  const sides = (room: Room) =>
    [
      { side: 'sul', axis: 'x', line: room.z, from: room.x, to: room.x + room.largura, normal: [0, 1] },
      { side: 'norte', axis: 'x', line: room.z + room.profundidade, from: room.x, to: room.x + room.largura, normal: [0, -1] },
      { side: 'oeste', axis: 'z', line: room.x, from: room.z, to: room.z + room.profundidade, normal: [1, 0] },
      { side: 'leste', axis: 'z', line: room.x + room.largura, from: room.z, to: room.z + room.profundidade, normal: [-1, 0] },
    ] as const;

  for (const room of house.comodos) {
    for (const s of sides(room)) {
      // Índices em [x, z]: ao longo da face e perpendicular a ela.
      const along = s.axis === 'x' ? 0 : 1;
      const across = 1 - along;
      for (const wall of house.paredes) {
        if (!onLine(wall, across, s.line)) continue;
        const wMin = Math.min(wall.de[along], wall.ate[along]);
        const wMax = Math.max(wall.de[along], wall.ate[along]);
        const min = Math.max(s.from, wMin) + t / 2;
        const max = Math.min(s.to, wMax) - t / 2;
        if (max - min <= EPS) continue;

        const dir = Math.sign(wall.ate[along] - wall.de[along]);
        const openings = (wall.aberturas ?? []).map((op): FaceOpening => {
          const a = wall.de[along] + dir * op.offset;
          const b = wall.de[along] + dir * (op.offset + op.largura);
          const [bottom, top] = openingHeight(op);
          return { min: Math.min(a, b), max: Math.max(a, b), bottom, top };
        });

        const normalAcross = s.normal[across];
        faces.push({
          id: `${room.id}:${s.side}:${wall.id}`,
          roomId: room.id,
          axis: s.axis,
          fixed: s.line + normalAcross * (t / 2),
          normal: [s.normal[0], s.normal[1]],
          min,
          max,
          openings,
        });
      }
    }
  }
  return faces;
}

/** A parede inteira está sobre a linha coordenada[axisIndex] = value? */
function onLine(wall: Wall, axisIndex: number, value: number): boolean {
  return Math.abs(wall.de[axisIndex] - value) < EPS && Math.abs(wall.ate[axisIndex] - value) < EPS;
}
