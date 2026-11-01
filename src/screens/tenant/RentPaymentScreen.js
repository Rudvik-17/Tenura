import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  AppState,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { supabase } from '../../lib/supabase';
import { showPaymentConfirmed, scheduleRentReminder } from '../../lib/notifications';
import { openPhoneUpiApp } from '../../lib/utilityBills';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import StatusChip from '../../components/StatusChip';
import PrimaryButton from '../../components/PrimaryButton';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import {
  createRazorpayOrder,
  verifyRazorpayCheckout,
  reconcileRazorpayPayment,
  reportRazorpayAttemptFailed,
  fetchCurrentRentObligation,
  submitUpiReference,
  isValidPaymentUuid,
} from '../../services/razorpayService';

function generateRazorpayHtml(keyId, amount, email, name, phone, orderId) {
  const amountInPaise = Math.round(amount * 100);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script>
          (function() {
            var origLog = console.log;
            console.log = function(...args) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                status: 'console_log',
                message: args.join(' ')
              }));
              origLog.apply(console, args);
            };
            var origErr = console.error;
            console.error = function(...args) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                status: 'console_error',
                message: args.join(' ')
              }));
              origErr.apply(console, args);
            };
          })();
        </script>
        <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        <style>
          body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f8f9fa;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          .loader-container {
            text-align: center;
          }
          .loader {
            border: 4px solid #e9ecef;
            border-top: 4px solid #3399cc;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 12px auto;
          }
          .text {
            font-size: 14px;
            color: #495057;
            font-weight: 500;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loader-container">
          <div class="loader"></div>
          <div class="text">Loading Secure Checkout...</div>
        </div>
        <script>
          window.onload = function() {
            try {
              const options = {
                "key": "${keyId}",
                "amount": ${amountInPaise},
                "currency": "INR",
                "name": "Tenura",
                "description": "Rent Payment",
                "order_id": "${orderId || ''}",
                "prefill": {},
                "theme": {
                  "color": "#3399cc"
                },
                "handler": function (response) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    status: 'success',
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_signature: response.razorpay_signature
                  }));
                },
                "modal": {
                  "ondismiss": function () {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      status: 'dismissed'
                    }));
                  }
                }
              };

              const prefillName = "${name || ''}";
              const prefillEmail = "${email || ''}";
              const prefillPhone = "${phone || ''}";

              if (prefillName) options.prefill.name = prefillName;
              if (prefillEmail) options.prefill.email = prefillEmail;
              if (prefillPhone) options.prefill.contact = prefillPhone;

              const rzp = new Razorpay(options);

              rzp.on('payment.failed', function (response) {
                console.error('Razorpay Payment Failed details: ' + JSON.stringify(response.error));
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  status: 'failed',
                  error: response.error
                }));
              });

              rzp.open();
            } catch (err) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                status: 'error',
                message: err.message
              }));
            }
          };
        </script>
      </body>
    </html>
  `;
}

const PAYMENT_METHODS = [
  {
    id: 'razorpay',
    label: 'Razorpay Secure Checkout',
    sub: 'Pay via Cards, Netbanking, UPI, Wallets',
    icon: 'credit-card',
    badge: 'Verified',
    type: 'razorpay',
  },
  {
    id: 'gpay',
    label: 'Google Pay',
    sub: 'Direct UPI transfer (requires owner UTR verification)',
    icon: 'payment',
    type: 'direct_upi',
  },
  {
    id: 'phonepe',
    label: 'PhonePe',
    sub: 'Direct UPI transfer (requires owner UTR verification)',
    icon: 'smartphone',
    type: 'direct_upi',
  },
  {
    id: 'paytm',
    label: 'Paytm',
    sub: 'Direct UPI transfer (requires owner UTR verification)',
    icon: 'account-balance-wallet',
    type: 'direct_upi',
  },
];

export default function RentPaymentScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tenantPhone, setTenantPhone] = useState('');
  const [lease, setLease] = useState(null);
  const [payment, setPayment] = useState(null);
  const [upiDestination, setUpiDestination] = useState(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [noActiveLease, setNoActiveLease] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState('razorpay');
  const [paying, setPaying] = useState(false);
  const awaitingUpiReturn = useRef(false);

  // Real Razorpay WebView states
  const [showRealRazorpay, setShowRealRazorpay] = useState(false);
  const [razorpayHtml, setRazorpayHtml] = useState('');
  const activeOrderIdRef = useRef(null);

  // UPI Manual Verification states
  const [showUtrModal, setShowUtrModal] = useState(false);
  const [utrInput, setUtrInput] = useState('');
  const [submittingUtr, setSubmittingUtr] = useState(false);

  const isDirectUpiVerified = Boolean(
    upiDestination?.verified &&
    upiDestination?.upi_id &&
    upiDestination?.payee_name
  );

  const fetchPayment = useCallback(async () => {
    if (!user?.id) return;
    setError(null);
    setNotSetUp(false);
    setNoActiveLease(false);

    const { data: obligationState, error: obErr } = await fetchCurrentRentObligation();
    if (obErr || !obligationState) {
      setError(obErr?.message || 'Unable to load rent obligation.');
      setLoading(false);
      return;
    }

    if (obligationState.not_set_up || obligationState.status === 'no_tenant') {
      setNotSetUp(true);
      setLease(null);
      setPayment(null);
      setUpiDestination(null);
      setLoading(false);
      return;
    }

    setTenantPhone(obligationState.tenant?.phone || '');
    setLease(obligationState.lease || null);
    setUpiDestination(obligationState.upi_destination || null);

    if (obligationState.status === 'no_active_lease') {
      setNoActiveLease(true);
      setPayment(null);
      setLoading(false);
      return;
    }

    let paymentData = obligationState.payment || null;

    // Reconcile any interrupted Razorpay checkout attempts if an obligation is still outstanding
    if (
      paymentData &&
      isValidPaymentUuid(paymentData.id) &&
      ['pending', 'overdue', 'under_review', 'reversed'].includes(paymentData.status)
    ) {
      const { data: reconData } = await reconcileRazorpayPayment({ paymentId: paymentData.id });
      if (reconData?.reconciled && reconData?.status === 'paid') {
        paymentData = null;
      }
    }

    setPayment(paymentData);
    setLoading(false);

    if (paymentData?.due_date && (paymentData.status === 'pending' || paymentData.status === 'overdue')) {
      scheduleRentReminder({ amount: paymentData.amount, dueDate: paymentData.due_date });
    }
  }, [user?.id]);

  useEffect(() => {
    fetchPayment();
  }, [fetchPayment]);

  const navigateToConfirmedSuccess = useCallback(({
    paymentId,
    amount,
    method,
    txnId,
    paidAt,
  }) => {
    showPaymentConfirmed({ amount, method });
    navigation.navigate('PaymentSuccess', {
      paymentId,
      amount,
      method,
      txnId,
      paidAt,
      verifiedSettlement: true,
    });
  }, [navigation]);

  const reconcileInterruptedCheckout = useCallback(async (orderIdOverride = null) => {
    if (!payment || !isValidPaymentUuid(payment.id)) {
      setPaying(false);
      return false;
    }

    const orderToCheck = orderIdOverride || activeOrderIdRef.current;
    const { data: reconData } = await reconcileRazorpayPayment({
      paymentId: payment.id,
      orderId: orderToCheck,
    });

    if (reconData?.reconciled && reconData?.status === 'paid') {
      activeOrderIdRef.current = null;
      setPaying(false);
      const settledAmount = Number(reconData.amount ?? payment.amount);
      const txnId = reconData.transactionId || orderToCheck;
      const paidAt = reconData.paidAt || new Date().toISOString();

      navigateToConfirmedSuccess({
        paymentId: reconData.paymentId || payment.id,
        amount: settledAmount,
        method: 'razorpay',
        txnId,
        paidAt,
      });
      return true;
    }

    setPaying(false);
    return false;
  }, [payment, navigateToConfirmedSuccess]);

  const verifyRazorpayPayment = useCallback(async (orderId, razorpayPaymentId, signature) => {
    if (!payment || !isValidPaymentUuid(payment.id)) {
      setPaying(false);
      Alert.alert('Invalid Obligation', 'No valid server rent obligation found to verify.');
      return;
    }

    setPaying(true);

    try {
      const { data: funcData, error: funcError } = await verifyRazorpayCheckout({
        orderId,
        razorpayPaymentId,
        signature,
        paymentId: payment.id,
      });

      if (funcError || !funcData || !funcData.success) {
        const reconciled = await reconcileInterruptedCheckout(orderId);
        if (reconciled) return;
        throw funcError || new Error('Server payment verification failed.');
      }

      activeOrderIdRef.current = null;
      setPaying(false);
      const settledAmount = Number(funcData.amount ?? payment.amount);
      const txnId = funcData.transactionId || razorpayPaymentId;
      const paidAt = funcData.paidAt || new Date().toISOString();

      navigateToConfirmedSuccess({
        paymentId: funcData.paymentId || payment.id,
        amount: settledAmount,
        method: 'razorpay',
        txnId,
        paidAt,
      });
    } catch (err) {
      setPaying(false);
      Alert.alert(
        'Verification Pending',
        `Your payment could not be verified immediately (${err.message}). If money was debited, it will reconcile automatically.`
      );
    }
  }, [payment, reconcileInterruptedCheckout, navigateToConfirmedSuccess]);

  // Reconcile interrupted Razorpay checkout or prompt UTR entry when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (awaitingUpiReturn.current) {
          awaitingUpiReturn.current = false;
          setPaying(false);
          Alert.alert(
            'Submit UPI Reference (UTR)',
            'If you completed the transfer in your UPI app, enter the 12-digit UTR number so the property owner can verify and settle your payment.',
            [
              {
                text: 'Not Paid / Cancelled',
                style: 'cancel',
                onPress: () => setPaying(false),
              },
              {
                text: 'Enter UTR Reference',
                onPress: () => setShowUtrModal(true),
              },
            ],
            { cancelable: false }
          );
        } else if (activeOrderIdRef.current && !showRealRazorpay) {
          reconcileInterruptedCheckout(activeOrderIdRef.current);
        }
      }
    });
    return () => subscription.remove();
  }, [reconcileInterruptedCheckout, showRealRazorpay]);

  const handleUtrSubmit = async () => {
    const trimmedUtr = utrInput.trim();
    if (!trimmedUtr || trimmedUtr.length < 6) {
      Alert.alert('Invalid Reference', 'Please enter a valid UPI reference number (UTR).');
      return;
    }

    if (!payment || !isValidPaymentUuid(payment.id)) {
      Alert.alert('Unavailable', 'No active rent obligation found.');
      return;
    }

    setSubmittingUtr(true);

    try {
      const { data: rpcResult, error: rpcErr } = await submitUpiReference({
        paymentId: payment.id,
        utrNumber: trimmedUtr,
        paymentMethod: selectedMethod,
      });

      if (rpcErr || !rpcResult) {
        throw rpcErr || new Error('Could not record UPI reference.');
      }

      setShowUtrModal(false);
      setUtrInput('');
      await fetchPayment();

      Alert.alert(
        'Submitted for Owner Review',
        `Reference ${rpcResult.utr_number || trimmedUtr} has been recorded as Under Review. Your rent obligation remains outstanding until the property owner verifies bank settlement, after which your paid receipt will be issued.`
      );
    } catch (err) {
      Alert.alert('Submission Error', err.message || 'Could not record UPI payment reference.');
    } finally {
      setSubmittingUtr(false);
    }
  };

  if (!user) return null;

  const daysUntilDue = (dueDate) => {
    const diff = new Date(dueDate).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `Due in ${days} day${days === 1 ? '' : 's'}`;
  };

  const handleConfirmPay = async () => {
    if (!payment || !isValidPaymentUuid(payment.id)) {
      Alert.alert('No Rent Obligation', 'There is no payable rent obligation to settle.');
      return;
    }

    if (selectedMethod === 'razorpay') {
      const keyId = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID;

      if (!keyId || keyId === 'rzp_test_defaultKeyId') {
        Alert.alert(
          'Payment Gateway Not Configured',
          'Razorpay checkout is unavailable because EXPO_PUBLIC_RAZORPAY_KEY_ID is not configured. Please contact support or your property manager.'
        );
        return;
      }

      setPaying(true);

      try {
        const { data: funcData, error: funcError } = await createRazorpayOrder(payment.id);

        if (funcError || !funcData) {
          throw funcError || new Error('Failed to generate order ID.');
        }

        // If a previous interrupted checkout for this payment was already captured on Razorpay, reconcile immediately
        if (funcData.alreadyPaid || funcData.reconciled) {
          activeOrderIdRef.current = null;
          setPaying(false);
          const settledAmount = Number(funcData.verifiedAmount ?? payment.amount);
          const txnId = funcData.transactionId || funcData.razorpayPaymentId || funcData.orderId;
          const paidAt = funcData.paidAt || new Date().toISOString();

          navigateToConfirmedSuccess({
            paymentId: funcData.paymentId || payment.id,
            amount: settledAmount,
            method: 'razorpay',
            txnId,
            paidAt,
          });
          return;
        }

        const orderId = funcData.orderId;
        const verifiedAmount = Number(funcData.verifiedAmount ?? payment.amount);
        activeOrderIdRef.current = orderId;
        const email = user.email || '';
        const name = user.user_metadata?.full_name || 'Tenant';
        const phone = tenantPhone || '';

        const html = generateRazorpayHtml(keyId, verifiedAmount, email, name, phone, orderId);
        setRazorpayHtml(html);
        setShowRealRazorpay(true);
      } catch (err) {
        setPaying(false);
        Alert.alert(
          'Checkout Error',
          `Could not initialize secure payment: ${err.message}`
        );
      }
      return;
    }

    // Direct UPI Flow: block unless property has a verified UPI destination configured by the owner
    if (!isDirectUpiVerified) {
      Alert.alert(
        'Direct UPI Not Configured',
        'Your property owner has not configured a verified UPI destination for this property yet. Please pay using Razorpay Secure Checkout.'
      );
      return;
    }

    setPaying(true);
    const { opened } = await openPhoneUpiApp({
      appId: selectedMethod,
      upiId: upiDestination.upi_id,
      payeeName: upiDestination.payee_name,
      amount: payment.amount,
      transactionNote: `Rent Payment ${payment.id.slice(0, 8)}`,
    });

    if (opened) {
      awaitingUpiReturn.current = true;
    } else {
      setPaying(false);
      const methodObj = PAYMENT_METHODS.find(m => m.id === selectedMethod);
      const label = methodObj ? methodObj.label : 'UPI App';
      Alert.alert(
        'App Not Installed',
        `The ${label} app is not installed on this device. Please install it or use Razorpay Secure Checkout.`
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="error-outline" size={40} color={colors.error} />
        <Text style={styles.errorTitle}>Unable to load payment</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <RateLimitedButton style={styles.retryBtn} onPress={fetchPayment}>
          <Text style={styles.retryText}>Retry</Text>
        </RateLimitedButton>
      </View>
    );
  }

  if (notSetUp) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Payments" showBell />
        <View style={styles.centered}>
          <MaterialIcons name="home" size={48} color={colors.outline} />
          <Text style={styles.noDueTitle}>Account not set up</Text>
          <Text style={styles.noDueSubtitle}>
            Contact your property manager to get linked to your unit.
          </Text>
        </View>
      </View>
    );
  }

  if (noActiveLease) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Payments" showBell />
        <View style={styles.centered}>
          <MaterialIcons name="description" size={48} color={colors.outline} />
          <Text style={styles.noDueTitle}>No active lease</Text>
          <Text style={styles.noDueSubtitle}>
            Rent checkout is enabled only when an active lease is assigned to your unit.
          </Text>
        </View>
      </View>
    );
  }

  if (!payment) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Payments" showBell />
        <View style={styles.centered}>
          <MaterialIcons name="check-circle" size={48} color={colors.tertiaryFixedDim} />
          <Text style={styles.noDueTitle}>No payment due</Text>
          <Text style={styles.noDueSubtitle}>You're all caught up on confirmed rent payments.</Text>
        </View>
      </View>
    );
  }

  const getCtaLabel = () => {
    const amountStr = `₹${Number(payment?.amount ?? 0).toLocaleString('en-IN')}`;
    if (selectedMethod === 'razorpay') {
      return `Pay via Razorpay • ${amountStr}`;
    }
    const methodObj = PAYMENT_METHODS.find(m => m.id === selectedMethod);
    const label = methodObj ? methodObj.label : 'UPI';
    return `Open ${label} • ${amountStr}`;
  };

  const getCtaSubtext = () => {
    if (selectedMethod === 'razorpay') {
      return 'Server-verified settlement via Razorpay. Paid receipt issued only after provider capture.';
    }
    if (!isDirectUpiVerified) {
      return 'Direct UPI is disabled until the property owner configures a verified UPI payee.';
    }
    return `Pays ${upiDestination.payee_name} (${upiDestination.upi_id}). Remains under review until owner confirms bank credit.`;
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Payments" showBell />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Amount */}
        <View style={styles.amountSection}>
          <Text style={styles.amountLabel}>
            {payment.status === 'under_review'
              ? 'OUTSTANDING RENT (UNDER OWNER REVIEW)'
              : payment.status === 'reversed'
              ? 'OUTSTANDING RENT (PREVIOUS PAYMENT REVERSED)'
              : 'TOTAL RENT DUE'}
          </Text>
          <Text style={styles.amountValue}>
            ₹{Number(payment?.amount ?? 0).toLocaleString('en-IN')}
          </Text>
          <Text style={styles.amountCurrency}>Current currency: Indian Rupees (₹)</Text>
          {payment?.due_date ? (
            <View style={styles.dueRow}>
              <StatusChip
                label={
                  payment.status === 'under_review'
                    ? 'Under Review (UTR Submitted)'
                    : payment.status === 'reversed'
                    ? 'Reversed — Payment Due'
                    : daysUntilDue(payment.due_date)
                }
                variant={
                  payment.status === 'overdue' || payment.status === 'reversed'
                    ? 'urgent'
                    : 'pending'
                }
              />
              <Text style={styles.dueDateText}>
                Due {new Date(payment.due_date).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Under Review / Rejected UTR / Reversed Status Banner */}
        {payment.status === 'under_review' && (
          <View style={styles.reviewBanner}>
            <MaterialIcons name="schedule" size={20} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewBannerTitle}>UPI Reference Under Review</Text>
              <Text style={styles.reviewBannerText}>
                Submitted UTR: {payment.utr_number || 'Pending'}. This rent obligation remains outstanding until the property owner verifies bank receipt. You can update the UTR below or pay instantly via Razorpay.
              </Text>
              <TouchableOpacity
                style={styles.updateUtrBtn}
                onPress={() => {
                  setUtrInput(payment.utr_number || '');
                  setShowUtrModal(true);
                }}
              >
                <Text style={styles.updateUtrBtnText}>Update UTR Number</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {payment.status !== 'under_review' && payment.last_rejected_utr && (
          <View style={[styles.reviewBanner, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
            <MaterialIcons name="error-outline" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.reviewBannerTitle, { color: colors.error }]}>
                Previous UPI Reference Rejected ({payment.last_rejected_utr})
              </Text>
              <Text style={[styles.reviewBannerText, { color: colors.onSurfaceVariant }]}>
                {payment.review_notes || 'The property owner could not verify this UTR in their bank statement. Your rent remains due.'}
              </Text>
            </View>
          </View>
        )}

        {payment.status === 'reversed' && (
          <View style={[styles.reviewBanner, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
            <MaterialIcons name="history" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.reviewBannerTitle, { color: colors.error }]}>
                Previous Settlement Reversed
              </Text>
              <Text style={[styles.reviewBannerText, { color: colors.onSurfaceVariant }]}>
                {payment.reversal_reason || 'The prior payment settlement was reversed and remains due.'}
              </Text>
            </View>
          </View>
        )}

        {/* Switch to Water & Electricity Bills Banner */}
        <TouchableOpacity
          style={styles.utilitySwitchBanner}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('UtilityBills', { initialBillType: 'electricity' })}
        >
          <View style={styles.utilitySwitchLeft}>
            <View style={styles.utilitySwitchIcon}>
              <MaterialIcons name="bolt" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.utilitySwitchTitle}>Pay Water & Electricity Bills</Text>
              <Text style={styles.utilitySwitchSub}>
                Direct UPI payment to BESCOM, BWSSB & utility departments
              </Text>
            </View>
          </View>
          <MaterialIcons name="arrow-forward" size={18} color={colors.primary} />
        </TouchableOpacity>

        {/* Payment Methods Section */}
        <View style={styles.methodsSection}>
          <Text style={styles.methodsTitle}>Select Payment Option</Text>

          {/* Section: Standard Gateway */}
          <Text style={styles.sectionHeader}>INSTANT VERIFIED GATEWAY</Text>
          {PAYMENT_METHODS.filter(m => m.type === 'razorpay').map(method => (
            <TouchableOpacity
              key={method.id}
              style={[styles.methodCard, selectedMethod === method.id && styles.methodCardActive]}
              onPress={() => setSelectedMethod(method.id)}
              activeOpacity={0.8}
            >
              <View style={styles.methodIconBg}>
                <MaterialIcons name={method.icon} size={22} color={colors.primary} />
              </View>
              <View style={styles.methodInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.methodLabel}>{method.label}</Text>
                  {method.badge ? (
                    <View style={styles.badgeContainer}>
                      <Text style={styles.badgeText}>{method.badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.methodSub}>{method.sub}</Text>
              </View>
              <View style={[styles.radioOuter, selectedMethod === method.id && styles.radioOuterActive]}>
                {selectedMethod === method.id ? <View style={styles.radioInner} /> : null}
              </View>
            </TouchableOpacity>
          ))}

          {/* Section: Direct UPI */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <Text style={styles.sectionHeader}>DIRECT UPI TRANSFER (OWNER REVIEW)</Text>
            {!isDirectUpiVerified && (
              <Text style={styles.disabledTag}>Not Configured by Owner</Text>
            )}
          </View>
          {isDirectUpiVerified && (
            <Text style={styles.verifiedPayeeNote}>
              Verified Payee: {upiDestination.payee_name} ({upiDestination.upi_id})
            </Text>
          )}
          {PAYMENT_METHODS.filter(m => m.type === 'direct_upi').map(method => {
            const disabled = !isDirectUpiVerified;
            return (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodCard,
                  selectedMethod === method.id && styles.methodCardActive,
                  disabled && { opacity: 0.48 },
                ]}
                onPress={() => {
                  if (disabled) {
                    Alert.alert(
                      'Direct UPI Disabled',
                      'Direct UPI is disabled for this property until the owner configures a verified UPI payee ID. Please use Razorpay Secure Checkout.'
                    );
                    return;
                  }
                  setSelectedMethod(method.id);
                }}
                activeOpacity={0.8}
              >
                <View style={styles.methodIconBg}>
                  <MaterialIcons name={method.icon} size={22} color={colors.primary} />
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodLabel}>{method.label}</Text>
                  <Text style={styles.methodSub}>
                    {disabled ? 'Requires verified owner UPI destination' : method.sub}
                  </Text>
                </View>
                <View style={[styles.radioOuter, selectedMethod === method.id && styles.radioOuterActive]}>
                  {selectedMethod === method.id ? <View style={styles.radioInner} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Security badge */}
        <View style={styles.securitySection}>
          <View style={styles.securityBadge}>
            <MaterialIcons name="verified-user" size={16} color={colors.tertiaryFixedDim} />
            <Text style={styles.securityText}>100% Server-Verified Settlement</Text>
          </View>
          <Text style={styles.securitySubtext}>PCI-DSS Compliant & End-to-End Encrypted</Text>
        </View>

        {/* CTA */}
        <View style={styles.ctaSection}>
          <PrimaryButton
            label={getCtaLabel()}
            onPress={handleConfirmPay}
            loading={paying}
            disabled={paying || (selectedMethod !== 'razorpay' && !isDirectUpiVerified)}
            icon="lock"
          />
          <Text style={styles.mockNote}>
            {getCtaSubtext()}
          </Text>
        </View>
      </ScrollView>

      {/* Real Razorpay WebView Modal */}
      <Modal
        visible={showRealRazorpay}
        animationType="slide"
        onRequestClose={() => {
          setShowRealRazorpay(false);
          reconcileInterruptedCheckout();
        }}
      >
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: '#fff' }}>
          <View style={styles.webViewHeader}>
            <TouchableOpacity
              style={styles.webViewCloseBtn}
              onPress={() => {
                setShowRealRazorpay(false);
                reconcileInterruptedCheckout();
              }}
            >
              <MaterialIcons name="close" size={24} color={colors.onSurface} />
            </TouchableOpacity>
            <Text style={styles.webViewHeaderTitle}>Razorpay Secure Checkout</Text>
            <View style={{ width: 24 }} />
          </View>

          <WebView
            originWhitelist={['https://*', 'upi://*', 'about:*']}
            source={{ html: razorpayHtml, baseUrl: 'https://olswwdunaivwxefelasc.supabase.co' }}
            onMessage={async (event) => {
              try {
                const data = JSON.parse(event.nativeEvent.data);
                if (data.status === 'console_log') {
                  console.log('[WebView Console]', data.message);
                  return;
                }
                if (data.status === 'console_error') {
                  console.log('[WebView Console Error]', data.message);
                  return;
                }
                if (data.status === 'success') {
                  setShowRealRazorpay(false);
                  verifyRazorpayPayment(
                    data.razorpay_order_id,
                    data.razorpay_payment_id,
                    data.razorpay_signature
                  );
                } else if (data.status === 'dismissed') {
                  setShowRealRazorpay(false);
                  await reconcileInterruptedCheckout();
                } else if (data.status === 'failed') {
                  setShowRealRazorpay(false);
                  const currentOrderId = activeOrderIdRef.current;
                  const reason = data.error?.description || 'Payment failed in checkout';
                  const { data: failResult } = await reportRazorpayAttemptFailed({
                    orderId: currentOrderId,
                    reason,
                  });
                  if (failResult?.reconciled && failResult?.status === 'paid') {
                    activeOrderIdRef.current = null;
                    setPaying(false);
                    navigateToConfirmedSuccess({
                      paymentId: failResult.paymentId || payment.id,
                      amount: Number(failResult.amount ?? payment.amount),
                      method: 'razorpay',
                      txnId: failResult.transactionId || currentOrderId,
                      paidAt: failResult.paidAt || new Date().toISOString(),
                    });
                    return;
                  }
                  activeOrderIdRef.current = null;
                  setPaying(false);
                  Alert.alert('Payment Failed', reason);
                } else if (data.status === 'error') {
                  setShowRealRazorpay(false);
                  const currentOrderId = activeOrderIdRef.current;
                  if (currentOrderId) {
                    await reportRazorpayAttemptFailed({
                      orderId: currentOrderId,
                      reason: data.message || 'Razorpay initialization error',
                    });
                  }
                  activeOrderIdRef.current = null;
                  setPaying(false);
                  Alert.alert('Error', data.message || 'An error occurred initializing Razorpay.');
                }
              } catch (e) {
                console.log('[WebView PostMessage (Non-JSON)]', event.nativeEvent.data);
              }
            }}
            style={{ flex: 1 }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            javaScriptCanOpenWindowsAutomatically={true}
            mixedContentMode="always"
            thirdPartyCookiesEnabled={true}
            allowsInlineMediaPlayback={true}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }]}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          />
        </View>
      </Modal>

      {/* UPI UTR Verification Modal */}
      <Modal
        visible={showUtrModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!submittingUtr) setShowUtrModal(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            if (!submittingUtr) setShowUtrModal(false);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalKeyboardAvoiding}
          >
            <Pressable style={styles.rzpContainer} onPress={(e) => e.stopPropagation()}>
              <View style={styles.rzpHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="receipt-long" size={18} color={colors.primary} />
                    <Text style={styles.rzpBrandName}>Submit UPI Reference (UTR)</Text>
                  </View>
                  <Text style={styles.rzpMerchantName}>
                    Your payment will be marked Under Review until the owner confirms receipt
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.rzpCloseBtn}
                  onPress={() => {
                    if (!submittingUtr) setShowUtrModal(false);
                  }}
                >
                  <MaterialIcons name="close" size={20} color="#999" />
                </TouchableOpacity>
              </View>

              <View style={{ paddingVertical: 16 }}>
                <Text style={styles.rzpInputLabel}>UPI Reference / UTR Number</Text>
                <TextInput
                  style={[styles.rzpInput, { marginTop: 6 }]}
                  placeholder="e.g. 423589123456"
                  placeholderTextColor="#999"
                  value={utrInput}
                  onChangeText={setUtrInput}
                  keyboardType="default"
                  autoCapitalize="characters"
                  maxLength={32}
                  autoFocus={true}
                />
                <Text style={{ fontFamily: fonts.interRegular, fontSize: 11, color: '#666', marginTop: 6 }}>
                  Enter the 12-digit UTR from Google Pay, PhonePe, or Paytm. Paid receipts are issued only after the property owner verifies bank credit.
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.rzpPayBtn,
                  (submittingUtr || utrInput.trim().length < 6) && { opacity: 0.5 },
                ]}
                onPress={handleUtrSubmit}
                disabled={submittingUtr || utrInput.trim().length < 6}
              >
                <Text style={styles.rzpPayBtnText}>
                  {submittingUtr ? 'Submitting...' : 'Submit UTR for Owner Review'}
                </Text>
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, padding: 24,
  },

  amountSection: {
    backgroundColor: colors.primaryContainer,
    padding: 24,
    paddingBottom: 28,
  },
  amountLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 10, letterSpacing: 2,
    color: colors.onPrimaryContainer,
    opacity: 0.7,
    textTransform: 'uppercase', marginBottom: 6,
  },
  amountValue: {
    fontFamily: fonts.manropeBold, fontSize: 42,
    color: colors.onPrimaryContainer, marginBottom: 4,
  },
  amountCurrency: {
    fontFamily: fonts.interRegular, fontSize: 12,
    color: colors.onPrimaryContainer,
    opacity: 0.6,
    marginBottom: 12,
  },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  dueDateText: {
    fontFamily: fonts.interRegular, fontSize: 13,
    color: colors.onPrimaryContainer,
    opacity: 0.7,
  },

  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  reviewBannerTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 13.5,
    color: '#92400E',
    marginBottom: 4,
  },
  reviewBannerText: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: '#78350F',
    lineHeight: 17,
  },
  updateUtrBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  updateUtrBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11.5,
    color: '#92400E',
  },

  utilitySwitchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: `${colors.primary}30`,
    gap: 10,
  },
  utilitySwitchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  utilitySwitchIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilitySwitchTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 14,
    color: colors.onSurface,
  },
  utilitySwitchSub: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },

  methodsSection: { padding: 20 },
  methodsTitle: {
    fontFamily: fonts.manropeSemiBold, fontSize: 16,
    color: colors.onSurface, marginBottom: 12,
  },
  sectionHeader: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.outline,
    marginBottom: 8,
    marginTop: 8,
  },
  disabledTag: {
    fontFamily: fonts.interSemiBold,
    fontSize: 10,
    color: colors.error,
  },
  verifiedPayeeNote: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.onSurfaceVariant,
    marginBottom: 8,
  },
  badgeContainer: {
    backgroundColor: '#e6f4ea',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fonts.interMedium,
    fontSize: 10,
    color: '#137333',
  },
  methodCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  methodCardActive: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.primary,
  },
  methodIconBg: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center',
  },
  methodInfo: { flex: 1 },
  methodLabel: { fontFamily: fonts.interSemiBold, fontSize: 14, color: colors.onSurface, marginBottom: 2 },
  methodSub: { fontFamily: fonts.interRegular, fontSize: 12, color: colors.onSurfaceVariant },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: colors.primary },
  radioInner: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.primary,
  },

  securitySection: { alignItems: 'center', paddingBottom: 8 },
  securityBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  securityText: { fontFamily: fonts.interSemiBold, fontSize: 13, color: colors.onSurface },
  securitySubtext: { fontFamily: fonts.interRegular, fontSize: 12, color: colors.onSurfaceVariant },

  ctaSection: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  mockNote: {
    fontFamily: fonts.interRegular, fontSize: 11,
    color: colors.outline, textAlign: 'center',
    lineHeight: 15,
  },

  noDueTitle: { fontFamily: fonts.manropeSemiBold, fontSize: 20, color: colors.onSurface, marginTop: 12, marginBottom: 6 },
  noDueSubtitle: { fontFamily: fonts.interRegular, fontSize: 14, color: colors.onSurfaceVariant, textAlign: 'center' },

  errorTitle: { fontFamily: fonts.manropeSemiBold, fontSize: 18, color: colors.onSurface, marginTop: 12, marginBottom: 6 },
  errorMsg: { fontFamily: fonts.interRegular, fontSize: 13, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20 },
  retryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 28 },
  retryText: { fontFamily: fonts.interSemiBold, fontSize: 14, color: colors.onPrimary },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalKeyboardAvoiding: {
    width: '100%',
  },
  rzpContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  rzpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    paddingBottom: 12,
  },
  rzpBrandName: {
    fontFamily: fonts.interBold,
    fontSize: 16,
    color: '#0d2a4a',
  },
  rzpMerchantName: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  rzpCloseBtn: {
    padding: 6,
  },
  rzpInputLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 10,
    color: '#999',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  rzpInput: {
    borderWidth: 1,
    borderColor: '#dcdcdc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.interRegular,
    color: '#333',
  },
  rzpPayBtn: {
    backgroundColor: '#3399cc',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3399cc',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  rzpPayBtnText: {
    fontFamily: fonts.interBold,
    fontSize: 15,
    color: '#fff',
  },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  webViewCloseBtn: {
    padding: 4,
  },
  webViewHeaderTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 16,
    color: '#0d2a4a',
  },
});

