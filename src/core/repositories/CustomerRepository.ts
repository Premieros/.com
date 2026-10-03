import { supabase } from '@/api';
import { dbGetAll, dbPut, dbReplaceAll } from './LocalDatabase';
import type { Customer } from '@/lib/types';

export class CustomerRepository {
  public static async getCustomers(branchId?: string, options: { forceNetwork?: boolean } = {}): Promise<Customer[]> {
    const cached = await this.getLocalCustomers(branchId);
    const shouldFetch = options.forceNetwork || (cached.length === 0 && (typeof navigator === 'undefined' || navigator.onLine));

    if (shouldFetch) {
      try {
        let q = supabase.from('customers').select('*');
        if (branchId) q = q.eq('branch_id', branchId);
        const { data, error } = await q.order('name');
        if (!error && Array.isArray(data)) {
          const fresh = data as Customer[];
          await dbReplaceAll('customers', fresh);
          return fresh;
        }
      } catch (err) {
        console.warn('[CustomerRepository] Network fetch error, using cache:', err);
      }
    }
    return cached;
  }

  public static async getLocalCustomers(branchId?: string): Promise<Customer[]> {
    const all = await dbGetAll<Customer>('customers');
    if (!branchId) return all;
    return all.filter((c) => c.branch_id === branchId || !c.branch_id);
  }

  public static async saveCustomerLocally(customer: Customer): Promise<void> {
    await dbPut('customers', customer);
  }

  public static async createCustomer(customer: Omit<Customer, 'id'> & { id?: string }): Promise<Customer> {
    const newCustomer: Customer = {
      ...customer,
      id: customer.id || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      created_at: new Date().toISOString(),
    };

    // Save locally first
    await dbPut('customers', newCustomer);

    // If online, save to Supabase
    if (typeof navigator === 'undefined' || navigator.onLine) {
      try {
        const { data, error } = await supabase.from('customers').insert(newCustomer).select().maybeSingle();
        if (!error && data) {
          await dbPut('customers', data as Customer);
          return data as Customer;
        }
      } catch (err) {
        console.warn('[CustomerRepository] Online insert failed, customer retained locally:', err);
      }
    }

    return newCustomer;
  }
}
