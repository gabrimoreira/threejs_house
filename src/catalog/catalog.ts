import catalogJson from './catalog.json';
import type { CatalogData, CatalogItem, CatalogVariant } from './types';

// O JSON importado tem tipos "largos" (string em vez das uniões); declaramos o formato.
export const catalog = catalogJson as unknown as CatalogData;

const itemsById = new Map(catalog.itens.map((item) => [item.id, item]));

export function getItem(id: string): CatalogItem | undefined {
  return itemsById.get(id);
}

/** Variante pelo id; se não existir (ex.: save antigo), cai na primeira. */
export function getVariant(item: CatalogItem, variantId: string): CatalogVariant {
  return item.variantes.find((v) => v.id === variantId) ?? item.variantes[0];
}

export function itemsInCategory(categoryId: string): CatalogItem[] {
  return catalog.itens.filter((item) => item.categoria === categoryId);
}

/** GLB usado pela variante (o da própria variante ou o do item). */
export function variantFile(item: CatalogItem, variant: CatalogVariant): string | undefined {
  return variant.arquivo ?? item.arquivo;
}

export function itemScale(item: CatalogItem): number {
  return item.escala ?? catalog.escalaPadrao;
}
