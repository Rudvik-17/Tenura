import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const STORAGE_KEY = '@tenura_security_deposits_v2';

/**
 * Default mock / initial records for demo tenants (like Arjun & Rahul)
 * so that when the app opens, realistic data matches the user's workflow:
 * - Arjun: Advance collected upfront before handover, Active
 * - Rahul: Exiting tenant, advance collected upfront, painting and cleaning charges deducted
 */
const DEFAULT_DEPOSIT_MAP = {
  // Pre-configured demo defaults keyed by either tenantId or lowercase name fallback
  'arjun': {
    amount: 30000,
    status: 'collected', // 'collected' | 'pending' | 'refunded'
    collectedAt: '2026-06-01',
    deductions: [],
    notes: '',
  },
  'rahul': {
    amount: 30000,
    status: 'collected',
    collectedAt: '2026-01-15',
    deductions: [
      { id: 'ded-1', title: 'Wall painting & touch-up', amount: 4000 },
      { id: 'ded-2', title: 'Deep cleaning & minor repairs', amount: 1500 },
    ],
    notes: '',
  },
};

/**
 * Fetch all stored deposits from AsyncStorage
 */
export async function getAllDeposits() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Error reading deposits from AsyncStorage:', err);
    return {};
  }
}

/**
 * Get deposit record for a specific tenant by tenant ID (or tenant object)
 */
export async function getTenantDeposit(tenantId, tenantName = '', monthlyRent = 0, dbDeposit = null) {
  try {
    const idKey = tenantId ? String(tenantId).toLowerCase() : null;
    const nameKey = tenantName ? tenantName.trim().toLowerCase().split(' ')[0] : null;

    let dbRecord = null;
    // 1. Prioritize live Supabase tenants record if tenantId is a valid UUID
    if (tenantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tenantId))) {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('security_deposit, deposit_status, deposit_deductions, deposit_notes, deposit_collected_at, deposit_refunded_at')
          .eq('id', tenantId)
          .maybeSingle();
        if (!error && data) {
          dbRecord = data;
        }
      } catch (err) {
        console.warn('Could not fetch deposit from Supabase, using cache:', err);
      }
    }

    const all = await getAllDeposits();
    let cacheRecord = null;
    if (idKey && all[idKey]) {
      cacheRecord = all[idKey];
    } else if (nameKey && all[nameKey]) {
      cacheRecord = all[nameKey];
    }

    // Merge: live DB takes precedence over local cache
    const resolvedAmount = dbRecord?.security_deposit != null
      ? Number(dbRecord.security_deposit)
      : (cacheRecord?.amount ?? (dbDeposit ? Number(dbDeposit) : (monthlyRent > 0 ? Number(monthlyRent) * 2 : 30000)));

    const deductions = Array.isArray(dbRecord?.deposit_deductions)
      ? dbRecord.deposit_deductions
      : (cacheRecord?.deductions ?? (nameKey && DEFAULT_DEPOSIT_MAP[nameKey]?.deductions ? DEFAULT_DEPOSIT_MAP[nameKey].deductions : []));

    const totalDeductions = deductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const netRefund = Math.max(0, resolvedAmount - totalDeductions);
    const status = dbRecord?.deposit_status || cacheRecord?.status || (nameKey && DEFAULT_DEPOSIT_MAP[nameKey]?.status) || 'collected';
    const collectedAt = dbRecord?.deposit_collected_at || cacheRecord?.collectedAt || null;
    const refundedAt = dbRecord?.deposit_refunded_at || cacheRecord?.refundedAt || null;
    const notes = dbRecord?.deposit_notes ?? cacheRecord?.notes ?? '';

    const result = {
      amount: resolvedAmount,
      status, // 'collected' (before handover) | 'pending' (not yet paid) | 'refunded' (returned on vacating)
      collectedAt,
      refundedAt,
      deductions,
      totalDeductions,
      netRefund,
      notes,
    };

    // Keep AsyncStorage cache updated with fresh record
    if (idKey && dbRecord) {
      all[idKey] = {
        amount: resolvedAmount,
        status,
        collectedAt,
        refundedAt,
        deductions,
        notes,
        updatedAt: new Date().toISOString(),
      };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all)).catch(() => {});
    }

    return result;
  } catch (err) {
    console.warn('Error getting tenant deposit:', err);
    const fallbackAmount = dbDeposit ? Number(dbDeposit) : 30000;
    return {
      amount: fallbackAmount,
      status: 'collected',
      collectedAt: null,
      refundedAt: null,
      deductions: [],
      totalDeductions: 0,
      netRefund: fallbackAmount,
      notes: '',
    };
  }
}

/**
 * Save / Update security deposit data for a tenant (sets custom price, status, deductions)
 */
export async function saveTenantDeposit(tenantId, tenantName, depositData) {
  try {
    const all = await getAllDeposits();
    const idKey = tenantId ? String(tenantId).toLowerCase() : 'unknown';
    const nameKey = tenantName ? tenantName.trim().toLowerCase().split(' ')[0] : null;

    const updatedRecord = {
      amount: Number(depositData.amount) || 0,
      status: depositData.status || 'collected',
      collectedAt: depositData.collectedAt || new Date().toISOString(),
      refundedAt: depositData.status === 'refunded' ? (depositData.refundedAt || new Date().toISOString()) : null,
      deductions: Array.isArray(depositData.deductions) ? depositData.deductions : [],
      notes: depositData.notes || '',
      updatedAt: new Date().toISOString(),
    };

    all[idKey] = updatedRecord;
    if (nameKey) {
      all[nameKey] = updatedRecord;
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));

    // Update Supabase tenants table with all deposit columns
    if (tenantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tenantId))) {
      const { error: dbErr } = await supabase
        .from('tenants')
        .update({
          security_deposit: updatedRecord.amount,
          deposit_status: updatedRecord.status,
          deposit_deductions: updatedRecord.deductions,
          deposit_notes: updatedRecord.notes,
          deposit_collected_at: updatedRecord.collectedAt,
          deposit_refunded_at: updatedRecord.refundedAt,
        })
        .eq('id', tenantId);

      if (dbErr) {
        console.warn('Supabase tenant deposit update error:', dbErr.message);
      }
    }

    return updatedRecord;
  } catch (err) {
    console.error('Error saving tenant deposit:', err);
    throw err;
  }
}

/**
 * Remove stored deposit data when a tenant is removed
 */
export async function removeTenantDeposit(tenantId, tenantName = '') {
  try {
    const all = await getAllDeposits();
    const idKey = tenantId ? String(tenantId).toLowerCase() : null;
    const nameKey = tenantName ? tenantName.trim().toLowerCase().split(' ')[0] : null;

    if (idKey && all[idKey]) delete all[idKey];
    if (nameKey && all[nameKey]) delete all[nameKey];

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Error removing tenant deposit from AsyncStorage:', err);
  }
}

/**
 * Convert any regional/Indic numerals (Kannada, Devanagari, Telugu, Tamil, Arabic, etc.)
 * to standard English ASCII digits (0-9)
 */
export function toAsciiDigits(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u0CE6-\u0CEF]/g, d => String(d.charCodeAt(0) - 0x0CE6)) // Kannada (೦-೯)
    .replace(/[\u0966-\u096F]/g, d => String(d.charCodeAt(0) - 0x0966)) // Devanagari (०-९)
    .replace(/[\u0C66-\u0C6F]/g, d => String(d.charCodeAt(0) - 0x0C66)) // Telugu (౦-౯)
    .replace(/[\u0BE6-\u0BEF]/g, d => String(d.charCodeAt(0) - 0x0BE6)) // Tamil (௦-௯)
    .replace(/[\u0D66-\u0D6F]/g, d => String(d.charCodeAt(0) - 0x0D66)) // Malayalam (൦-൯)
    .replace(/[\u09E6-\u09EF]/g, d => String(d.charCodeAt(0) - 0x09E6)) // Bengali (০-৯)
    .replace(/[\u0AE6-\u0AEF]/g, d => String(d.charCodeAt(0) - 0x0AE6)) // Gujarati (૦-૯)
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic (٠-٩)
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0)); // Persian / Eastern Arabic-Indic
}
