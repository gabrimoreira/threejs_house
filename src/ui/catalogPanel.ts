import { catalog, itemsInCategory } from '../catalog/catalog';
import type { CatalogItem, CatalogVariant } from '../catalog/types';
import type { ThumbnailService } from '../catalog/thumbnails';
import { loadPref, savePref } from '../state/prefs';

interface CatalogPanelOptions {
  root: HTMLElement;
  thumbnails: ThumbnailService;
  onPick(item: CatalogItem, variant: CatalogVariant): void;
}

/** Tela estreita (celular em pé): o catálogo vira uma gaveta embaixo. */
export const isNarrowScreen = () => window.matchMedia('(max-width: 700px)').matches;

/** Cria um elemento com classe e texto, para o código de DOM ficar curto. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Painel do catálogo: abas por categoria, e para cada item uma fileira com as
 * miniaturas das variantes. Clicar numa miniatura inicia o posicionamento.
 */
export interface CatalogPanel {
  element: HTMLElement;
  setCollapsed(collapsed: boolean): void;
}

export function createCatalogPanel({ root, thumbnails, onPick }: CatalogPanelOptions): CatalogPanel {
  const panel = el('aside', 'catalog');
  const header = el('div', 'catalog-header');
  const title = el('strong', undefined, 'Catálogo');
  const toggle = el('button', 'icon-button', '▾');
  toggle.setAttribute('aria-label', 'Recolher catálogo');
  header.append(title, toggle);

  const tabs = el('nav', 'catalog-tabs');
  tabs.setAttribute('role', 'tablist');
  const list = el('div', 'catalog-list');
  panel.append(header, tabs, list);
  root.append(panel);

  const setCollapsed = (collapsed: boolean) => {
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '▴' : '▾';
    toggle.setAttribute('aria-label', collapsed ? 'Abrir catálogo' : 'Recolher catálogo');
    savePref('catalogCollapsed', collapsed);
  };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
  setCollapsed(loadPref('catalogCollapsed', false));

  const showCategory = (categoryId: string) => {
    savePref('catalogTab', categoryId);
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const active = button.dataset.category === categoryId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
    list.replaceChildren(...itemsInCategory(categoryId).map(renderItem));
    list.scrollTop = 0;
  };

  const renderItem = (item: CatalogItem) => {
    const section = el('section', 'catalog-item');
    section.append(el('h3', undefined, item.nome));
    const variants = el('div', 'variants');
    for (const variant of item.variantes) {
      const button = el('button', 'variant');
      button.title = variant.gerada ? `${variant.nome} (variante de cor gerada)` : variant.nome;
      const img = el('img');
      img.alt = '';
      img.width = img.height = 64;
      const label = el('span', 'variant-name', variant.nome);
      button.append(img, label);
      if (variant.gerada) button.append(el('span', 'badge', 'cor'));
      button.addEventListener('click', () => {
        onPick(item, variant);
        // No celular, recolhe o painel para liberar a tela durante o posicionamento.
        if (isNarrowScreen()) setCollapsed(true);
      });
      variants.append(button);
      thumbnails
        .get(item, variant)
        .then((url) => (img.src = url))
        .catch((err) => {
          console.warn(`Miniatura falhou: ${item.id}:${variant.id}`, err);
          button.classList.add('broken');
        });
    }
    section.append(variants);
    return section;
  };

  for (const category of catalog.categorias) {
    const button = el('button', 'tab', category.nome);
    button.dataset.category = category.id;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => showCategory(category.id));
    tabs.append(button);
  }

  const saved = loadPref('catalogTab', catalog.categorias[0].id);
  showCategory(catalog.categorias.some((c) => c.id === saved) ? saved : catalog.categorias[0].id);
  return { element: panel, setCollapsed };
}
