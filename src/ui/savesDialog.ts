import type { SaveManager } from '../state/saveManager';
import type { SaveSummary } from '../state/persistence';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Escapa texto do usuário antes de pôr em innerHTML. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Diálogo "Minhas casas": lista de saves com abrir, renomear e excluir, e as ações
 * de nova casa, salvar como, exportar e importar. Usa o <dialog> nativo do HTML,
 * que já cuida de foco, Esc para fechar e fundo escurecido.
 */
export function createSavesDialog(root: HTMLElement, saves: SaveManager): { open(): void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'saves-dialog';
  dialog.innerHTML = `
    <div class="saves-header">
      <h2>Minhas casas</h2>
      <button class="icon-button" data-action="close" aria-label="Fechar">✕</button>
    </div>
    <div class="saves-actions">
      <button data-action="new">Nova casa</button>
      <button data-action="save-as">Salvar como…</button>
      <button data-action="export">Exportar JSON</button>
      <button data-action="import">Importar JSON</button>
      <input type="file" accept=".json,application/json" hidden />
    </div>
    <form class="saves-name-form" hidden>
      <label><span></span><input name="nome" maxlength="60" required /></label>
      <button type="submit" class="primary">OK</button>
      <button type="button" data-action="cancel-form">Cancelar</button>
    </form>
    <ul class="saves-list"></ul>`;
  root.append(dialog);

  const list = dialog.querySelector<HTMLUListElement>('.saves-list')!;
  const form = dialog.querySelector<HTMLFormElement>('.saves-name-form')!;
  const formLabel = form.querySelector<HTMLSpanElement>('span')!;
  const formInput = form.querySelector<HTMLInputElement>('input')!;
  const fileInput = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  // O que o formulário de nome vai fazer ao confirmar.
  let onSubmitName: ((nome: string) => Promise<void>) | null = null;
  let confirmingDelete: string | null = null;

  const askName = (label: string, initial: string, action: (nome: string) => Promise<void>) => {
    formLabel.textContent = label;
    formInput.value = initial;
    form.hidden = false;
    onSubmitName = action;
    formInput.focus();
    formInput.select();
  };

  const render = async () => {
    const current = saves.currentSave;
    let items: SaveSummary[] = [];
    try {
      items = await saves.list();
    } catch {
      list.innerHTML = '<li class="empty">Armazenamento indisponível neste navegador.</li>';
      return;
    }
    list.innerHTML = items
      .map((s) => {
        const isCurrent = s.id === current.id;
        const deleting = confirmingDelete === s.id;
        return `
        <li class="${isCurrent ? 'current' : ''}" data-id="${esc(s.id)}">
          <div class="save-info">
            <div class="save-name"><strong>${esc(s.nome)}</strong>${isCurrent ? '<span class="tag">aberta</span>' : ''}</div>
            <small>${s.quantidade} itens · ${dateFormat.format(new Date(s.atualizadoEm))}</small>
          </div>
          <div class="save-buttons">
            ${isCurrent ? '' : '<button data-action="open">Abrir</button>'}
            <button data-action="rename">Renomear</button>
            <button data-action="delete" class="${deleting ? 'danger-solid' : 'danger'}">${deleting ? 'Confirmar' : 'Excluir'}</button>
          </div>
        </li>`;
      })
      .join('');
  };

  dialog.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.closest<HTMLElement>('li')?.dataset.id;
    if (action !== 'delete') confirmingDelete = null;

    if (action === 'close') dialog.close();
    if (action === 'new') askName('Nome da nova casa', 'Nova casa', (nome) => saves.startNew(nome));
    if (action === 'save-as') askName('Salvar uma cópia como', `${saves.currentSave.nome} (cópia)`, (nome) => saves.saveAs(nome));
    if (action === 'export') saves.exportCurrent();
    if (action === 'import') fileInput.click();
    if (action === 'cancel-form') form.hidden = true;
    if (action === 'open' && id) {
      await saves.open(id);
      dialog.close();
    }
    if (action === 'rename' && id) {
      const nome = button.closest('li')?.querySelector('strong')?.textContent ?? '';
      askName('Novo nome', nome, (novo) => saves.rename(id, novo));
    }
    if (action === 'delete' && id) {
      // Excluir pede uma segunda confirmação no próprio botão.
      if (confirmingDelete === id) {
        confirmingDelete = null;
        await saves.remove(id);
      } else {
        confirmingDelete = id;
      }
    }
    await render();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nome = formInput.value.trim();
    if (!nome || !onSubmitName) return;
    form.hidden = true;
    await onSubmitName(nome);
    onSubmitName = null;
    await render();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // permite importar o mesmo arquivo de novo
    if (!file) return;
    await saves.importFile(file);
    dialog.close();
  });

  return {
    open() {
      form.hidden = true;
      confirmingDelete = null;
      void render();
      dialog.showModal();
    },
  };
}
