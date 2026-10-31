/**
 * AABB (axis-aligned bounding box): caixa alinhada aos eixos X, Y e Z.
 * Testar se duas AABBs se cruzam é só comparar intervalos em cada eixo, por isso
 * é a forma mais simples (e barata) de detectar colisão.
 */
export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Folga em metros: caixas que só se encostam (micro-ondas sobre o balcão) não colidem. */
export const EPS = 0.002;

export function overlaps(a: Box, b: Box, eps = EPS): boolean {
  return (
    a.minX < b.maxX - eps &&
    a.maxX > b.minX + eps &&
    a.minY < b.maxY - eps &&
    a.maxY > b.minY + eps &&
    a.minZ < b.maxZ - eps &&
    a.maxZ > b.minZ + eps
  );
}

/** Caixa de um item: centro da base em (x, y, z), largura/profundidade já giradas e altura. */
export function boxAt(x: number, y: number, z: number, width: number, depth: number, height: number): Box {
  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minY: y,
    maxY: y + height,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}
