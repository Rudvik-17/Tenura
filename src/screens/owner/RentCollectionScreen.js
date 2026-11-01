import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import MetricCard from '../../components/MetricCard';
import StatusChip from '../../components/StatusChip';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import {
  exportRentCollectionPDF,
  exportRentCollectionExcel,
} from '../../lib/rentCollectionExport';
import {
  reviewUpiPayment,
  configurePropertyUpiDestination,
  refundPayment,
  reversePayment,
  correctPaymentRecord,
} from '../../services/razorpayService';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'under_review', label: 'UTR Review' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'refunded', label: 'Refunds / Reversals' },
];

const statusVariant = (status, verificationStatus) => {
  if (verificationStatus === 'legacy_unverified') return 'pending';
  if (status === 'paid') return 'active';
  if (status === 'overdue' || status === 'reversed') return 'urgent';
  return 'pending';
};

const statusLabel = (status, verificationStatus) => {
  if (verificationStatus === 'legacy_unverified') return 'legacy unverified';
  if (status === 'under_review') return 'under review';
  if (status === 'partially_refunded') return 'partial refund';
  return status;
};

export default function RentCollectionScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [payments, setPayments] = useState([]);
  const [properties, setProperties] = useState([]);
  const [ownerName, setOwnerName] = useState('Property Owner');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(null); // 'pdf' | 'excel' | null
  const [processingId, setProcessingId] = useState(null);

  // Adjustment / Refund / Reversal / Correction Modal state
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [adjustAction, setAdjustAction] = useState('refund'); // 'refund' | 'reverse' | 'correct'
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustExternalRef, setAdjustExternalRef] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Property Direct UPI Destination Configuration Modal state
  const [showUpiConfigModal, setShowUpiConfigModal] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  const [upiIdInput, setUpiIdInput] = useState('');
  const [upiPayeeInput, setUpiPayeeInput] = useState('');
  const [upiConfigSaving, setUpiConfigSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setError(null);

    const [paymentsRes, profileRes, propsRes] = await Promise.all([
      supabase
        .from('payments')
        .select('*, tenants!inner(owner_id, full_name, unit_number, property_id, properties(id, name, upi_id, upi_payee_name, upi_verified))')
        .eq('tenants.owner_id', user.id)
        .order('due_date', { ascending: false }),
      supabase
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('properties')
        .select('id, name, upi_id, upi_payee_name, upi_verified')
        .eq('owner_id', user.id)
        .order('name', { ascending: true }),
    ]);

    if (profileRes.data?.full_name) {
      setOwnerName(profileRes.data.full_name);
    }

    if (propsRes.data) {
      setProperties(propsRes.data);
      if (!selectedPropertyId && propsRes.data[0]) {
        const firstProp = propsRes.data[0];
        setSelectedPropertyId(firstProp.id);
        setUpiIdInput(firstProp.upi_id ?? '');
        setUpiPayeeInput(firstProp.upi_payee_name ?? '');
      }
    }

    if (paymentsRes.error) {
      setError(paymentsRes.error.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setPayments(paymentsRes.data ?? []);
    setLoading(false);
    setRefreshing(false);
  }, [user?.id, selectedPropertyId]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  if (!user) return null;

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const now = new Date();
  const currentMonthName = now.toLocaleString('en-IN', { month: 'long' });
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const mtdCollected = payments
    .filter(p => {
      if (p.status !== 'paid' && p.status !== 'partially_refunded') return false;
      const d = p.paid_at ? new Date(p.paid_at) : (p.due_date ? new Date(p.due_date) : null);
      return d && d >= startOfMonth && d <= endOfMonth;
    })
    .reduce((s, p) => s + Math.max(0, Number(p.amount || 0) - Number(p.refunded_amount || 0)), 0);

  const totalPending = payments
    .filter(p => ['pending', 'overdue', 'under_review', 'reversed'].includes(p.status))
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  const paidCount = payments.filter(p => p.status === 'paid' || p.status === 'partially_refunded').length;
  const collectionRate = payments.length > 0
    ? Math.round((paidCount / payments.length) * 100)
    : 0;

  const matchFilter = (p, key) => {
    if (key === 'all') return true;
    if (key === 'paid') return p.status === 'paid' || p.status === 'partially_refunded';
    if (key === 'refunded') return ['partially_refunded', 'refunded', 'reversed'].includes(p.status);
    return p.status === key;
  };

  const filtered = payments.filter(p => matchFilter(p, filter));

  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const formatDate = (d) =>
    d
      ? new Date(d).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : '—';

  const handleUpiReview = (payment, decision) => {
    const isApprove = decision === 'approve';
    Alert.alert(
      isApprove ? 'Approve UPI Reference' : 'Reject UPI Reference',
      isApprove
        ? `Confirm that you received ₹${Number(payment.amount).toLocaleString('en-IN')} in your bank account for UTR ${payment.utr_number || '—'}? This will settle the rent obligation and issue a paid receipt.`
        : `Reject UTR ${payment.utr_number || '—'}? The obligation will return to pending/overdue status.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isApprove ? 'Confirm Settlement' : 'Reject UTR',
          style: isApprove ? 'default' : 'destructive',
          onPress: async () => {
            setProcessingId(payment.id);
            try {
              const { error: revErr } = await reviewUpiPayment({
                paymentId: payment.id,
                decision,
                reason: isApprove
                  ? `Owner verified UTR ${payment.utr_number}`
                  : `Owner rejected unverified UTR ${payment.utr_number}`,
              });
              if (revErr) throw revErr;
              await fetchData();
            } catch (err) {
              Alert.alert('Review Error', err?.message || 'Could not process UPI review.');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const openAdjustmentModal = (payment) => {
    const isSettled = payment.status === 'paid' || payment.status === 'partially_refunded';
    const remainingRefundable = Math.max(0, Number(payment.amount || 0) - Number(payment.refunded_amount || 0));
    setSelectedPayment(payment);
    setAdjustAction(isSettled ? 'refund' : 'correct');
    setAdjustAmount(String(isSettled ? remainingRefundable : payment.amount));
    setAdjustReason('');
    setAdjustExternalRef('');
  };

  const handleSaveAdjustment = async () => {
    if (!selectedPayment) return;
    if (!adjustReason.trim()) {
      Alert.alert('Reason Required', 'Please provide an audit reason for this financial adjustment.');
      return;
    }

    setAdjustSaving(true);
    try {
      if (adjustAction === 'refund') {
        const amt = Number(adjustAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          throw new Error('Enter a valid refund amount greater than ₹0.');
        }
        const { error: refErr } = await refundPayment({
          paymentId: selectedPayment.id,
          refundAmount: amt,
          reason: adjustReason.trim(),
          refundReference: adjustExternalRef.trim() || null,
        });
        if (refErr) throw refErr;
      } else if (adjustAction === 'reverse') {
        const { error: revErr } = await reversePayment({
          paymentId: selectedPayment.id,
          reason: adjustReason.trim(),
          reversalReference: adjustExternalRef.trim() || null,
        });
        if (revErr) throw revErr;
      } else if (adjustAction === 'correct') {
        const amt = Number(adjustAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          throw new Error('Enter a valid corrected obligation amount greater than ₹0.');
        }
        const { error: corrErr } = await correctPaymentRecord({
          paymentId: selectedPayment.id,
          newAmount: amt,
          reason: adjustReason.trim(),
        });
        if (corrErr) throw corrErr;
      }
      setSelectedPayment(null);
      await fetchData();
    } catch (err) {
      Alert.alert('Adjustment Failed', err?.message || 'Unable to apply financial adjustment.');
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleSelectPropertyForUpi = (prop) => {
    setSelectedPropertyId(prop.id);
    setUpiIdInput(prop.upi_id ?? '');
    setUpiPayeeInput(prop.upi_payee_name ?? '');
  };

  const handleSaveUpiConfig = async (verified) => {
    if (!selectedPropertyId) return;
    if (verified && (!upiIdInput.trim() || !upiIdInput.includes('@') || !upiPayeeInput.trim())) {
      Alert.alert('Missing Details', 'Enter a valid VPA (e.g. name@bank) and payee name to verify Direct UPI.');
      return;
    }
    setUpiConfigSaving(true);
    try {
      const { error: upiErr } = await configurePropertyUpiDestination({
        propertyId: selectedPropertyId,
        upiId: upiIdInput.trim(),
        payeeName: upiPayeeInput.trim() || ownerName,
        verified,
      });
      if (upiErr) throw upiErr;
      setShowUpiConfigModal(false);
      await fetchData();
    } catch (err) {
      Alert.alert('UPI Setup Error', err?.message || 'Could not update property UPI destination.');
    } finally {
      setUpiConfigSaving(false);
    }
  };

  const handleExportPDF = async () => {
    const recordsToExport = filter === 'all' ? payments : filtered;
    if (!recordsToExport || recordsToExport.length === 0) {
      Alert.alert('No Records', 'There are no payment records available to export.');
      return;
    }
    setExporting('pdf');
    try {
      await exportRentCollectionPDF({
        payments: recordsToExport,
        metrics: { mtdCollected, totalPending, collectionRate },
        ownerName,
      });
    } catch (err) {
      if (err.message && !err.message.includes('canceled') && !err.message.includes('cancelled')) {
        Alert.alert('Export Failed', err.message || 'Unable to generate PDF report.');
      }
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async () => {
    const recordsToExport = filter === 'all' ? payments : filtered;
    if (!recordsToExport || recordsToExport.length === 0) {
      Alert.alert('No Records', 'There are no payment records available to export.');
      return;
    }
    setExporting('excel');
    try {
      await exportRentCollectionExcel({
        payments: recordsToExport,
        metrics: { mtdCollected, totalPending, collectionRate },
        ownerName,
      });
    } catch (err) {
      if (err.message && !err.message.includes('canceled') && !err.message.includes('cancelled')) {
        Alert.alert('Export Failed', err.message || 'Unable to generate Excel file.');
      }
    } finally {
      setExporting(null);
    }
  };

  const handleExportPrompt = () => {
    Alert.alert(
      'Export Rent Collection',
      'Select format to export or share:',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '📄 Export as PDF', onPress: handleExportPDF },
        { text: '📊 Export as Excel (CSV)', onPress: handleExportExcel },
      ],
      { cancelable: true }
    );
  };

  const renderPayment = ({ item }) => {
    const isUnderReview = item.status === 'under_review';
    const isSettled = item.status === 'paid' || item.status === 'partially_refunded';
    const netAmount = Math.max(0, Number(item.amount || 0) - Number(item.refunded_amount || 0));

    return (
      <View style={styles.paymentCard}>
        <View style={styles.paymentRowTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {item.tenants?.full_name?.[0] ?? '?'}
            </Text>
          </View>
          <View style={styles.paymentInfo}>
            <Text style={styles.tenantName}>{item.tenants?.full_name ?? '—'}</Text>
            <Text style={styles.paymentMeta}>
              Unit {item.tenants?.unit_number} · {item.tenants?.properties?.name}
            </Text>
            <Text style={styles.paymentDue}>
              Due {formatDate(item.due_date)}
              {item.paid_at ? ` · Paid ${formatDate(item.paid_at)}` : ''}
            </Text>
            {item.utr_number ? (
              <Text style={styles.utrMetaText}>UTR: {item.utr_number}</Text>
            ) : null}
            {Number(item.refunded_amount || 0) > 0 ? (
              <Text style={styles.refundMetaText}>
                Refunded: {fmt(item.refunded_amount)} · Net: {fmt(netAmount)}
              </Text>
            ) : null}
          </View>
          <View style={styles.paymentRight}>
            <Text style={styles.paymentAmount}>{fmt(item.amount)}</Text>
            <StatusChip
              label={statusLabel(item.status, item.verification_status)}
              variant={statusVariant(item.status, item.verification_status)}
            />
          </View>
        </View>

        {isUnderReview ? (
          <View style={styles.cardActionRow}>
            <RateLimitedButton
              style={[styles.cardActionBtn, styles.approveActionBtn]}
              onPress={() => handleUpiReview(item, 'approve')}
              disabled={processingId === item.id}
            >
              {processingId === item.id ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="check-circle" size={15} color="#FFFFFF" />
                  <Text style={styles.approveActionText}>Approve UTR</Text>
                </>
              )}
            </RateLimitedButton>
            <RateLimitedButton
              style={[styles.cardActionBtn, styles.rejectActionBtn]}
              onPress={() => handleUpiReview(item, 'reject')}
              disabled={processingId === item.id}
            >
              <MaterialIcons name="cancel" size={15} color={colors.error} />
              <Text style={styles.rejectActionText}>Reject UTR</Text>
            </RateLimitedButton>
          </View>
        ) : (
          <View style={styles.cardActionRow}>
            <TouchableOpacity
              style={[styles.cardActionBtn, styles.adjustActionBtn]}
              onPress={() => openAdjustmentModal(item)}
            >
              <MaterialIcons name="tune" size={14} color={colors.primary} />
              <Text style={styles.adjustActionText}>
                {isSettled ? 'Refund / Reverse / Correct' : 'Correct Obligation'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader
          title="Rent Collection"
          showBack
          onBack={() => navigation.goBack()}
          showBell
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <ScreenHeader
          title="Rent Collection"
          showBack
          onBack={() => navigation.goBack()}
          showBell
        />
        <View style={styles.centered}>
          <MaterialIcons name="error-outline" size={40} color={colors.error} />
          <Text style={styles.errorTitle}>Unable to load payments</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <RateLimitedButton style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryText}>Retry</Text>
          </RateLimitedButton>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Rent Collection"
        showBack
        onBack={() => navigation.goBack()}
        rightElement={
          <TouchableOpacity
            style={styles.headerExportBtn}
            onPress={handleExportPrompt}
            disabled={exporting !== null}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialIcons name="ios-share" size={22} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        }
      />
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderPayment}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            <View style={styles.exportBanner}>
              <View style={styles.exportHeaderLeft}>
                <MaterialIcons name="ios-share" size={16} color={colors.primary} />
                <Text style={styles.exportBannerTitle}>Export Statement</Text>
                <View style={styles.exportCountBadge}>
                  <Text style={styles.exportCountText}>
                    {filter === 'all' ? payments.length : filtered.length}
                  </Text>
                </View>
              </View>

              <View style={styles.exportButtonsRow}>
                {properties.length > 0 ? (
                  <TouchableOpacity
                    style={styles.exportPill}
                    onPress={() => setShowUpiConfigModal(true)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="verified-user" size={15} color={colors.primary} />
                    <Text style={styles.exportPillText}>UPI Payee</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.exportPill}
                  onPress={handleExportPDF}
                  disabled={exporting !== null}
                  activeOpacity={0.7}
                >
                  {exporting === 'pdf' ? (
                    <ActivityIndicator size="small" color="#DC2626" />
                  ) : (
                    <>
                      <MaterialIcons name="picture-as-pdf" size={15} color="#DC2626" />
                      <Text style={styles.exportPillText}>PDF</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.exportPill}
                  onPress={handleExportExcel}
                  disabled={exporting !== null}
                  activeOpacity={0.7}
                >
                  {exporting === 'excel' ? (
                    <ActivityIndicator size="small" color="#16A34A" />
                  ) : (
                    <>
                      <MaterialIcons name="grid-on" size={15} color="#16A34A" />
                      <Text style={styles.exportPillText}>Excel</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricsRow}>
                <MetricCard
                  icon="payments"
                  value={fmt(mtdCollected)}
                  label={`${currentMonthName} Net Collection`}
                  trendUp={mtdCollected > 0}
                />
                <View style={{ width: 12 }} />
                <MetricCard
                  icon="schedule"
                  value={fmt(totalPending)}
                  label="Outstanding"
                  trendUp={false}
                />
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterScroll}
            >
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[styles.filterLabel, filter === f.key && styles.filterLabelActive]}>
                    {f.label}
                    {' '}
                    ({payments.filter(p => matchFilter(p, f.key)).length})
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="payments" size={40} color={colors.outline} />
            <Text style={styles.emptyTitle}>No payment records yet</Text>
            <Text style={styles.emptySubtitle}>
              {filter === 'all'
                ? 'Payment records will appear here once tenants are billed.'
                : `No ${filter.replace('_', ' ')} payments found.`}
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Financial Adjustment / Refund / Reversal / Correction Modal */}
      <Modal
        visible={Boolean(selectedPayment)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPayment(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Financial Adjustment</Text>
              <TouchableOpacity onPress={() => setSelectedPayment(null)}>
                <MaterialIcons name="close" size={22} color={colors.onSurface} />
              </TouchableOpacity>
            </View>

            {selectedPayment ? (
              <>
                <Text style={styles.modalSubtitle}>
                  {selectedPayment.tenants?.full_name} · Unit {selectedPayment.tenants?.unit_number} ·{' '}
                  {fmt(selectedPayment.amount)}
                </Text>

                <View style={styles.actionTabRow}>
                  {(selectedPayment.status === 'paid' || selectedPayment.status === 'partially_refunded') ? (
                    <>
                      <TouchableOpacity
                        style={[styles.actionTabBtn, adjustAction === 'refund' && styles.actionTabBtnActive]}
                        onPress={() => {
                          const rem = Math.max(0, Number(selectedPayment.amount || 0) - Number(selectedPayment.refunded_amount || 0));
                          setAdjustAction('refund');
                          setAdjustAmount(String(rem));
                        }}
                      >
                        <Text style={[styles.actionTabText, adjustAction === 'refund' && styles.actionTabTextActive]}>
                          Refund
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionTabBtn, adjustAction === 'reverse' && styles.actionTabBtnActive]}
                        onPress={() => setAdjustAction('reverse')}
                      >
                        <Text style={[styles.actionTabText, adjustAction === 'reverse' && styles.actionTabTextActive]}>
                          Reverse
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.actionTabBtn, adjustAction === 'correct' && styles.actionTabBtnActive]}
                    onPress={() => {
                      setAdjustAction('correct');
                      setAdjustAmount(String(selectedPayment.amount || ''));
                    }}
                  >
                    <Text style={[styles.actionTabText, adjustAction === 'correct' && styles.actionTabTextActive]}>
                      Correct Amount
                    </Text>
                  </TouchableOpacity>
                </View>

                {adjustAction !== 'reverse' ? (
                  <View style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>
                      {adjustAction === 'refund' ? 'Refund Amount (₹)' : 'Corrected Rent Amount (₹)'}
                    </Text>
                    <TextInput
                      style={styles.modalInput}
                      value={adjustAmount}
                      onChangeText={setAdjustAmount}
                      keyboardType="numeric"
                      placeholder="e.g. 5000"
                      placeholderTextColor={colors.outline}
                    />
                  </View>
                ) : null}

                {adjustAction === 'refund' ? (
                  <View style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>External Refund ID (Optional)</Text>
                    <TextInput
                      style={styles.modalInput}
                      value={adjustExternalRef}
                      onChangeText={setAdjustExternalRef}
                      placeholder="e.g. rfnd_..."
                      placeholderTextColor={colors.outline}
                      autoCapitalize="none"
                    />
                  </View>
                ) : null}

                <View style={styles.modalField}>
                  <Text style={styles.modalFieldLabel}>Audit Reason (Required)</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={adjustReason}
                    onChangeText={setAdjustReason}
                    placeholder="Reason for adjustment (preserved in ledger)"
                    placeholderTextColor={colors.outline}
                  />
                </View>

                <RateLimitedButton
                  style={styles.modalPrimaryBtn}
                  onPress={handleSaveAdjustment}
                  disabled={adjustSaving}
                >
                  {adjustSaving ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.modalPrimaryBtnText}>
                      {adjustAction === 'refund'
                        ? 'Record Refund & Offset Ledger'
                        : adjustAction === 'reverse'
                          ? 'Reverse Settlement & Reopen Obligation'
                          : 'Apply Amount Correction'}
                    </Text>
                  )}
                </RateLimitedButton>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Property Direct UPI Payee Verification Modal */}
      <Modal
        visible={showUpiConfigModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUpiConfigModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Direct UPI Payee Setup</Text>
              <TouchableOpacity onPress={() => setShowUpiConfigModal(false)}>
                <MaterialIcons name="close" size={22} color={colors.onSurface} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Direct UPI is disabled for tenants until you configure and verify a real receiving VPA for the property.
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {properties.map(prop => (
                <TouchableOpacity
                  key={prop.id}
                  style={[
                    styles.filterChip,
                    selectedPropertyId === prop.id && styles.filterChipActive,
                    { marginRight: 8 },
                  ]}
                  onPress={() => handleSelectPropertyForUpi(prop)}
                >
                  <Text style={[styles.filterLabel, selectedPropertyId === prop.id && styles.filterLabelActive]}>
                    {prop.name} {prop.upi_verified ? '✓' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Owner Receiving UPI ID (VPA)</Text>
              <TextInput
                style={styles.modalInput}
                value={upiIdInput}
                onChangeText={setUpiIdInput}
                placeholder="e.g. landlord@okicici"
                placeholderTextColor={colors.outline}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Verified Payee Name</Text>
              <TextInput
                style={styles.modalInput}
                value={upiPayeeInput}
                onChangeText={setUpiPayeeInput}
                placeholder="Registered bank account name"
                placeholderTextColor={colors.outline}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <RateLimitedButton
                style={[styles.modalPrimaryBtn, { flex: 1 }]}
                onPress={() => handleSaveUpiConfig(true)}
                disabled={upiConfigSaving}
              >
                {upiConfigSaving ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.modalPrimaryBtnText}>Verify & Enable</Text>
                )}
              </RateLimitedButton>
              <RateLimitedButton
                style={[styles.modalPrimaryBtn, { flex: 1, backgroundColor: colors.errorContainer }]}
                onPress={() => handleSaveUpiConfig(false)}
                disabled={upiConfigSaving}
              >
                <Text style={[styles.modalPrimaryBtnText, { color: colors.error }]}>Disable UPI</Text>
              </RateLimitedButton>
            </View>
          </View>
        </View>
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

  headerExportBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  exportBanner: {
    backgroundColor: colors.surfaceContainerLowest,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant || 'rgba(0,0,0,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exportBannerTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 13,
    color: colors.onSurface,
  },
  exportCountBadge: {
    backgroundColor: colors.surfaceContainerHighest,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 9999,
  },
  exportCountText: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
  exportButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outlineVariant || 'rgba(0,0,0,0.08)',
  },
  exportPillText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.onSurface,
  },

  metricsGrid: {
    padding: 16,
    backgroundColor: colors.surfaceContainerLow,
  },
  metricsRow: { flexDirection: 'row' },

  filterScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 9999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  filterChipActive: { backgroundColor: colors.primary },
  filterLabel: {
    fontFamily: fonts.interMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  filterLabelActive: { color: colors.onPrimary },

  paymentCard: {
    backgroundColor: colors.surfaceContainerLowest,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    padding: 14,
  },
  paymentRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.manropeBold,
    fontSize: 18,
    color: colors.onPrimaryContainer,
  },
  paymentInfo: { flex: 1 },
  tenantName: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 2,
  },
  paymentMeta: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginBottom: 2,
  },
  paymentDue: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.outline,
  },
  utrMetaText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    color: colors.primary,
    marginTop: 3,
  },
  refundMetaText: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.error,
    marginTop: 2,
  },
  paymentRight: { alignItems: 'flex-end', gap: 6 },
  paymentAmount: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 14,
    color: colors.onSurface,
  },
  cardActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  approveActionBtn: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  approveActionText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  rejectActionBtn: {
    flex: 1,
    backgroundColor: colors.errorContainer,
  },
  rejectActionText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.error,
  },
  adjustActionBtn: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  adjustActionText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    color: colors.primary,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 18,
    color: colors.onSurface,
  },
  modalSubtitle: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginBottom: 14,
    lineHeight: 18,
  },
  actionTabRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  actionTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
  },
  actionTabBtnActive: {
    backgroundColor: colors.primary,
  },
  actionTabText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  actionTabTextActive: {
    color: colors.onPrimary,
  },
  modalField: {
    marginBottom: 12,
  },
  modalFieldLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  modalInput: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.interRegular,
    fontSize: 14,
    color: colors.onSurface,
  },
  modalPrimaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  modalPrimaryBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 13,
    color: colors.onPrimary,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 18,
    color: colors.onSurface,
    marginTop: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.interRegular,
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },

  errorTitle: { fontFamily: fonts.manropeSemiBold, fontSize: 18, color: colors.onSurface, marginTop: 12, marginBottom: 6 },
  errorMsg: { fontFamily: fonts.interRegular, fontSize: 13, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20 },
  retryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 28 },
  retryText: { fontFamily: fonts.interSemiBold, fontSize: 14, color: colors.onPrimary },
});
