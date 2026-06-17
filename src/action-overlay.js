(function initHHJobAssistantActionOverlay(globalScope) {
  if (globalScope.HHJobAssistantActionOverlay) return;

  class HHJobAssistantActionOverlay {
    constructor({
      panelId = 'hh-job-assistant-action-panel',
      cursorId = 'hh-job-assistant-action-cursor',
      highlightAttr = 'data-hh-job-assistant-highlight',
      title = 'HH Job Assistant',
      defaultText = 'Работаю',
      panelEnabled = true
    } = {}) {
      this.panelId = panelId;
      this.cursorId = cursorId;
      this.highlightAttr = highlightAttr;
      this.title = title;
      this.defaultText = defaultText;
      this.panelEnabled = panelEnabled;
    }

    setStatus(text, state = 'running') {
      if (!this.panelEnabled || !document?.body) return;
      let panel = document.getElementById(this.panelId);
      if (!panel) {
        panel = document.createElement('aside');
        panel.id = this.panelId;
        panel.style.cssText = [
          'position:fixed',
          'right:16px',
          'top:16px',
          'z-index:2147483647',
          'width:min(360px,calc(100vw - 32px))',
          'background:#fff',
          'border:1px solid #b6c2d1',
          'box-shadow:0 16px 48px rgba(0,0,0,.22)',
          'border-radius:8px',
          'font:14px/1.45 Arial,sans-serif',
          'color:#1f2937',
          'padding:12px'
        ].join(';');

        const title = document.createElement('strong');
        title.textContent = this.title;
        title.style.cssText = 'display:block;margin-bottom:6px';

        const body = document.createElement('div');
        body.id = `${this.panelId}-body`;
        body.style.cssText = 'white-space:pre-wrap';

        panel.append(title, body);
        document.body.append(panel);
      }

      const body = document.getElementById(`${this.panelId}-body`);
      if (body) {
        body.textContent = text || this.defaultText;
        body.style.color = state === 'error' ? '#b91c1c' : '#1f2937';
      }
      panel.style.borderColor = state === 'error' ? '#f2a1a1' : state === 'complete' ? '#86efac' : '#b6c2d1';
    }

    clearHighlights() {
      if (!document?.querySelectorAll) return;
      for (const node of [...document.querySelectorAll(`[${this.highlightAttr}]`)]) {
        node.style.outline = '';
        node.style.boxShadow = '';
        node.removeAttribute?.(this.highlightAttr);
      }
    }

    showCursorFor(node) {
      if (!node || !document?.body) return;
      let cursor = document.getElementById(this.cursorId);
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = this.cursorId;
        cursor.style.cssText = [
          'position:fixed',
          'z-index:2147483647',
          'width:14px',
          'height:14px',
          'border:2px solid #2563eb',
          'border-radius:999px',
          'background:#fff',
          'box-shadow:0 4px 14px rgba(37,99,235,.35)',
          'pointer-events:none',
          'transition:left .15s ease,top .15s ease'
        ].join(';');
        document.body.append(cursor);
      }

      const rect = node.getBoundingClientRect();
      cursor.style.left = `${Math.max(8, rect.left + Math.min(rect.width - 8, 16))}px`;
      cursor.style.top = `${Math.max(8, rect.top + Math.min(rect.height - 8, 12))}px`;
    }

    highlight(node) {
      if (!node) return;
      this.clearHighlights();
      node.setAttribute?.(this.highlightAttr, 'true');
      node.style.outline = '3px solid #2563eb';
      node.style.boxShadow = '0 0 0 6px rgba(37,99,235,.18)';
      node.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      this.showCursorFor(node);
    }
  }

  globalScope.HHJobAssistantActionOverlay = HHJobAssistantActionOverlay;
})(globalThis);
