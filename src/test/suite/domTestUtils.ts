import Module from 'module';
import * as path from 'path';
import { Window } from 'happy-dom';
import type * as vscode from 'vscode';

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

type GetHtmlForWebview = (this: { extensionUri: vscode.Uri }, webview: vscode.Webview) => string;

/** IDs of the panel elements that the webview script looks up. */
export const PANEL_ELEMENT_IDS = [
  'chatArea',
  'welcome',
  'inputArea',
  'slashMenu',
  'hashMenu',
  'attachmentChips',
  'attachButton',
  'promptInput',
  'sendButton'
] as const;

const DOM_GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

const moduleLoader = Module as unknown as ModuleLoader;
let panelHtml: Promise<string> | undefined;

export interface DomEnvironment {
  readonly window: Window;
  readonly document: Document;
  /** Return the element with the given ID, failing the test if it is missing. */
  byId<T extends HTMLElement = HTMLElement>(id: string): T;
  /** Create a cancelable keydown event for the given key. */
  keyDown(key: string): KeyboardEvent;
  /** Restore the previous globals and close the happy-dom window. */
  dispose(): Promise<void>;
}

export interface VsCodeApiStub {
  readonly messages: unknown[];
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * Render the production panel HTML from ChatViewProvider.getHtmlForWebview()
 * so DOM tests never drift from the markup that ships.
 */
export function renderPanelHtml(): Promise<string> {
  if (!panelHtml) {
    panelHtml = loadPanelHtml();
  }

  return panelHtml;
}

/**
 * Uncached form of renderPanelHtml(). Loads ChatViewProvider with a minimal
 * vscode stub, then drops every module that load added to the module cache.
 */
export async function loadPanelHtml(): Promise<string> {
  const cachedModules = new Set(Object.keys(require.cache));
  const originalLoad = moduleLoader._load;
  moduleLoader._load = (request: string, parent: object | null | undefined, isMain: boolean): unknown => {
    if (request === 'vscode') {
      return {
        Uri: {
          joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
            fsPath: path.join(base.fsPath, ...segments)
          })
        }
      };
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    const { ChatViewProvider } = await import('../../panel/chatViewProvider');
    const getHtmlForWebview = (ChatViewProvider.prototype as unknown as {
      getHtmlForWebview: GetHtmlForWebview;
    }).getHtmlForWebview;
    const webview = {
      cspSource: 'vscode-webview://context-relay-test',
      asWebviewUri: () => ({ toString: () => 'vscode-webview-resource://dist/webview/main.js' })
    } as unknown as vscode.Webview;

    return getHtmlForWebview.call({ extensionUri: { fsPath: __dirname } as unknown as vscode.Uri }, webview);
  } finally {
    moduleLoader._load = originalLoad;
    // Drop the modules loaded with the stubbed vscode API so suites that load
    // the provider with their own stubs (chatViewProvider.test.ts) get a fresh copy.
    for (const key of Object.keys(require.cache)) {
      if (!cachedModules.has(key)) {
        delete require.cache[key];
      }
    }
  }
}

/**
 * Load the production panel HTML into a happy-dom window and expose it through
 * the DOM globals the webview classes use. Scripts, stylesheets, frames, and
 * navigation are disabled, so the panel's script tag is never fetched or run.
 */
export async function installDom(): Promise<DomEnvironment> {
  const html = await renderPanelHtml();
  const window = new Window({
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true
      }
    }
  });
  window.document.write(html);

  const document = window.document as unknown as Document;
  const values: Record<(typeof DOM_GLOBALS)[number], unknown> = {
    window,
    document,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
  };
  const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of DOM_GLOBALS) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  }

  return {
    window,
    document,
    byId<T extends HTMLElement = HTMLElement>(id: string): T {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error(`Panel element #${id} is missing`);
      }

      return element as T;
    },
    keyDown(key: string): KeyboardEvent {
      return new window.KeyboardEvent('keydown', { key, cancelable: true }) as unknown as KeyboardEvent;
    },
    async dispose(): Promise<void> {
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[name];
        }
      }

      await window.happyDOM.close();
    }
  };
}

/** A stand-in for the webview's acquireVsCodeApi() result that records postMessage calls. */
export function createVsCodeApiStub(): VsCodeApiStub {
  const messages: unknown[] = [];
  let state: unknown;

  return {
    messages,
    postMessage: message => {
      messages.push(message);
    },
    getState: () => state,
    setState: nextState => {
      state = nextState;
    }
  };
}
