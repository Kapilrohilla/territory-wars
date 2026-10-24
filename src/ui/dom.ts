/** Small DOM helpers and the line-icon set shared by the UI screens. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

export function button(cls: string, text?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** 24×24 line icons (stroke = currentColor); names ending in "-fill" are solid shapes. */
export const ICONS = {
  'play-fill': 'M8 5.5v13l10.5-6.5z',
  'star': 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.75 1-5.8L3.5 9.7l5.9-.9z',
  'flame': 'M12 3c.6 3.4 5 5.6 5 10.5a5 5 0 0 1-10 0c0-2.4 1.4-4 2.5-5 .2 1.7 1 2.8 2 3.1.4-3-.5-5.6.5-8.6z',
  'swords': 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2',
  'timer': 'M10 2h4M12 14l3-3M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  'heart-fill': 'M12 20.5l-1.3-1.2C6 15 3 12.3 3 8.9 3 6.2 5.1 4 7.8 4c1.6 0 3.1.8 4.2 2 1.1-1.2 2.6-2 4.2-2C18.9 4 21 6.2 21 8.9c0 3.4-3 6.1-7.7 10.4z',
  'crown-fill': 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  'trophy': 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  'shield': 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  'video': 'M3.5 5.5h17v13h-17zM10 9v6l5-3z',
  'back': 'M19 12H5M11 6l-6 6 6 6',
  'chart': 'M4 20h16M6 20v-8h4v8M10 20V5h4v15M14 20v-6h4v6',
  'close': 'M6 6l12 12M18 6L6 18',
  'x-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9l6 6M15 9l-6 6',
  'sound': 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  'sound-off': 'M4 9v6h4l5 4V5L8 9zM17 9.5l5 5M22 9.5l-5 5',
  'vibrate': 'M8.5 4h7v16h-7zM5 8v8M19 8v8M2 10v4M22 10v4',
  'motion-off': 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM6.3 6.3l11.4 11.4',
  'gear': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  'play-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM10 8.5v7l5.5-3.5z',
  'palette': 'M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.6 1.7-1.6H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01M17 11h.01',
  'pause': 'M8.5 5v14M15.5 5v14',
  'restart': 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  'map': 'M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14',
  'lock': 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  'chevron': 'M9 6l6 6-6 6',
  'check': 'M5 12.5l4.5 4.5L19 7',
  'dice': 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  'home': 'M3.5 10.5L12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z',
  'trend': 'M3 17l6-6 4 4 8-8M15 7h6v6',
  'id': 'M3.5 6h17v13h-17zM9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.8 17c.8-1.7 5.6-1.7 6.4 0M14.5 10h3.5M14.5 14h3.5',
  'headphones': 'M4 17v-4a8 8 0 0 1 16 0v4M4 14.5h3.5v6H4zM16.5 14.5H20v6h-3.5z',
  'warning': 'M12 3.5L21.5 20h-19zM12 10v4.5M12 17.5h.01',
  'shake': 'M8.5 4.5h7v15h-7zM4.5 8l-2 2 2 2-2 2M19.5 8l2 2-2 2 2 2',
} as const;
export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): SVGElement {
  const fill = name.endsWith('-fill');
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: `tw-icon ${cls}`.trim() });
  s.append(svg('path', fill
    ? { d: ICONS[name], fill: 'currentColor' }
    : { d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

/** A small uppercase label row: text on the left, optional aside on the right. */
export function labelRow(text: string, aside?: HTMLElement, forId?: string): HTMLElement {
  const row = el('div', 'tw-label-row');
  const l = el(forId ? 'label' : 'div', 'tw-label', text);
  if (forId) (l as HTMLLabelElement).htmlFor = forId;
  row.append(l);
  if (aside) row.append(aside);
  return row;
}

/** A stat tile (label over value) appended to `parent`; returns the label text and value elements. */
export function statTile(parent: HTMLElement, name: IconName | null, label: string): { label: HTMLElement; value: HTMLElement } {
  const box = el('div', 'tw-tile');
  const l = el('div', 'tw-tile-label');
  const text = el('span', undefined, label);
  if (name) l.append(icon(name));
  l.append(text);
  const value = el('div', 'tw-tile-value tw-num');
  box.append(l, value);
  parent.append(box);
  return { label: text, value };
}
