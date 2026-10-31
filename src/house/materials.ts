import * as THREE from 'three';
import type { FloorStyle } from './types';

/** Gerador pseudoaleatório com semente: o piso sai igual a cada carregamento. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cor CSS com o brilho deslocado (dl entre -1 e 1). */
function shade(hex: string, dl: number): string {
  return '#' + new THREE.Color(hex).offsetHSL(0, 0, dl).getHexString();
}

/**
 * Tábuas de madeira: 10 fileiras por repetição, duas tábuas por fileira com emendas
 * em posições aleatórias. Desenhamos "dando a volta" na borda para a textura emendar
 * sem costura quando repetida (RepeatWrapping).
 */
function drawPlanks(ctx: CanvasRenderingContext2D, size: number, base: string, rand: () => number) {
  const rows = 10;
  const rowH = size / rows;
  const plankLen = size / 2;
  const joint = shade(base, -0.18);
  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    const start = Math.floor(rand() * size);
    for (let k = 0; k < 2; k++) {
      const x0 = (start + k * plankLen) % size;
      ctx.fillStyle = shade(base, (rand() - 0.5) * 0.08);
      ctx.fillRect(x0, y, plankLen, rowH);
      if (x0 + plankLen > size) ctx.fillRect(x0 - size, y, plankLen, rowH);
      // veios: linhas finas e translúcidas ao longo da tábua
      ctx.strokeStyle = 'rgba(60, 35, 15, 0.08)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 3; g++) {
        const gy = y + 4 + rand() * (rowH - 8);
        ctx.beginPath();
        ctx.moveTo(x0, gy);
        ctx.lineTo(x0 + plankLen, gy + (rand() - 0.5) * 3);
        ctx.stroke();
      }
      // emenda entre tábuas
      ctx.fillStyle = joint;
      ctx.fillRect(x0, y, 2, rowH);
    }
    // linha entre fileiras
    ctx.fillStyle = joint;
    ctx.fillRect(0, y, size, 2);
  }
}

/** Azulejos: 4×4 peças com leve variação de tom e rejunte na borda superior/esquerda. */
function drawTiles(ctx: CanvasRenderingContext2D, size: number, base: string, rand: () => number) {
  const n = 4;
  const tile = size / n;
  const grout = shade(base, -0.14);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = shade(base, (rand() - 0.5) * 0.04);
      ctx.fillRect(i * tile, j * tile, tile, tile);
    }
  }
  ctx.fillStyle = grout;
  for (let i = 0; i < n; i++) {
    ctx.fillRect(i * tile, 0, 3, size);
    ctx.fillRect(0, i * tile, size, 3);
  }
}

/** Carpete: pontinhos claros e escuros espalhados sobre a cor base. */
function drawCarpet(ctx: CanvasRenderingContext2D, size: number, base: string, rand: () => number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const light = shade(base, 0.06);
  const dark = shade(base, -0.06);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() < 0.5 ? light : dark;
    ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 2, 2);
  }
}

/** Cores fixas das partes da parede que não são pintadas pelo jogador. */
export const WALL_COLORS = {
  trim: '#f7f5f0', // laterais dos vãos e base
  top: '#857e75', // topo da parede (aparece no corte visto de cima)
  windowFrame: '#fbfbfb',
};

/**
 * Materiais da casa, criados sob demanda e reaproveitados.
 * Compartilhar o mesmo material entre vários meshes economiza memória e
 * troca de estado na GPU; por isso usamos caches por chave.
 */
export class HouseMaterials {
  // Todas as paredes usam UM material com cores por vértice (vertexColors):
  // a cor de cada face fica gravada na geometria, então uma parede inteira,
  // com várias cores, vira um único draw call.
  readonly walls = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  // Versão translúcida, usada no modo "paredes transparentes".
  readonly wallsFaded = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  // Vidro barato: transparência simples. depthWrite=false evita que o vidro "apague"
  // o que está atrás dele no depth buffer.
  readonly glass = new THREE.MeshStandardMaterial({
    color: '#bcd8e6',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // O gramado fica um pouco abaixo dos pisos. O polygonOffset empurra sua profundidade
  // para trás, evitando "z-fighting" (piscar) onde os dois planos se sobrepõem.
  readonly ground = new THREE.MeshStandardMaterial({
    color: '#93ad7d',
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });

  private readonly floorCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly maxAnisotropy: number;

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
  }

  /**
   * Material de piso. A textura é desenhada num <canvas> e enviada à GPU como CanvasTexture.
   * As UVs do piso estão em metros, então texture.repeat = 1 / tamanho faz cada
   * repetição cobrir "tamanho" metros, seja qual for o tamanho do cômodo.
   */
  floor(id: string, style: FloorStyle): THREE.MeshStandardMaterial {
    let mat = this.floorCache.get(id);
    if (mat) return mat;

    if (style.padrao === 'liso') {
      mat = new THREE.MeshStandardMaterial({ color: style.cor, roughness: 0.8 });
    } else {
      const size = style.padrao === 'carpete' ? 256 : 512;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const rand = mulberry32(id.length * 7919 + style.cor.charCodeAt(1));
      if (style.padrao === 'tabuas') drawPlanks(ctx, size, style.cor, rand);
      else if (style.padrao === 'azulejo') drawTiles(ctx, size, style.cor, rand);
      else drawCarpet(ctx, size, style.cor, rand);

      const texture = new THREE.CanvasTexture(canvas);
      // A textura tem cores sRGB (como qualquer imagem); o three converte para linear.
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      // O canvas de azulejo tem 4×4 peças, então cobre 4× o tamanho de uma peça.
      const meters = (style.tamanho ?? 1) * (style.padrao === 'azulejo' ? 4 : 1);
      texture.repeat.set(1 / meters, 1 / meters);
      // Filtro anisotrópico: deixa o piso nítido quando visto de lado.
      texture.anisotropy = Math.min(8, this.maxAnisotropy);

      const roughness = style.padrao === 'azulejo' ? 0.45 : style.padrao === 'tabuas' ? 0.7 : 1;
      mat = new THREE.MeshStandardMaterial({ map: texture, roughness });
    }
    this.floorCache.set(id, mat);
    return mat;
  }

  /** Libera da GPU todos os materiais e texturas criados aqui. */
  dispose(): void {
    const all = [this.walls, this.wallsFaded, this.glass, this.ground, ...this.floorCache.values()];
    for (const mat of all) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.floorCache.clear();
  }
}
