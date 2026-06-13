(function initHhJobAssistantDom(global) {
  const { cleanText } = global.HHJobAssistantText || {};

  function textOf(node) {
    return cleanText(node?.innerText || node?.textContent || '');
  }

  function isVisible(node) {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const node = [...root.querySelectorAll(selector)].find(isVisible);
      if (node) return node;
    }
    return null;
  }

  function queryAll(selectors, root = document) {
    return selectors.flatMap((selector) => [...root.querySelectorAll(selector)]).filter(isVisible);
  }

  function findClickableByText(root, patterns) {
    const nodes = [...root.querySelectorAll('button,a,[role="button"]')].filter(isVisible);
    return nodes.find((node) => patterns.some((pattern) => pattern.test(textOf(node))));
  }

  function isDisabled(node) {
    return Boolean(
      node?.disabled ||
        node?.getAttribute?.('disabled') !== null ||
        node?.getAttribute?.('aria-disabled') === 'true' ||
        /\bdisabled\b/i.test(node?.getAttribute?.('class') || '')
    );
  }

  function findEnabledClickableByText(root, patterns) {
    const nodes = [...root.querySelectorAll('button,a,[role="button"]')].filter((node) => isVisible(node) && !isDisabled(node));
    return nodes.find((node) => patterns.some((pattern) => pattern.test(textOf(node))));
  }

  function setNativeValue(element, value) {
    if (element.getAttribute?.('contenteditable') === 'true' || element.isContentEditable) {
      element.textContent = value;
      element.innerText = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  global.HHJobAssistantDom = {
    textOf,
    isVisible,
    queryFirst,
    queryAll,
    findClickableByText,
    isDisabled,
    findEnabledClickableByText,
    setNativeValue
  };
})(globalThis);
