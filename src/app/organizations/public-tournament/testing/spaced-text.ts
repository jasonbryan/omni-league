const SHOW_TEXT = 4;

// `textContent` runs one element's text into the next, and stripping tags from `innerHTML` breaks on a `>` inside an attribute.
export function spacedText(element: Element | null | undefined): string {
  if (!element) return '';
  const walker = element.ownerDocument.createTreeWalker(element, SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.nodeValue ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
