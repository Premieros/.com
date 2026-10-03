import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { MENU_GROUPS, MENU_ITEMS } from '@/core/navigation/menu.config';
import {
  businessGroupLabel,
  businessMenuLabel,
  businessPathAllowed,
  resolveBusinessRuntime,
} from '@/core/organizations/businessRuntime';
import {
  BUSINESS_PROFILE_PRESETS,
  type BusinessProfileKey,
} from '@/core/organizations/businessProfiles';

const SUPPORTED_PROFILES: BusinessProfileKey[] = [
  'restaurant',
  'food_manufacturing',
  'pharmacy',
  'car_showroom',
  'tourism',
  'services',
  'retail',
];

function profileFromParam(value: string | undefined): BusinessProfileKey {
  return SUPPORTED_PROFILES.includes(value as BusinessProfileKey)
    ? (value as BusinessProfileKey)
    : 'retail';
}

export function BusinessRuntimePreviewPage() {
  const { profile: profileParam } = useParams();
  const profile = profileFromParam(profileParam);

  const runtime = useMemo(
    () => resolveBusinessRuntime(profile, {
      preset_key: profile,
      capabilities: BUSINESS_PROFILE_PRESETS[profile].capabilities,
    }),
    [profile],
  );

  const visibleItems = useMemo(() => {
    const order = new Map(runtime.navigation.order.map((id, index) => [id, index]));
    return MENU_ITEMS
      .filter((item) => !runtime.navigation.hidden.has(item.id))
      .filter((item) => businessPathAllowed(runtime, item.route))
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [runtime]);

  const groups = ['main', 'centers', 'catalog', 'admin'] as const;
  const compositionEnabled = runtime.capabilities.has('raw_materials')
    || runtime.capabilities.has('recipes')
    || runtime.capabilities.has('component_groups');

  return (
    <main
      data-testid="runtime-preview"
      data-profile={runtime.key}
      data-workflow={runtime.workflow}
      className="min-h-screen bg-ui-page p-6 text-ui-text"
    >
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-ui-border bg-ui-surface p-6 shadow-ui-md">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-ui-primary">
                Business Runtime Visual QA
              </p>
              <h1 data-testid="profile-title" className="mt-2 text-3xl font-black">
                {runtime.title.en}
              </h1>
              <p data-testid="profile-description" className="mt-2 max-w-3xl text-sm text-ui-muted">
                {runtime.description.en}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-xl bg-ui-page-alt px-3 py-2">
                <span className="block text-ui-subtle">Workflow</span>
                <strong data-testid="workflow">{runtime.workflow}</strong>
              </div>
              <div className="rounded-xl bg-ui-page-alt px-3 py-2">
                <span className="block text-ui-subtle">Landing</span>
                <strong data-testid="landing-route">{runtime.landingRoute}</strong>
              </div>
              <div className="rounded-xl bg-ui-page-alt px-3 py-2">
                <span className="block text-ui-subtle">Catalog mode</span>
                <strong data-testid="catalog-mode">
                  {compositionEnabled ? 'composition-enabled' : 'simple-item'}
                </strong>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
            <h2 className="text-lg font-black">Navigation</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {groups.map((group) => {
                const items = visibleItems.filter((item) => item.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} data-testid={`nav-group-${group}`} className="rounded-2xl bg-ui-page-alt p-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-ui-muted">
                      {businessGroupLabel(
                        runtime,
                        group,
                        'en',
                        MENU_GROUPS[group].en,
                      )}
                    </h3>
                    <div className="mt-3 space-y-2">
                      {items.map((item) => {
                        const label = businessMenuLabel(
                          runtime,
                          item.id,
                          'en',
                          item.label?.en || item.labelKey || item.id,
                        );
                        return (
                          <div
                            key={item.id}
                            data-testid={`nav-item-${item.id}`}
                            data-route={item.route}
                            className="flex items-center justify-between rounded-xl border border-ui-border bg-ui-surface px-3 py-2 text-sm"
                          >
                            <span className="font-bold">{label}</span>
                            <code className="text-[10px] text-ui-subtle">{item.route}</code>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
              <h2 className="text-lg font-black">Business terminology</h2>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {Object.entries(runtime.terminology).map(([key, value]) => (
                  <div key={key} className="rounded-xl bg-ui-page-alt p-3">
                    <dt className="text-xs text-ui-subtle">{key}</dt>
                    <dd data-testid={`term-${key}`} className="mt-1 font-extrabold">{value.en}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
              <h2 className="text-lg font-black">Capabilities</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {[...runtime.capabilities].sort().map((capability) => (
                  <span
                    key={capability}
                    data-testid={`capability-${capability}`}
                    className="rounded-full bg-ui-primary-soft px-3 py-1 text-xs font-bold text-ui-primary"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
            <h2 className="text-lg font-black">Dashboard sections</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {[...runtime.dashboard.sections].map((section) => (
                <span
                  key={section}
                  data-testid={`dashboard-section-${section}`}
                  className="rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2 text-sm font-bold"
                >
                  {section}
                </span>
              ))}
            </div>

            <h3 className="mt-6 text-sm font-black">Quick actions</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {runtime.dashboard.quickActions
                .filter((action) => !action.capability || runtime.capabilities.has(action.capability))
                .filter((action) => businessPathAllowed(runtime, action.route))
                .map((action) => (
                  <div
                    key={action.id}
                    data-testid={`quick-action-${action.id}`}
                    data-route={action.route}
                    className="rounded-xl border border-ui-border bg-ui-page-alt p-3"
                  >
                    <span className="block font-extrabold">{action.en}</span>
                    <code className="text-[10px] text-ui-subtle">{action.route}</code>
                  </div>
                ))}
            </div>
          </div>

          <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
            <h2 className="text-lg font-black">Operational profile</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-ui-page-alt p-4">
                <span className="text-xs text-ui-subtle">Business fields</span>
                <strong data-testid="runtime-field-count" className="mt-1 block text-2xl">
                  {runtime.runtimeFields.length}
                </strong>
              </div>
              <div className="rounded-xl bg-ui-page-alt p-4">
                <span className="text-xs text-ui-subtle">Record workflows</span>
                <strong data-testid="record-type-count" className="mt-1 block text-2xl">
                  {runtime.recordTypes.length}
                </strong>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {runtime.recordTypes.map((record) => (
                <div
                  key={record.key}
                  data-testid={`record-type-${record.key}`}
                  className="rounded-xl border border-ui-border px-3 py-2 text-sm"
                >
                  <strong>{record.en}</strong>
                  <span className="ms-2 text-ui-subtle">({record.key})</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
