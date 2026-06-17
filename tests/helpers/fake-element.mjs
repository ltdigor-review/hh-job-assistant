export class FakeElement {
  constructor({ text = '', href = '', selectorMap = {}, click = null, dispatch = null, attrs = {}, disabled = false, type = '', value = '' } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.href = href;
    this.disabled = disabled;
    this.type = type || attrs.type || '';
    this.selectorMap = selectorMap;
    this.clickHandler = click;
    this.dispatchHandler = dispatch;
    this.value = value;
    this.checked = false;
    this.children = [];
    this.style = {};
    this.attrs = attrs;
    this.dataset = {};
    this.parentElement = null;
  }

  querySelectorAll(selector) {
    if (selector.includes(',')) {
      return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
    }
    return this.selectorMap[selector] || [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 24 };
  }

  getAttribute(name) {
    if (name === 'aria-disabled') return null;
    if (name === 'type') return this.type || this.attrs[name] || null;
    return this.attrs[name] ?? null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  dispatchEvent(event) {
    this.dispatchHandler?.(event);
  }

  scrollIntoView() {}

  append(...children) {
    this.children.push(...children);
  }

  remove() {}

  addEventListener() {}

  focus() {}

  closest() {
    return this.parentElement;
  }

  click() {
    this.clickHandler?.();
  }
}
