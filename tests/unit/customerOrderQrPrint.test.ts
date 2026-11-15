// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printCustomerOrderQr } from '../../src/features/qr/printCustomerOrderQr';

afterEach(() => vi.restoreAllMocks());

describe('Customer order QR printable card', () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(32);
  const link = 'https://premier.example/#/qr/secure-table-token';

  function openWindow() {
    const doc = document.implementation.createHTMLDocument('');
    const popup = { document: doc, opener: window, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    return popup;
  }

  it('prints a reusable card with table, menu branding and the exact QR link', () => {
    const popup = openWindow();
    expect(printCustomerOrderQr({ image, link, tableName: 'طاولة 4', brandName: 'منيو المطعم' })).toBe(true);
    expect(popup.opener).toBeNull();
    expect(popup.document.body.textContent).toContain('منيو المطعم');
    expect(popup.document.body.textContent).toContain('طاولة 4');
    expect(popup.document.body.textContent).toContain(link);
    const qr = popup.document.querySelector('img');
    expect(qr?.getAttribute('src')).toBe(image);
    expect(popup.print).not.toHaveBeenCalled();
    qr?.dispatchEvent(new Event('load'));
    expect(popup.print).toHaveBeenCalledOnce();
    expect(popup.focus).toHaveBeenCalledOnce();
  });

  it('treats menu/table names as text, not markup or scripts', () => {
    const popup = openWindow();
    expect(printCustomerOrderQr({
      image, link, tableName: '<img src=x onerror=alert(1)>',
      brandName: '<script>alert(1)</script>',
    })).toBe(true);
    expect(popup.document.querySelectorAll('script')).toHaveLength(0);
    expect(popup.document.querySelectorAll('img')).toHaveLength(1);
    expect(popup.document.body.textContent).toContain('<script>alert(1)</script>');
  });

  it('rejects empty or unsafe URLs and handles blocked print windows', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(printCustomerOrderQr({ image, link, tableName: 'طاولة' })).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockClear();
    expect(printCustomerOrderQr({ image, link: 'javascript:alert(1)', tableName: 'طاولة' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(printCustomerOrderQr({ image: '', link, tableName: 'طاولة' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
