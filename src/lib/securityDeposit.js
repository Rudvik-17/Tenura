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
    const all = await getAllDeposits();
    const idKey = tenantId ? String(tenantId).toLowerCase() : null;
    const nameKey = tenantName ? tenantName.trim().toLowerCase().split(' ')[0] : null;

    let record = null;
    if (idKey && all[idKey]) {
      record = all[idKey];
    } else if (nameKey && all[nameKey]) {
      record = all[nameKey];
    } else if (nameKey && DEFAULT_DEPOSIT_MAP[nameKey]) {
      record = DEFAULT_DEPOSIT_MAP[nameKey];
    }

    // Determine deposit amount: saved custom price > db column > fallback to monthly rent or 30000
    const resolvedAmount = record?.amount ?? (dbDeposit ? Number(dbDeposit) : (monthlyRent > 0 ? Number(monthlyRent) * 2 : 30000));
    const deductions = record?.deductions ?? [];
    const totalDeductions = deductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const netRefund = Math.max(0, resolvedAmount - totalDeductions);
    const status = record?.status ?? 'collected';

    return {
      amount: resolvedAmount,
      status, // 'collected' (before handover) | 'pending' (not yet paid) | 'refunded' (returned on vacating)
      collectedAt: record?.collectedAt ?? null,
      refundedAt: record?.refundedAt ?? null,
      deductions,
      totalDeductions,
      netRefund,
      notes: record?.notes ?? '',
    };
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

    // Also attempt to update Supabase tenants table in the background
    if (tenantId) {
      try {
        await supabase
          .from('tenants')
          .update({
            security_deposit: updatedRecord.amount,
          })
          .eq('id', tenantId);
      } catch (dbErr) {
        // Silently catch if remote schema hasn't executed migration yet
        console.log('Supabase tenant update skipped/failed:', dbErr?.message);
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
