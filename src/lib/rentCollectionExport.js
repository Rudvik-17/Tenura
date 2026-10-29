import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

const METHOD_LABELS = {
  gpay: 'Google Pay',
  phonepe: 'PhonePe',
  paytm: 'Paytm',
  upi: 'UPI',
  netbanking: 'Net Banking',
  card: 'Debit/Credit Card',
  cash: 'Cash / Direct',
};

const fmtINR = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN')}`;

const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(d);
  }
};

/**
 * Builds standard, clean CSV content with UTF-8 BOM for Microsoft Excel & Google Sheets
 */
export function buildRentCollectionCSV({ payments = [], metrics = {}, ownerName = 'Property Owner' }) {
  const generatedAt = new Date().toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines = [
    // Header Info
    [escapeCSV('TENURA - RENT COLLECTION REPORT'), ''],
    [escapeCSV('Generated Date:'), escapeCSV(generatedAt)],
    [escapeCSV('Property Owner:'), escapeCSV(ownerName)],
    ['', ''],
    // KPI Summary
    [escapeCSV('SUMMARY METRICS'), ''],
    [escapeCSV('Total Collected (INR):'), escapeCSV(metrics.mtdCollected ?? 0)],
    [escapeCSV('Pending Dues (INR):'), escapeCSV(metrics.totalPending ?? 0)],
    [escapeCSV('Collection Rate:'), escapeCSV(`${metrics.collectionRate ?? 0}%`)],
    [escapeCSV('Total Records:'), escapeCSV(payments.length)],
    ['', ''],
    // Data Table Header
    [
      escapeCSV('#'),
      escapeCSV('Tenant Name'),
      escapeCSV('Unit Number'),
      escapeCSV('Property'),
      escapeCSV('Amount (₹)'),
      escapeCSV('Due Date'),
      escapeCSV('Status'),
      escapeCSV('Paid Date'),
      escapeCSV('Payment Method'),
      escapeCSV('Transaction ID'),
    ],
  ];

  payments.forEach((p, index) => {
    const tenantName = p.tenants?.full_name || 'Tenant';
    const unit = p.tenants?.unit_number || '—';
    const property = p.tenants?.properties?.name || 'Property';
    const amount = Number(p.amount) || 0;
    const dueDate = fmtDate(p.due_date);
    const status = String(p.status || 'pending').toUpperCase();
    const paidDate = p.paid_at ? fmtDate(p.paid_at) : '—';
    const method = METHOD_LABELS[p.payment_method] || p.payment_method || '—';
    const txnId = p.transaction_id || p.utr_number || '—';

    lines.push([
      escapeCSV(index + 1),
      escapeCSV(tenantName),
      escapeCSV(unit),
      escapeCSV(property),
      escapeCSV(amount),
      escapeCSV(dueDate),
      escapeCSV(status),
      escapeCSV(paidDate),
      escapeCSV(method),
      escapeCSV(txnId),
    ]);
  });

  // UTF-8 BOM (\uFEFF) ensures Excel opens symbols and text encoding properly
  return '\uFEFF' + lines.map(row => row.join(',')).join('\r\n');
}

/**
 * Builds a styled, professional HTML report for PDF export
 */
export function buildRentCollectionHTML({ payments = [], metrics = {}, ownerName = 'Property Owner' }) {
  const generatedAt = new Date().toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const totalCollectedFormatted = fmtINR(metrics.mtdCollected ?? 0);
  const totalPendingFormatted = fmtINR(metrics.totalPending ?? 0);
  const collectionRateFormatted = `${metrics.collectionRate ?? 0}%`;

  const rowsHTML = payments.map((p, index) => {
    const tenantName = p.tenants?.full_name || 'Tenant';
    const unit = p.tenants?.unit_number || '—';
    const property = p.tenants?.properties?.name || 'Property';
    const amount = fmtINR(p.amount);
    const dueDate = fmtDate(p.due_date);
    const paidDate = p.paid_at ? fmtDate(p.paid_at) : '—';
    const method = METHOD_LABELS[p.payment_method] || p.payment_method || '—';
    const txnId = p.transaction_id || p.utr_number || '—';
    const status = (p.status || 'pending').toLowerCase();

    let statusBadgeClass = 'badge-pending';
    let statusLabel = 'PENDING';
    if (status === 'paid') {
      statusBadgeClass = 'badge-paid';
      statusLabel = 'PAID';
    } else if (status === 'overdue') {
      statusBadgeClass = 'badge-overdue';
      statusLabel = 'OVERDUE';
    }

    return `
      <tr>
        <td style="text-align: center; color: #888;">${index + 1}</td>
        <td>
          <div style="font-weight: 600; color: #111;">${tenantName}</div>
          <div style="font-size: 11px; color: #666;">Unit ${unit} · ${property}</div>
        </td>
        <td>${dueDate}</td>
        <td style="font-weight: 700; color: #111;">${amount}</td>
        <td><span class="badge ${statusBadgeClass}">${statusLabel}</span></td>
        <td>${paidDate}</td>
        <td style="font-size: 11px;">
          <div>${method}</div>
          <div style="color: #888; font-family: monospace;">${txnId}</div>
        </td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Tenura - Rent Collection Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #ffffff;
      color: #222222;
      padding: 30px;
      font-size: 12px;
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid #ea580c;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .logo {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #ea580c;
    }
    .report-title {
      font-size: 16px;
      font-weight: 700;
      color: #1f2937;
      margin-top: 4px;
    }
    .meta-box {
      text-align: right;
      font-size: 11px;
      color: #6b7280;
    }
    .meta-box strong {
      color: #111827;
    }

    /* KPI Cards */
    .kpi-grid {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi-card {
      flex: 1;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .kpi-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 18px;
      font-weight: 800;
      color: #111827;
    }
    .kpi-value.collected { color: #15803d; }
    .kpi-value.pending { color: #b45309; }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    th {
      background: #f3f4f6;
      color: #374151;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 8px;
      text-align: left;
      border-bottom: 1px solid #d1d5db;
    }
    td {
      padding: 10px 8px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 11.5px;
      vertical-align: middle;
    }
    tr:nth-child(even) td {
      background-color: #fafafa;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .badge-paid {
      background: #dcfce7;
      color: #166534;
    }
    .badge-pending {
      background: #fef3c7;
      color: #92400e;
    }
    .badge-overdue {
      background: #fee2e2;
      color: #991b1b;
    }

    /* Footer */
    .footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      color: #9ca3af;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">TENURA</div>
      <div class="report-title">Rent Collection Ledger Statement</div>
    </div>
    <div class="meta-box">
      <div>Report Date: <strong>${generatedAt}</strong></div>
      <div>Owner: <strong>${ownerName}</strong></div>
      <div>Total Records: <strong>${payments.length}</strong></div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Rent Collected</div>
      <div class="kpi-value collected">${totalCollectedFormatted}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Pending Dues</div>
      <div class="kpi-value pending">${totalPendingFormatted}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Collection Rate</div>
      <div class="kpi-value">${collectionRateFormatted}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total Invoices</div>
      <div class="kpi-value">${payments.length}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 32px; text-align: center;">#</th>
        <th>Tenant & Property</th>
        <th>Due Date</th>
        <th>Amount</th>
        <th>Status</th>
        <th>Paid Date</th>
        <th>Method & Ref</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHTML || '<tr><td colspan="7" style="text-align: center; padding: 24px; color: #888;">No rent collection records found.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <div>Confidential Statement · Generated by Tenura Property Management</div>
    <div>Page 1 of 1</div>
  </div>
</body>
</html>`;
}

/**
 * Export Rent Collection Report as PDF
 */
export async function exportRentCollectionPDF({ payments, metrics, ownerName }) {
  const html = buildRentCollectionHTML({ payments, metrics, ownerName });
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();

  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Export Rent Collection PDF',
      UTI: 'com.adobe.pdf',
    });
    return true;
  }
  throw new Error('Sharing is unavailable on this device.');
}

/**
 * Export Rent Collection Report as Excel/CSV
 */
export async function exportRentCollectionExcel({ payments, metrics, ownerName }) {
  const csv = buildRentCollectionCSV({ payments, metrics, ownerName });
  const filename = `rent_collection_${Date.now()}.csv`;
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(fileUri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export Rent Collection (Excel/CSV)',
      UTI: 'public.comma-separated-values-text',
    });
    return true;
  }
  throw new Error('Sharing is unavailable on this device.');
}
