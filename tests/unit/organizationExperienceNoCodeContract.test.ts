import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const experience = readFileSync('src/core/organizations/organizationExperience.ts', 'utf8');
const provider = readFileSync('src/core/organizations/OrganizationExperienceContext.tsx', 'utf8');
const wizard = readFileSync('src/features/admin/components/OrganizationCreateWizard.tsx', 'utf8');
const superAdmin = readFileSync('src/features/admin/pages/SuperAdminConsolePage.tsx', 'utf8');
const posWorkspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const posTopBar = readFileSync('src/features/pos/components/topbar/PosTopBar.tsx', 'utf8');
const orderPanel = readFileSync('src/features/pos/components/order/CurrentOrderPanel.tsx', 'utf8');
const orderHeader = readFileSync('src/features/pos/components/order/PosOrderHeaderBar.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');

describe('organization no-code experience contract', () => {
  it('defines reusable theme, terminology and POS presets by business type', () => {
    for (const key of ['restaurant','food_manufacturing','pharmacy','car_showroom','tourism','retail','services','custom']) {
      expect(experience).toContain(key + ':');
    }
    for (const layoutKey of ['restaurant','retail','pharmacy','wholesale','vehicle','service']) {
      expect(experience).toContain("key: '" + layoutKey + "'");
    }
    expect(experience).toContain('theme_profile');
    expect(experience).toContain('terminology_profile');
    expect(experience).toContain('pos_layout');
  });

  it('loads organization experience at runtime and applies visual tokens', () => {
    expect(provider).toContain("select('business_type,business_profile')");
    expect(provider).toContain('resolveOrganizationExperience');
    expect(provider).toContain('applyBrandColor');
    expect(provider).toContain('applySurfaceColor');
    expect(provider).toContain('dataset.posLayout');
    expect(provider).toContain("setProperty('--ui-radius'");
    expect(provider).toContain("setProperty('--ui-radius-2xl'");
    expect(provider).toContain('DEFAULT_EXPERIENCE_CONTEXT');
    expect(provider).toContain('?? DEFAULT_EXPERIENCE_CONTEXT');
  });

  it('lets Super Admin customize and reset existing organization identity', () => {
    expect(superAdmin).toContain('handleSaveOrganizationExperience');
    expect(superAdmin).toContain('organizationThemeDraft');
    expect(superAdmin).toContain('organizationTerminology');
    expect(superAdmin).toContain('organizationPosLayout');
    expect(superAdmin).toContain('إرجاع افتراضيات النشاط');
    expect(superAdmin).toContain(".update({ business_profile: nextProfile })");
  });

  it('lets organization creation persist theme, terminology and POS layout', () => {
    expect(wizard).toContain('theme_profile: selectedTheme');
    expect(wizard).toContain('terminology_profile: terminology');
    expect(wizard).toContain('pos_layout:');
    expect(wizard).toContain('themeDraft');
  });

  it('keeps restaurant-only POS surfaces behind the organization layout', () => {
    expect(posTopBar).toContain('layout?.showTables');
    expect(posTopBar).toContain('layout?.showKitchen');
    expect(posWorkspace).toContain('posLayout.showTables');
    expect(posWorkspace).toContain('posLayout.showKitchen');
    expect(posWorkspace).toContain('canSendKitchen: perms.canSendKitchen && posLayout.showKitchen');
    expect(orderPanel).toContain("type !== 'dine_in' || posLayout.showTables");
    expect(orderPanel).toContain("type !== 'delivery' || posLayout.showDelivery");
    expect(orderPanel).toContain("type !== 'drive_thru' || posLayout.showDriveThru");
    expect(orderHeader).toContain('const requiresKitchenSend = layout?.showKitchen ?? true');
    expect(orderHeader).toContain('const canSendKitchen = perms.canSendKitchen && requiresKitchenSend');
    expect(orderHeader).toContain('!requiresKitchenSend || hasSent');
  });

  it('applies organization terminology beyond POS navigation', () => {
    expect(layout).toContain("item.id === 'products'");
    expect(layout).toContain("item.id === 'people-center'");
    expect(layout).toContain("item.id === 'operations-center'");
    expect(layout).toContain('terminology.items');
  });
});
