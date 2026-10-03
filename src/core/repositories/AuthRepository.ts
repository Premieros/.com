import type { AppUser } from '@/lib/types';
import type { RoleDefRow } from '@/context/RolesContext';

const USER_PROFILE_KEY = 'premier:cached_app_user_profile';
const ROLES_MATRIX_KEY = 'premier:cached_roles_matrix';

export class AuthRepository {
  public static saveUserProfile(user: AppUser): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
      }
    } catch (e) {
      console.warn('[AuthRepository] Failed to save user profile cache', e);
    }
  }

  public static getCachedUserProfile(): AppUser | null {
    try {
      if (typeof localStorage !== 'undefined') {
        const str = localStorage.getItem(USER_PROFILE_KEY);
        return str ? (JSON.parse(str) as AppUser) : null;
      }
    } catch (e) {
      console.warn('[AuthRepository] Failed to read cached user profile', e);
    }
    return null;
  }

  public static clearUserProfile(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(USER_PROFILE_KEY);
      }
    } catch {
      // ignore
    }
  }

  public static saveRolesMatrix(roles: RoleDefRow[]): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ROLES_MATRIX_KEY, JSON.stringify(roles));
      }
    } catch (e) {
      console.warn('[AuthRepository] Failed to save roles matrix cache', e);
    }
  }

  public static getCachedRolesMatrix(): RoleDefRow[] | null {
    try {
      if (typeof localStorage !== 'undefined') {
        const str = localStorage.getItem(ROLES_MATRIX_KEY);
        return str ? (JSON.parse(str) as RoleDefRow[]) : null;
      }
    } catch (e) {
      console.warn('[AuthRepository] Failed to read cached roles matrix', e);
    }
    return null;
  }

  public static clearRolesMatrix(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(ROLES_MATRIX_KEY);
      }
    } catch {
      // ignore
    }
  }
}
