/**
 * Preferências pequenas da interface (aba aberta, painel recolhido...) no localStorage.
 * O acesso pode falhar (modo privado, cookies bloqueados): nesse caso usamos o padrão.
 */
const PREFIX = 'casa-sandbox:';

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // sem armazenamento: a preferência vale só nesta visita
  }
}
