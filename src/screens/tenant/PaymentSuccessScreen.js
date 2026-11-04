import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import { buildReceiptHTML } from '../../lib/receiptHTML';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import { verifyPaymentReceiptEligibility } from '../../services/razorpayService';

const METHOD_LABELS = {
  razorpay: 'Razorpay Secure Checkout',
  upi_direct: 'Direct UPI (Owner Verified)',
  upi: 'UPI',
  gpay: 'Google Pay',
  phonepe: 'PhonePe',
  paytm: 'Paytm',
  bhim: 'BHIM / UPI App',
};

export default function PaymentSuccessScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    paymentId = null,
    amount = 0,
    method = 'razorpay',
    txnId = '',
    paidAt = new Date().toISOString(),
    billType = null,
    departmentName = null,
    departmentUpiId = null,
    consumerNumber = null,
  } = route?.params ?? {};

  const isUtilityBill = Boolean(billType || departmentName);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [verifying, setVerifying] = useState(!isUtilityBill);
  const [verifiedPayment, setVerifiedPayment] = useState(null);
  const [verificationError, setVerificationError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadAndVerify() {
      if (!user) {
        if (mounted) setVerifying(false);
        return;
      }

      const { data: tRows } = await supabase
        .from('tenants')
        .select('id, full_name, unit_number, properties(name)')
        .eq('user_id', user.id)
        .limit(1);

      const tenant = tRows?.[0] ?? null;
      if (mounted && tenant) setTenantInfo(tenant);

      if (isUtilityBill) {
        if (mounted) setVerifying(false);
        return;
      }

      try {
        let targetPaymentId = paymentId;
        if (!targetPaymentId && tenant?.id && txnId) {
          const cleanTxn = String(txnId).trim();
          if (cleanTxn) {
            const { data: pRows } = await supabase
              .from('payments')
              .select('id')
              .eq('tenant_id', tenant.id)
              .or(`transaction_id.eq.${cleanTxn},razorpay_payment_id.eq.${cleanTxn}`)
              .limit(1);
            targetPaymentId = pRows?.[0]?.id ?? null;
          }
        }

        if (!targetPaymentId) {
          if (mounted) {
            setVerifiedPayment(null);
            setVerificationError('No confirmed settled rent payment record was found on the server.');
            setVerifying(false);
          }
          return;
        }

        const { data: eligibility } = await verifyPaymentReceiptEligibility(targetPaymentId);
        if (!mounted) return;

        if (!eligibility?.eligible || !eligibility?.payment) {
          setVerifiedPayment(null);
          setVerificationError(
            eligibility?.reason || 'This payment has not been confirmed as settled on the server yet.'
          );
        } else {
          setVerifiedPayment(eligibility.payment);
          setVerificationError(null);
        }
      } catch (err) {
        if (mounted) {
          setVerifiedPayment(null);
          setVerificationError(err?.message || 'Unable to verify payment settlement.');
        }
      } finally {
        if (mounted) setVerifying(false);
      }
    }

    loadAndVerify();
    return () => {
      mounted = false;
    };
  }, [user?.id, paymentId, txnId, isUtilityBill]);

  const effectiveAmount = verifiedPayment
    ? Math.max(0, Number(verifiedPayment.amount || 0) - Number(verifiedPayment.refunded_amount || 0))
    : Number(amount || 0);
  const effectiveMethod = verifiedPayment?.payment_method || method;
  const effectiveTxnId =
    verifiedPayment?.transaction_id ||
    verifiedPayment?.razorpay_payment_id ||
    verifiedPayment?.utr_number ||
    txnId;
  const effectivePaidAt = verifiedPayment?.paid_at || paidAt;

  const formattedDate = new Date(effectivePaidAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const formattedTime = new Date(effectivePaidAt).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit',
  });

  const DETAILS = [
    ...(billType ? [{ key: 'Bill Type', value: billType, highlight: true }] : []),
    ...(departmentName ? [{ key: 'Department Paid', value: departmentName }] : []),
    ...(departmentUpiId ? [{ key: 'Department UPI ID', value: departmentUpiId }] : []),
    ...(consumerNumber ? [{ key: 'Consumer / RR No.', value: consumerNumber }] : []),
    { key: 'Amount Paid', value: `₹${Number(effectiveAmount).toLocaleString('en-IN')}`, highlight: true },
    ...(Number(verifiedPayment?.refunded_amount || 0) > 0
      ? [{ key: 'Refunded', value: `₹${Number(verifiedPayment.refunded_amount).toLocaleString('en-IN')}` }]
      : []),
    ...(verifiedPayment?.is_legacy
      ? [{ key: 'Record Type', value: 'Historical Record (Imported)', highlight: true }]
      : []),
    { key: 'Payment Method', value: METHOD_LABELS[effectiveMethod] ?? effectiveMethod },
    { key: 'Transaction Date', value: `${formattedDate} · ${formattedTime}` },
    { key: 'Transaction ID', value: effectiveTxnId || '—' },
    {
      key: 'Status',
      value: verifiedPayment?.status === 'partially_refunded' ? 'Confirmed (Partial Refund)' : 'Confirmed',
      highlight: true,
    },
  ];

  const handleDownload = async () => {
    if (!isUtilityBill && !verifiedPayment) {
      Alert.alert('Receipt Unavailable', 'Paid receipts are only issued after confirmed server settlement.');
      return;
    }
    setDownloading(true);
    try {
      const html = buildReceiptHTML({
        txnId: effectiveTxnId,
        amount: verifiedPayment ? verifiedPayment.amount : effectiveAmount,
        refundedAmount: verifiedPayment?.refunded_amount ?? 0,
        status: verifiedPayment?.status ?? 'paid',
        verificationStatus: verifiedPayment?.verification_status ?? null,
        method: effectiveMethod,
        paidAt: effectivePaidAt,
        tenantName: tenantInfo?.full_name ?? 'Tenant',
        propertyName: tenantInfo?.properties?.name ?? 'Property',
        unitNumber: tenantInfo?.unit_number ?? '—',
        paymentTitle: billType,
        departmentName,
        departmentUpiId,
        consumerNumber,
      });

      const { uri } = await Print.printToFileAsync({ html, base64: false });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save or share your receipt',
          UTI: 'com.adobe.pdf',
        });
      }
    } catch (err) {
      Alert.alert('Error', err?.message || 'Could not generate receipt. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (verifying) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.tertiaryFixedDim} />
        <Text style={[styles.successSubtitle, { marginTop: 16 }]}>
          Verifying confirmed payment settlement…
        </Text>
      </View>
    );
  }

  if (!isUtilityBill && !verifiedPayment) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <TouchableOpacity
            style={styles.backRow}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="arrow-back" size={18} color="rgba(255,255,255,0.7)" />
            <Text style={styles.backText}>Tenura</Text>
          </TouchableOpacity>

          <View style={styles.iconWrapper}>
            <View style={[styles.iconCircle, { backgroundColor: colors.errorContainer }]}>
              <MaterialIcons name="hourglass-top" size={40} color={colors.error} />
            </View>
          </View>

          <Text style={styles.successTitle}>Payment Not Confirmed</Text>
          <Text style={styles.successSubtitle}>
            {verificationError ||
              'A paid receipt can only be issued after settlement is confirmed by the payment gateway or approved by the property owner.'}
          </Text>

          <TouchableOpacity
            style={styles.dashboardBtn}
            onPress={() => navigation.getParent()?.navigate('Dashboard')}
          >
            <MaterialIcons name="dashboard" size={18} color={colors.primary} />
            <Text style={styles.dashboardText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
        {/* Back link */}
        <TouchableOpacity
          style={styles.backRow}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={18} color="rgba(255,255,255,0.7)" />
          <Text style={styles.backText}>Tenura</Text>
        </TouchableOpacity>

        {/* Success icon */}
        <View style={styles.iconWrapper}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="check" size={40} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.successTitle}>Payment Successful</Text>
        <Text style={styles.successSubtitle}>
          {departmentName
            ? `Your ${billType || 'utility bill'} payment has been sent directly to ${departmentName} via UPI.`
            : 'Your rent payment settlement has been verified and recorded.'}
        </Text>

        {/* Transaction details */}
        <View style={styles.detailCard}>
          {DETAILS.map(({ key, value, highlight }) => (
            <View key={key} style={styles.detailRow}>
              <Text style={styles.detailKey}>{key}</Text>
              <Text style={[styles.detailValue, highlight && styles.detailValueHighlight]}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <RateLimitedButton
          style={[styles.downloadBtn, downloading && styles.downloadBtnDisabled]}
          onPress={handleDownload}
          disabled={downloading}
        >
          {downloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialIcons name="download" size={18} color={colors.primary} />
          )}
          <Text style={styles.downloadText}>
            {downloading ? 'Generating receipt…' : 'Download Receipt'}
          </Text>
        </RateLimitedButton>

        <TouchableOpacity
          style={styles.dashboardBtn}
          onPress={() => navigation.getParent()?.navigate('Dashboard')}
        >
          <MaterialIcons name="dashboard" size={18} color={colors.primary} />
          <Text style={styles.dashboardText}>Back to Dashboard</Text>
        </TouchableOpacity>

        {/* Security footer */}
        <View style={styles.securityRow}>
          <MaterialIcons name="lock" size={12} color="rgba(255,255,255,0.4)" />
          <Text style={styles.securityText}>End-to-End Encrypted Secure Payment</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  scroll: {
    paddingHorizontal: 24,
    alignItems: 'center',
  },

  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingVertical: 16,
  },
  backText: {
    fontFamily: fonts.manropeSemiBold, fontSize: 13,
    letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)',
  },

  iconWrapper: { marginTop: 20, marginBottom: 20 },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.tertiaryFixedDim,
    alignItems: 'center', justifyContent: 'center',
  },

  successTitle: {
    fontFamily: fonts.manropeBold, fontSize: 28,
    color: colors.onPrimary, marginBottom: 8, textAlign: 'center',
  },
  successSubtitle: {
    fontFamily: fonts.interRegular, fontSize: 14,
    color: 'rgba(255,255,255,0.65)', textAlign: 'center',
    lineHeight: 20, marginBottom: 28, paddingHorizontal: 12,
  },

  detailCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 16,
    width: '100%', marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 10,
  },
  detailKey: {
    fontFamily: fonts.interRegular, fontSize: 13,
    color: 'rgba(255,255,255,0.55)', flex: 1,
  },
  detailValue: {
    fontFamily: fonts.interSemiBold, fontSize: 13,
    color: 'rgba(255,255,255,0.85)', flex: 1.2, textAlign: 'right',
  },
  detailValueHighlight: {
    color: colors.tertiaryFixedDim,
  },

  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8, paddingVertical: 14,
    paddingHorizontal: 28, marginBottom: 12, width: '100%',
    justifyContent: 'center',
  },
  downloadBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  downloadText: {
    fontFamily: fonts.interSemiBold, fontSize: 14,
    color: colors.primary,
  },

  dashboardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.tertiaryFixedDim,
    borderRadius: 8, paddingVertical: 14,
    paddingHorizontal: 28, marginBottom: 28, width: '100%',
    justifyContent: 'center',
  },
  dashboardText: {
    fontFamily: fonts.interSemiBold, fontSize: 14,
    color: colors.primary,
  },

  securityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  securityText: {
    fontFamily: fonts.interRegular, fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
});
