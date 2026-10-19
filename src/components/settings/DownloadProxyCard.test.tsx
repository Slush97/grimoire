// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameBananaDownloadProxyConfig } from '../../types/electron';
import { showToast } from '../../stores/toastStore';
import DownloadProxyCard from './DownloadProxyCard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { error?: string }) => values?.error ? `${key}: ${values.error}` : key,
}) }));
vi.mock('../../stores/toastStore', () => ({ showToast: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('DownloadProxyCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  const config: GameBananaDownloadProxyConfig = { enabled: true, url: 'http://127.0.0.1:7890/', hasCredentials: true };
  const getConfig = vi.fn(async () => config);
  const setConfig = vi.fn(async (input: Pick<GameBananaDownloadProxyConfig, 'enabled' | 'url'>) => ({ ...input, hasCredentials: false }));
  const getDownload = vi.fn(async (): Promise<null | object> => null);
  const onSaved = vi.fn();

  function button(key: string): HTMLButtonElement {
    const result = [...host.querySelectorAll('button')].find(item => item.textContent === `settings.downloadProxy.${key}`);
    if (!result) throw new Error(`Missing ${key} button`);
    return result;
  }

  async function fill(value: string) {
    const input = host.querySelector('input:not([type="checkbox"])');
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing proxy URL');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function render() {
    await act(async () => { root.render(<DownloadProxyCard onSaved={onSaved} />); });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getConfig.mockResolvedValue(config);
    getDownload.mockResolvedValue(null);
    setConfig.mockImplementation(async input => ({ ...input, hasCredentials: false }));
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
      getGameBananaDownloadProxy: getConfig,
      setGameBananaDownloadProxy: setConfig,
      getCurrentDownload: getDownload,
      onDownloadQueueUpdated: () => () => undefined,
    } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('does not save an unchanged or equivalent endpoint', async () => {
    await render();
    expect(button('save').disabled).toBe(true);
    await fill(' http://127.0.0.1:7890 ');
    expect(button('save').disabled).toBe(true);
    await act(async () => button('save').click());
    expect(setConfig).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves an edit once and keeps confirmation inside the button', async () => {
    await render();
    await fill('socks5h://127.0.0.1:10808');
    expect(button('save').disabled).toBe(false);
    await act(async () => { button('save').click(); button('save').click(); });
    expect(setConfig).toHaveBeenCalledExactlyOnceWith({ enabled: true, url: 'socks5h://127.0.0.1:10808' });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(button('saved').disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.className).toBe('sr-only');
    await act(async () => button('saved').click());
    expect(setConfig).toHaveBeenCalledTimes(1);
    await fill(config.url);
    expect(button('save').disabled).toBe(false);
  });

  it('keeps failed edits available to retry without resetting server diagnostics', async () => {
    setConfig.mockRejectedValueOnce(new Error("Error invoking remote method 'gamebanana-download-proxy:set': Error: Enter a valid HTTP, HTTPS, or SOCKS proxy URL."));
    await render();
    await fill('invalid');
    await act(async () => button('save').click());
    expect(showToast).toHaveBeenCalledWith('settings.downloadProxy.saveFailed: Enter a valid HTTP, HTTPS, or SOCKS proxy URL.', { tone: 'error' });
    expect(onSaved).not.toHaveBeenCalled();
    expect(button('save').disabled).toBe(false);
  });

  it('clears saved credentials and disables repeated clear', async () => {
    await render();
    await act(async () => button('clear').click());
    expect(setConfig).toHaveBeenCalledExactlyOnceWith({ enabled: false, url: '' });
    expect(button('clear').disabled).toBe(true);
    expect(button('saved').disabled).toBe(true);
  });

  it('locks changes during an active download', async () => {
    getDownload.mockResolvedValue({});
    await render();
    expect(button('save').disabled).toBe(true);
    expect(button('clear').disabled).toBe(true);
    expect([...host.querySelectorAll('input')].every(input => input.disabled)).toBe(true);
  });

  it('allows clearing an unreadable saved configuration', async () => {
    getConfig.mockRejectedValueOnce(new Error('Unreadable settings'));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('settings.downloadProxy.loadFailed');
    expect(button('clear').disabled).toBe(false);
    await act(async () => button('clear').click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(setConfig).toHaveBeenCalledExactlyOnceWith({ enabled: false, url: '' });
  });
});
