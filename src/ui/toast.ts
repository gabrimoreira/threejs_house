/**
 * Mensagens curtas na tela. show() some sozinha; hint() fica até ser trocada ou limpa
 * (usada para instruções de um modo, como a rotação livre).
 */
export class Toast {
  private readonly el: HTMLDivElement;
  private timer = 0;
  private sticky: string | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toast';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    root.append(this.el);
  }

  show(message: string, ms = 2600): void {
    window.clearTimeout(this.timer);
    this.render(message);
    this.timer = window.setTimeout(() => this.render(this.sticky), ms);
  }

  hint(message: string | null): void {
    this.sticky = message;
    window.clearTimeout(this.timer);
    this.render(message);
  }

  private render(message: string | null): void {
    this.el.hidden = message === null;
    this.el.textContent = message ?? '';
  }
}
