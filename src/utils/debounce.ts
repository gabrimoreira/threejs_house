/**
 * Adia a chamada até `ms` sem novas chamadas. Útil para o autosave: várias
 * alterações seguidas viram uma única gravação.
 */
export function debounce(fn: () => void, ms: number): { (): void; flush(): void; cancel(): void } {
  let timer = 0;
  const run = () => {
    window.clearTimeout(timer);
    timer = 0;
    fn();
  };
  const debounced = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, ms);
  };
  debounced.flush = () => {
    if (timer) run();
  };
  debounced.cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  return debounced;
}
