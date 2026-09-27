import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const products = readFileSync('src/features/catalog/pages/ProductsPage.tsx', 'utf8');
const menu = readFileSync('src/core/navigation/menu.config.ts', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');

describe('simplified product editor contract', () => {
  it('merges recipe composition into the product editor', () => {
    expect(products).toContain('product-edit-sections');
    expect(products).toContain("setEditSection('basic')");
    expect(products).toContain("setEditSection('components')");
    expect(products).toContain("setEditSection('units')");
    expect(products).toContain("'المكونات'");
    expect(products).toContain('api.catalog.getProductDirectRawComponents');
    expect(products).toContain('api.catalog.saveProductDirectRawComponents');
  });

  it('keeps recipe URL as compatibility only and never a sidebar destination', () => {
    expect(routes).toContain('path={APP_ROUTES.recipes} element={<Navigate to={APP_ROUTES.products} replace />}');
    expect(menu).not.toContain("id: 'recipes'");
  });

  it('keeps the catalog sidebar minimal and moves advanced tools into Products', () => {
    for (const id of ['pricing', 'product-modifiers', 'product-modifier-options', 'categories', 'inventory-units']) {
      expect(menu).not.toContain(`id: '${id}'`);
    }
    expect(products).toContain('products-tools');
    expect(products).toContain('APP_ROUTES.pricing');
    expect(products).toContain('APP_ROUTES.productModifiers');
    expect(products).toContain('APP_ROUTES.productModifierOptions');
    expect(products).toContain('APP_ROUTES.categories');
    expect(products).toContain('APP_ROUTES.inventoryUnits');
  });
});
