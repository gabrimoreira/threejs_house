/** Ponto da planta [x, z] em metros. */
export type Vec2 = [number, number];

/** Cômodo retangular, alinhado aos eixos. (x, z) é o canto de menor coordenada. */
export interface Room {
  id: string;
  nome: string;
  x: number;
  z: number;
  largura: number; // ao longo de X
  profundidade: number; // ao longo de Z
  piso: string; // chave em HouseData.pisos
  corParede: string; // cor CSS (#rrggbb) das faces de parede voltadas para este cômodo
}

export type OpeningType = 'porta' | 'janela' | 'vao';

/** Vão numa parede. offset é a distância do início da parede (ponto "de") até a borda do vão. */
export interface Opening {
  tipo: OpeningType;
  offset: number;
  largura: number;
  altura: number;
  peitoril?: number; // janelas: altura do chão até a base
  modelo?: string; // portas: GLB relativo a public/assets/ (ex.: models/casa/doorwayOpen.glb)
}

/** Parede reta do eixo "de" até "ate" (linha central). */
export interface Wall {
  id: string;
  de: Vec2;
  ate: Vec2;
  aberturas?: Opening[];
}

export type FloorPattern = 'tabuas' | 'azulejo' | 'carpete' | 'liso';

export interface FloorStyle {
  nome: string;
  padrao: FloorPattern;
  cor: string;
  tamanho?: number; // metros cobertos por uma repetição da textura
}

export interface HouseData {
  version: number;
  alturaParede: number;
  espessuraParede: number;
  corExterna: string;
  comodos: Room[];
  paredes: Wall[];
  pisos: Record<string, FloorStyle>;
}
