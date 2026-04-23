import type { ContextSource } from './models/contextItem';

export type DisplaySource = ContextSource | 'all';

export const SOURCE_TEXT_ICONS: Record<DisplaySource, string> = {
  mail: '📧',
  teams: '💬',
  sharepoint: '📄',
  onedrive: '☁️',
  onenote: '🗒️',
  planner: '✅',
  connectors: '🔗',
  all: '🔍'
};

export const SOURCE_LABELS: Record<DisplaySource, string> = {
  mail: 'Exchange Mail',
  teams: 'Teams',
  sharepoint: 'SharePoint',
  onedrive: 'OneDrive',
  onenote: 'OneNote',
  planner: 'Planner',
  connectors: 'Connectors',
  all: 'All Sources'
};

const ONENOTE_ICON_SVG = `
<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <rect x="1.75" y="2" width="12.5" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
  <path d="M5.25 2.75V13.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="3.5" cy="4.75" r="0.75" fill="currentColor"/>
  <circle cx="3.5" cy="8" r="0.75" fill="currentColor"/>
  <circle cx="3.5" cy="11.25" r="0.75" fill="currentColor"/>
  <path d="M7.75 5H11.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M7.75 8H11.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M7.75 11H10.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`.trim();

const PLANNER_ICON_SVG = `
<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <rect x="2" y="2.5" width="12" height="11.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
  <path d="M4.25 5.5L5.2 6.45L6.9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 5.5H11.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M4.25 9.5L5.2 10.45L6.9 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 9.5H11.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M4 2V1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M12 2V1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`.trim();

export const SOURCE_INLINE_SVGS: Partial<Record<DisplaySource, string>> = {
  onenote: ONENOTE_ICON_SVG,
  planner: PLANNER_ICON_SVG
};

export function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source as DisplaySource] ?? capitalizeFallback(source);
}

export function getSourceTextIcon(source: string): string {
  return SOURCE_TEXT_ICONS[source as DisplaySource] ?? '📎';
}

export function getSourceInlineSvg(source: string): string | undefined {
  return SOURCE_INLINE_SVGS[source as DisplaySource];
}

function capitalizeFallback(source: string): string {
  return source.length === 0 ? 'Source' : source.charAt(0).toUpperCase() + source.slice(1);
}
