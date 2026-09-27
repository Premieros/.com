import { HashRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { RolesProvider } from '../context/RolesContext';
import { OfflineProvider } from '../context/OfflineContext';
import { ToastProvider } from '../components/Toast';
import { GuidedWorkflowProvider } from '@/core/guard/GuidedWorkflowContext';
import { OrganizationModulesProvider } from '@/core/modules/OrganizationModulesContext';
import type { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <SettingsProvider>
            <RolesProvider>
              <OrganizationModulesProvider>
                <OfflineProvider>
                <ToastProvider>
                  <HashRouter>
                    <GuidedWorkflowProvider>
                      {children}
                    </GuidedWorkflowProvider>
                  </HashRouter>
                </ToastProvider>
                </OfflineProvider>
              </OrganizationModulesProvider>
            </RolesProvider>
          </SettingsProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
