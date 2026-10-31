/** Onde o item pode ser apoiado. */
export type Mounting = 'piso' | 'parede' | 'bancada';

/** Parâmetros de um quadro gerado em código (ver procedural.ts). */
export interface PaintingParams {
  arte: 'circulos' | 'listras' | 'paisagem' | 'blocos';
  moldura: string;
  largura: number; // metros
  altura: number; // metros
  cores: string[];
}

export interface CatalogVariant {
  id: string;
  nome: string;
  /** Troca o modelo. Se ausente, usa o arquivo do item. */
  arquivo?: string;
  /** Variante gerada: troca a cor de materiais do GLB, por nome de material. */
  materiais?: Record<string, string>;
  gerada?: boolean;
  /** Só para itens procedurais. */
  parametros?: PaintingParams;
}

export interface CatalogItem {
  id: string;
  nome: string;
  categoria: string;
  /** GLB relativo a public/assets/. Itens procedurais não têm arquivo. */
  arquivo?: string;
  procedural?: 'quadro';
  /** Escala do modelo. Se ausente, usa escalaPadrao (os modelos da Kenney usam ~0,5 m por unidade). */
  escala?: number;
  /** Rotação em graus aplicada ao modelo para que a frente aponte para +Z. */
  rotacaoBase?: number;
  /** [largura, profundidade] em metros. Se ausente, vem da bounding box do modelo. */
  footprint?: [number, number];
  montagem: Mounting;
  /** Itens de parede: altura da base do item em relação ao piso, em metros. */
  alturaParede?: number;
  /** Itens que aceitam itens de bancada em cima. altura = tampo em metros (padrão: topo do modelo). */
  superficie?: { altura?: number };
  /** false = não colide (tapetes). Padrão: true. */
  colisao?: boolean;
  variantes: CatalogVariant[];
  licenca: string;
  fonte: string;
}

export interface CatalogCategory {
  id: string;
  nome: string;
}

export interface CatalogData {
  version: number;
  escalaPadrao: number;
  categorias: CatalogCategory[];
  itens: CatalogItem[];
}
