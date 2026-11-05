import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { supabase } from './supabase';
import { toAsciiDigits } from './securityDeposit';

const UTILITY_STORAGE_KEY = '@tenura_utility_bills_v1';

export const ELECTRICITY_DEPARTMENTS = [
  {
    code: 'BESCOM',
    name: 'BESCOM (Bangalore Electricity Supply Co.)',
    shortName: 'BESCOM Electricity Dept',
    upiId: 'bescom.billdesk@upi',
    region: 'Karnataka / Bengaluru',
    consumerLabel: 'Account ID / RR Number',
  },
  {
    code: 'MSEDCL',
    name: 'MSEDCL (Mahavitaran Electricity Board)',
    shortName: 'MSEDCL Electricity Dept',
    upiId: 'msedcl.ebill@upi',
    region: 'Maharashtra',
    consumerLabel: '12-Digit Consumer Number',
  },
  {
    code: 'TATAPOWER',
    name: 'Tata Power / Adani Electricity',
    shortName: 'Tata Power Electricity Dept',
    upiId: 'tatapower.bills@upi',
    region: 'Mumbai / Delhi / Metro',
    consumerLabel: 'CA Number / Consumer No.',
  },
  {
    code: 'TANGEDCO',
    name: 'TANGEDCO (Tamil Nadu Electricity Board)',
    shortName: 'TANGEDCO Electricity Dept',
    upiId: 'tangedco.eb@upi',
    region: 'Tamil Nadu / Chennai',
    consumerLabel: 'Service Connection Number',
  },
  {
    code: 'BSES',
    name: 'BSES Rajdhani / Yamuna Power',
    shortName: 'BSES Electricity Dept',
    upiId: 'bses.delhi@upi',
    region: 'Delhi NCR',
    consumerLabel: 'CA Number',
  },
  {
    code: 'TSSPDCL',
    name: 'TSSPDCL (Telangana State Southern Power)',
    shortName: 'TSSPDCL Electricity Dept',
    upiId: 'tsspdcl.ebill@upi',
    region: 'Telangana / Hyderabad',
    consumerLabel: 'USC / Service Number',
  },
  {
    code: 'CUSTOM_ELEC',
    name: 'Other / Custom Electricity Department',
    shortName: 'Electricity Department',
    upiId: 'electricity.board@upi',
    region: 'Custom State / City Board',
    consumerLabel: 'Consumer / Account Number',
  },
];

export const WATER_DEPARTMENTS = [
  {
    code: 'BWSSB',
    name: 'BWSSB (Bangalore Water Supply & Sewerage Board)',
    shortName: 'BWSSB Water Dept',
    upiId: 'bwssb.water@upi',
    region: 'Karnataka / Bengaluru',
    consumerLabel: 'RR Number / Connection ID',
  },
  {
    code: 'MCGM',
    name: 'MCGM / BMC (Mumbai Municipal Water Dept)',
    shortName: 'BMC Water Supply Dept',
    upiId: 'mcgm.water@upi',
    region: 'Maharashtra / Mumbai',
    consumerLabel: 'CCN / Water Account No.',
  },
  {
    code: 'DJB',
    name: 'DJB (Delhi Jal Board)',
    shortName: 'Delhi Jal Board Water Dept',
    upiId: 'djb.waterbill@upi',
    region: 'Delhi NCR',
    consumerLabel: 'KNO / Consumer Number',
  },
  {
    code: 'HMWSSB',
    name: 'HMWSSB (Hyderabad Metro Water Supply)',
    shortName: 'HMWSSB Water Dept',
    upiId: 'hmwssb.water@upi',
    region: 'Telangana / Hyderabad',
    consumerLabel: 'CAN Number',
  },
  {
    code: 'CMWSSB',
    name: 'CMWSSB (Chennai Metro Water Board)',
    shortName: 'Chennai Metro Water Dept',
    upiId: 'cmwssb.water@upi',
    region: 'Tamil Nadu / Chennai',
    consumerLabel: 'CMC / Consumer Number',
  },
  {
    code: 'CUSTOM_WATER',
    name: 'Other / Custom Water Supply Department',
    shortName: 'Water Supply Department',
    upiId: 'watersupply.dept@upi',
    region: 'Custom Municipal Water Board',
    consumerLabel: 'Consumer / Connection Number',
  },
];

export const UPI_PHONE_APPS = [
  {
    id: 'gpay',
    label: 'Google Pay (GPay)',
    sub: 'Opens Google Pay on your phone for direct department transfer',
    icon: 'account-balance-wallet',
    badge: 'Instant UPI',
  },
  {
    id: 'phonepe',
    label: 'PhonePe',
    sub: 'Opens PhonePe app on your phone to pay utility board',
    icon: 'smartphone',
  },
  {
    id: 'paytm',
    label: 'Paytm UPI',
    sub: 'Opens Paytm app on your phone for direct bill payment',
    icon: 'payments',
  },
  {
    id: 'bhim',
    label: 'BHIM / Any UPI App on Phone',
    sub: 'Opens your phone’s default UPI app chooser',
    icon: 'qr-code-scanner',
  },
];

function getDefaultDueDate(dayOffset = 10) {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), Math.min(28, now.getDate() + dayOffset));
  return due.toISOString().split('T')[0];
}

function getCurrentBillingCycle() {
  return new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function getDefaultTenantUtilities(unitNumber = '101', city = 'Bangalore') {
  const isMumbai = city?.toLowerCase().includes('mumbai');
  const elecDept = isMumbai ? ELECTRICITY_DEPARTMENTS[1] : ELECTRICITY_DEPARTMENTS[0];
  const waterDept = isMumbai ? WATER_DEPARTMENTS[1] : WATER_DEPARTMENTS[0];
  const cleanUnit = String(unitNumber || '101').replace(/[^a-zA-Z0-9]/g, '');

  return {
    electricity: {
      id: `elec-${cleanUnit}-${getCurrentBillingCycle().replace(/\s/g, '')}`,
      type: 'electricity',
      title: 'Electricity Bill',
      departmentCode: elecDept.code,
      departmentName: elecDept.name,
      departmentShortName: elecDept.shortName,
      departmentUpiId: elecDept.upiId,
      consumerNumber: `EL-${cleanUnit}-84920`,
      billingMonth: getCurrentBillingCycle(),
      readingInfo: '218 kWh consumed',
      amount: 1450,
      dueDate: getDefaultDueDate(7),
      status: 'pending', // 'pending' | 'paid'
      paidAt: null,
      txnId: null,
      paymentMethod: null,
    },
    water: {
      id: `water-${cleanUnit}-${getCurrentBillingCycle().replace(/\s/g, '')}`,
      type: 'water',
      title: 'Water Supply Bill',
      departmentCode: waterDept.code,
      departmentName: waterDept.name,
      departmentShortName: waterDept.shortName,
      departmentUpiId: waterDept.upiId,
      consumerNumber: `WT-${cleanUnit}-30914`,
      billingMonth: getCurrentBillingCycle(),
      readingInfo: '18 KL consumed',
      amount: 580,
      dueDate: getDefaultDueDate(9),
      status: 'pending', // 'pending' | 'paid'
      paidAt: null,
      txnId: null,
      paymentMethod: null,
    },
    history: [],
  };
}

/**
 * Load utility bills for a tenant from Supabase and AsyncStorage
 */
export async function getTenantUtilityBills(tenantId, unitNumber = '101', city = 'Bangalore') {
  const key = tenantId ? String(tenantId).toLowerCase() : 'default-tenant';
  const isUuid = tenantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tenantId));

  try {
    let cloudHistory = [];
    if (isUuid) {
      try {
        const { data: bills, error: billsErr } = await supabase
          .from('utility_bills')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });

        if (!billsErr && Array.isArray(bills) && bills.length > 0) {
          cloudHistory = bills.map((b) => ({
            id: b.id,
            billType: b.bill_type,
            title: b.title,
            departmentCode: b.department_code,
            departmentName: b.department_name,
            departmentShortName: b.department_short_name,
            departmentUpiId: b.department_upi_id,
            consumerNumber: b.consumer_number,
            billingMonth: b.billing_month,
            amount: Number(b.amount || 0),
            paidAt: b.paid_at,
            dueDate: b.due_date,
            txnId: b.txn_id,
            paymentMethod: b.payment_method,
            status: b.status,
          }));
        }
      } catch (cloudErr) {
        console.warn('Could not query utility_bills from Supabase:', cloudErr?.message);
      }
    }

    const raw = await AsyncStorage.getItem(UTILITY_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const local = all[key] || getDefaultTenantUtilities(unitNumber, city);

    if (cloudHistory.length > 0) {
      // Merge cloud history with local state
      const mergedHistoryMap = new Map();
      [...cloudHistory, ...(local.history || [])].forEach((item) => {
        const itemKey = item.txnId || item.id;
        if (!mergedHistoryMap.has(itemKey)) {
          mergedHistoryMap.set(itemKey, item);
        }
      });
      local.history = Array.from(mergedHistoryMap.values());
    }

    all[key] = local;
    AsyncStorage.setItem(UTILITY_STORAGE_KEY, JSON.stringify(all)).catch(() => {});
    return local;
  } catch (err) {
    console.warn('Error loading utility bills:', err);
    return getDefaultTenantUtilities(unitNumber, city);
  }
}

/**
 * Update bill details (department, consumer number, amount, reading, UPI ID) for Electricity or Water
 */
export async function updateTenantUtilityBill(tenantId, billType, updates, unitNumber = '101', city = 'Bangalore') {
  const key = tenantId ? String(tenantId).toLowerCase() : 'default-tenant';
  const current = await getTenantUtilityBills(tenantId, unitNumber, city);
  const target = current[billType] || {};

  const cleanAmount = updates.amount !== undefined
    ? Number(toAsciiDigits(String(updates.amount))) || 0
    : target.amount;

  const updatedBill = {
    ...target,
    ...updates,
    amount: cleanAmount,
  };

  const nextState = {
    ...current,
    [billType]: updatedBill,
  };

  try {
    const raw = await AsyncStorage.getItem(UTILITY_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[key] = nextState;
    await AsyncStorage.setItem(UTILITY_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Error saving utility bill update:', err);
  }

  return nextState;
}

/**
 * Mark a Water or Electricity bill as paid directly to the respective department
 */
export async function markUtilityBillPaid(tenantId, billType, { txnId, method, paidAt }, unitNumber = '101', city = 'Bangalore') {
  const key = tenantId ? String(tenantId).toLowerCase() : 'default-tenant';
  const isUuid = tenantId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tenantId));
  const current = await getTenantUtilityBills(tenantId, unitNumber, city);
  const target = current[billType];
  if (!target) return current;

  const timestamp = paidAt || new Date().toISOString();
  const finalTxnId = txnId || `UPI-${Math.floor(100000000000 + Math.random() * 900000000000)}`;

  const paidBill = {
    ...target,
    status: 'paid',
    paidAt: timestamp,
    txnId: finalTxnId,
    paymentMethod: method,
  };

  const historyEntry = {
    id: `${target.id}-${Date.now()}`,
    billType,
    title: target.title,
    departmentCode: target.departmentCode,
    departmentName: target.departmentName,
    departmentShortName: target.departmentShortName,
    departmentUpiId: target.departmentUpiId,
    consumerNumber: target.consumerNumber,
    billingMonth: target.billingMonth,
    amount: target.amount,
    paidAt: timestamp,
    dueDate: target.dueDate,
    txnId: finalTxnId,
    paymentMethod: method,
    status: 'paid',
  };

  const nextState = {
    ...current,
    [billType]: paidBill,
    history: [historyEntry, ...(current.history || [])],
  };

  try {
    const raw = await AsyncStorage.getItem(UTILITY_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[key] = nextState;
    await AsyncStorage.setItem(UTILITY_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('Error recording utility bill payment:', err);
  }

  // Persist to Supabase utility_bills table
  if (isUuid) {
    try {
      const { data: authUser } = await supabase.auth.getUser();
      await supabase.from('utility_bills').insert({
        tenant_id: tenantId,
        user_id: authUser?.user?.id ?? null,
        bill_type: billType,
        title: target.title || `${billType} Bill`,
        department_code: target.departmentCode,
        department_name: target.departmentName,
        department_short_name: target.departmentShortName,
        department_upi_id: target.departmentUpiId,
        consumer_number: target.consumerNumber,
        billing_month: target.billingMonth,
        amount: target.amount,
        due_date: target.dueDate,
        status: 'paid',
        paid_at: timestamp,
        txn_id: finalTxnId,
        payment_method: method,
      });
    } catch (dbErr) {
      console.warn('Could not persist utility bill payment to Supabase:', dbErr?.message);
    }
  }

  return { nextState, historyEntry };
}

/**
 * Generate ordered candidate UPI deep-link URLs for a specific phone UPI app
 * to pay directly to the respective department's UPI VPA.
 */
export function buildDepartmentUpiCandidateUrls({
  appId = 'gpay',
  upiId,
  payeeName,
  amount,
  transactionNote,
}) {
  const formattedAmount = Number(amount || 0).toFixed(2);
  const query = [
    `pa=${encodeURIComponent((upiId || '').trim())}`,
    `pn=${encodeURIComponent((payeeName || 'Utility Department').trim())}`,
    `am=${encodeURIComponent(formattedAmount)}`,
    `cu=INR`,
    `tn=${encodeURIComponent((transactionNote || 'Utility Bill Payment').trim())}`,
  ].join('&');

  const genericUpiUrl = `upi://pay?${query}`;

  if (appId === 'gpay') {
    return [
      `tez://upi/pay?${query}`,
      `gpay://upi/pay?${query}`,
      genericUpiUrl,
    ];
  }
  if (appId === 'phonepe') {
    return [
      `phonepe://pay?${query}`,
      genericUpiUrl,
    ];
  }
  if (appId === 'paytm') {
    return [
      `paytmmp://pay?${query}`,
      `paytm://upi/pay?${query}`,
      genericUpiUrl,
    ];
  }
  return [genericUpiUrl];
}

/**
 * Attempt to open the selected UPI app on the phone using app-specific scheme first,
 * falling back to generic `upi://pay` scheme.
 * Returns { opened: boolean, urlUsed: string }
 */
export async function openPhoneUpiApp({
  appId = 'gpay',
  upiId,
  payeeName,
  amount,
  transactionNote,
}) {
  const candidates = buildDepartmentUpiCandidateUrls({
    appId,
    upiId,
    payeeName,
    amount,
    transactionNote,
  });

  for (const url of candidates) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return { opened: true, urlUsed: url };
      }
    } catch {
      // Try next candidate scheme
    }
  }

  // Final direct attempt with generic upi://pay in case Android package visibility restricts canOpenURL
  const fallbackUrl = candidates[candidates.length - 1];
  try {
    await Linking.openURL(fallbackUrl);
    return { opened: true, urlUsed: fallbackUrl };
  } catch {
    return { opened: false, urlUsed: fallbackUrl };
  }
}
