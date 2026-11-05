import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import { getTenantDeposit, saveTenantDeposit, toAsciiDigits } from '../../lib/securityDeposit';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'collected', label: 'Collected' },
  { key: 'pending', label: 'Pending' },
  { key: 'exiting', label: 'Exiting / Settle' },
];

const PRESET_DEDUCTIONS = [
  { title: 'Painting & touch-up', defaultAmount: 4000 },
  { title: 'Deep cleaning', defaultAmount: 1500 },
  { title: 'Wall & nail repairs', defaultAmount: 1000 },
  { title: 'Plumbing & fixtures', defaultAmount: 1200 },
  { title: 'Unpaid utility dues', defaultAmount: 2000 },
];

export default function SecurityDepositScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tenants, setTenants] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Manage Modal State
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [formDepositAmount, setFormDepositAmount] = useState('');
  const [formStatus, setFormStatus] = useState('collected'); // 'collected' | 'pending' | 'refunded'
  const [formDeductions, setFormDeductions] = useState([]);
  const [newDeductionTitle, setNewDeductionTitle] = useState('');
  const [newDeductionAmount, setNewDeductionAmount] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setError(null);

    // Fetch tenants with their lease info
    const { data: tenantRows, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, full_name, unit_number, status, property_id, properties(name)')
      .eq('owner_id', user.id)
      .order('full_name', { ascending: true });

    if (tenantErr) {
      setError(tenantErr.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const tenantList = tenantRows ?? [];
    const tenantIds = tenantList.map(t => t.id);
    let leases = [];

    if (tenantIds.length > 0) {
      const { data: leaseRows } = await supabase
        .from('leases')
        .select('id, tenant_id, monthly_rent, start_date, end_date, status')
        .in('tenant_id', tenantIds)
        .order('start_date', { ascending: false });

      leases = leaseRows ?? [];
    }

    // Enrich each tenant with their custom security deposit data
    const enriched = await Promise.all(
      tenantList.map(async (t) => {
        const lease = leases.find(l => l.tenant_id === t.id);
        const monthlyRent = lease?.monthly_rent ?? 0;
        const depositInfo = await getTenantDeposit(
          t.id,
          t.full_name,
          monthlyRent,
          t.security_deposit
        );

        return {
          ...t,
          lease,
          propertyName: t.properties?.name ?? 'Property',
          deposit: depositInfo,
        };
      })
    );

    setTenants(enriched);
    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData();
    }, [fetchData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  // Summary Metrics
  const totalCollected = tenants
    .filter(t => t.deposit?.status === 'collected')
    .reduce((sum, t) => sum + (Number(t.deposit?.amount) || 0), 0);

  const totalPending = tenants
    .filter(t => t.deposit?.status === 'pending')
    .reduce((sum, t) => sum + (Number(t.deposit?.amount) || 0), 0);

  const exitingTenants = tenants.filter(t => t.status === 'exiting');
  const totalExitingRefund = exitingTenants.reduce(
    (sum, t) => sum + (Number(t.deposit?.netRefund) || 0),
    0
  );

  // Filtered List
  const filteredTenants = tenants.filter(t => {
    if (filter === 'collected') return t.deposit?.status === 'collected';
    if (filter === 'pending') return t.deposit?.status === 'pending';
    if (filter === 'exiting') return t.status === 'exiting';
    return true;
  });

  // Open Modal for Editing Deposit
  const handleOpenManageModal = (tenantItem) => {
    setSelectedTenant(tenantItem);
    setFormDepositAmount(String(tenantItem.deposit?.amount || ''));
    setFormStatus(tenantItem.deposit?.status || 'collected');
    setFormDeductions(tenantItem.deposit?.deductions ? [...tenantItem.deposit.deductions] : []);
    setFormNotes(tenantItem.deposit?.notes || '');
    setNewDeductionTitle('');
    setNewDeductionAmount('');
    setModalVisible(true);
  };

  // Add new deduction row
  const handleAddDeduction = (titleToAdd = null, amountToAdd = null) => {
    const title = (titleToAdd || newDeductionTitle).trim();
    const amountNum = Number(amountToAdd !== null ? amountToAdd : newDeductionAmount);

    if (!title) {
      Alert.alert('Missing Detail', 'Please enter a description for the deduction (e.g. Painting, Repairs).');
      return;
    }
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount to deduct.');
      return;
    }

    const newItem = {
      id: `ded-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      title,
      amount: amountNum,
    };

    setFormDeductions(prev => [...prev, newItem]);
    if (!titleToAdd) {
      setNewDeductionTitle('');
      setNewDeductionAmount('');
    }
  };

  const handleRemoveDeduction = (id) => {
    setFormDeductions(prev => prev.filter(d => d.id !== id));
  };

  // Save Modal Changes
  const handleSaveDeposit = async () => {
    if (!selectedTenant) return;
    const cleanAmount = toAsciiDigits(formDepositAmount).trim();
    const amountNum = Number(cleanAmount);
    if (!cleanAmount || isNaN(amountNum) || amountNum < 0) {
      Alert.alert('Invalid Price', 'Please enter a valid security deposit price.');
      return;
    }

    setSaving(true);
    try {
      await saveTenantDeposit(selectedTenant.id, selectedTenant.full_name, {
        amount: amountNum,
        status: formStatus,
        deductions: formDeductions,
        notes: formNotes,
      });

      setModalVisible(false);
      Alert.alert(
        'Security Deposit Updated',
        `Deposit details for ${selectedTenant.full_name} have been updated successfully.`
      );
      fetchData();
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not update security deposit.');
    } finally {
      setSaving(false);
    }
  };

  // Modal Calculation
  const modalDepositNum = Number(toAsciiDigits(formDepositAmount)) || 0;
  const modalTotalDeductions = formDeductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const modalNetRefund = Math.max(0, modalDepositNum - modalTotalDeductions);

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Security Deposit" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Security Deposit" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="error-outline" size={40} color={colors.error} />
          <Text style={styles.errorTitle}>Unable to load deposits</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <RateLimitedButton style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryText}>Retry</Text>
          </RateLimitedButton>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }) => {
    const rent = item.lease?.monthly_rent ?? 0;
    const deposit = item.deposit;
    const isActive = item.status === 'active';
    const isExiting = item.status === 'exiting';
    const hasDeductions = deposit?.deductions && deposit.deductions.length > 0;

    let depositStatusColor = colors.tertiaryFixedDim;
    let depositStatusLabel = 'Collected Upfront';
    let depositStatusIcon = 'check-circle';

    if (deposit.status === 'pending') {
      depositStatusColor = colors.secondary;
      depositStatusLabel = 'Pending Collection';
      depositStatusIcon = 'schedule';
    } else if (deposit.status === 'refunded') {
      depositStatusColor = colors.primary;
      depositStatusLabel = 'Refunded / Settled';
      depositStatusIcon = 'task-alt';
    }

    return (
      <View style={styles.card}>
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardLeft}>
            <View style={[styles.avatar, {
              backgroundColor: isActive ? `${colors.tertiaryFixedDim}20` : (isExiting ? `${colors.error}15` : `${colors.outline}20`),
            }]}>
              <MaterialIcons
                name="person"
                size={22}
                color={isActive ? colors.tertiaryFixedDim : (isExiting ? colors.error : colors.outline)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.tenantName}>{item.full_name}</Text>
                {isExiting && (
                  <View style={[styles.miniBadge, { backgroundColor: `${colors.error}15` }]}>
                    <Text style={[styles.miniBadgeText, { color: colors.error }]}>Leaving / Exiting</Text>
                  </View>
                )}
              </View>
              <Text style={styles.tenantInfo}>
                Unit {item.unit_number} · {item.propertyName}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${depositStatusColor}15` }]}>
            <MaterialIcons name={depositStatusIcon} size={12} color={depositStatusColor} style={{ marginRight: 4 }} />
            <Text style={[styles.statusText, { color: depositStatusColor }]}>
              {depositStatusLabel}
            </Text>
          </View>
        </View>

        <View style={styles.cardDivider} />

        {/* Deposit Financial Details */}
        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Monthly Rent</Text>
            <Text style={styles.detailValue}>{rent > 0 ? fmt(rent) : '—'}</Text>
          </View>

          <View style={styles.detailRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.detailLabel}>Security Deposit</Text>
              <View style={styles.ownerBadge}>
                <Text style={styles.ownerBadgeText}>Owner Set</Text>
              </View>
            </View>
            <Text style={[styles.detailValue, styles.depositValueHighlight]}>
              {fmt(deposit.amount)}
            </Text>
          </View>

          <View style={styles.depositContextRow}>
            <MaterialIcons
              name={deposit.status === 'collected' ? 'verified' : 'info'}
              size={13}
              color={deposit.status === 'collected' ? colors.tertiaryFixedDim : colors.outline}
            />
            <Text style={styles.depositContextText}>
              {deposit.status === 'collected'
                ? 'Advance taken before key handover · Held securely'
                : (deposit.status === 'refunded'
                  ? 'Deposit refunded upon vacating'
                  : 'Pending advance payment prior to move-in')}
            </Text>
          </View>

          {/* Deductions Breakdown (Paint, Cleaning, Damage Cuts) */}
          {hasDeductions && (
            <View style={styles.deductionsBox}>
              <View style={styles.deductionsHeader}>
                <Text style={styles.deductionsTitle}>Move-Out Deductions</Text>
                <Text style={styles.deductionsTotal}>-{fmt(deposit.totalDeductions)}</Text>
              </View>
              {deposit.deductions.map((d) => (
                <View key={d.id} style={styles.deductionRowItem}>
                  <Text style={styles.deductionItemTitle}>• {d.title}</Text>
                  <Text style={styles.deductionItemAmount}>-{fmt(d.amount)}</Text>
                </View>
              ))}
              <View style={styles.netRefundDivider} />
              <View style={styles.netRefundRow}>
                <Text style={styles.netRefundLabel}>Net Refund to Tenant</Text>
                <Text style={styles.netRefundValue}>{fmt(deposit.netRefund)}</Text>
              </View>
            </View>
          )}

          {/* Action Button Row */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.manageBtn}
              activeOpacity={0.7}
              onPress={() => handleOpenManageModal(item)}
            >
              <MaterialIcons name="tune" size={16} color={colors.primary} />
              <Text style={styles.manageBtnText}>
                {isExiting ? 'Settle Deductions & Refund' : 'Set Price / Manage'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Security Deposit" showBack onBack={() => navigation.goBack()} />

      {/* Summary Header */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{fmt(totalCollected)}</Text>
            <Text style={styles.summaryLabel}>Total Advance Held</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.secondary }]}>
              {fmt(totalPending)}
            </Text>
            <Text style={styles.summaryLabel}>Pending Advance</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: totalExitingRefund > 0 ? colors.error : colors.onPrimaryContainer }]}>
              {fmt(totalExitingRefund)}
            </Text>
            <Text style={styles.summaryLabel}>Leaving Refunds</Text>
          </View>
        </View>
      </View>

      {/* Explanation Banner */}
      <View style={styles.infoBanner}>
        <MaterialIcons name="shield" size={16} color={colors.primary} style={{ marginTop: 1 }} />
        <Text style={styles.infoBannerText}>
          Security deposit is set by you and paid before giving the house. When tenants leave, charges for paint or repairs can be deducted before refunding.
        </Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterScroll}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredTenants.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="account-balance" size={48} color={colors.outline} />
          <Text style={styles.emptyTitle}>No matching deposits</Text>
          <Text style={styles.emptySubtitle}>
            {filter === 'all'
              ? 'Add tenants to track and manage their advance security deposits.'
              : `No tenants found under the "${filter}" filter.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredTenants}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}

      {/* ── Manage Security Deposit Modal ─────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Manage Security Deposit</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedTenant?.full_name} · Unit {selectedTenant?.unit_number}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={24} color={colors.onSurface} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
              {/* 1. Deposit Price */}
              <View style={styles.modalSection}>
                <Text style={styles.inputSectionLabel}>DEPOSIT AMOUNT</Text>
                <Text style={styles.inputSectionDesc}>
                  Set any price you desire. This amount is visible to the tenant.
                </Text>
                <View style={styles.amountInputRow}>
                  <View style={styles.currencyPrefix}>
                    <Text style={styles.currencyPrefixText}>₹</Text>
                  </View>
                  <TextInput
                    style={styles.amountInput}
                    value={formDepositAmount}
                    onChangeText={(val) => setFormDepositAmount(toAsciiDigits(val).replace(/[^0-9]/g, ''))}
                    placeholder="e.g. 30000 or 50000"
                    placeholderTextColor={colors.outline}
                    keyboardType={Platform.OS === 'ios' ? 'ascii-capable-number-pad' : 'number-pad'}
                  />
                </View>
              </View>

              {/* 2. Collection Status */}
              <View style={styles.modalSection}>
                <Text style={styles.inputSectionLabel}>COLLECTION STATUS</Text>
                <View style={styles.statusSegmentRow}>
                  <TouchableOpacity
                    style={[styles.statusSegment, formStatus === 'collected' && styles.statusSegmentActive]}
                    onPress={() => setFormStatus('collected')}
                  >
                    <MaterialIcons
                      name="check-circle"
                      size={16}
                      color={formStatus === 'collected' ? colors.onPrimary : colors.onSurfaceVariant}
                    />
                    <Text style={[styles.statusSegmentText, formStatus === 'collected' && styles.statusSegmentTextActive]}>
                      Collected Upfront
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.statusSegment, formStatus === 'pending' && styles.statusSegmentActiveSecondary]}
                    onPress={() => setFormStatus('pending')}
                  >
                    <MaterialIcons
                      name="schedule"
                      size={16}
                      color={formStatus === 'pending' ? colors.onSecondary : colors.onSurfaceVariant}
                    />
                    <Text style={[styles.statusSegmentText, formStatus === 'pending' && styles.statusSegmentTextActiveSecondary]}>
                      Pending Payment
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.statusSegment, formStatus === 'refunded' && styles.statusSegmentActiveTertiary]}
                    onPress={() => setFormStatus('refunded')}
                  >
                    <MaterialIcons
                      name="task-alt"
                      size={16}
                      color={formStatus === 'refunded' ? '#fff' : colors.onSurfaceVariant}
                    />
                    <Text style={[styles.statusSegmentText, formStatus === 'refunded' && styles.statusSegmentTextActiveTertiary]}>
                      Refunded
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 3. Deductions (Paint, Repairs, Cleaning) */}
              <View style={styles.modalSection}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.inputSectionLabel}>MOVE-OUT CHARGES & DEDUCTIONS</Text>
                </View>
                <Text style={styles.inputSectionDesc}>
                  Charges cut from the deposit when vacating (e.g. paint, damages, cleaning).
                </Text>

                {/* Quick Add Preset Chips */}
                <Text style={styles.quickPresetTitle}>Quick add common charges:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll}>
                  {PRESET_DEDUCTIONS.map((p, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.presetChip}
                      onPress={() => handleAddDeduction(p.title, p.defaultAmount)}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="add" size={14} color={colors.primary} />
                      <Text style={styles.presetChipText}>{p.title} (₹{p.defaultAmount})</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Existing deductions list */}
                {formDeductions.length > 0 ? (
                  <View style={styles.modalDeductionsList}>
                    {formDeductions.map((d) => (
                      <View key={d.id} style={styles.modalDeductionItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modalDeductionTitle}>{d.title}</Text>
                          <Text style={styles.modalDeductionAmount}>-₹{Number(d.amount).toLocaleString('en-IN')}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleRemoveDeduction(d.id)}
                          style={styles.deleteDeductionBtn}
                        >
                          <MaterialIcons name="delete-outline" size={18} color={colors.error} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noDeductionsNote}>No deductions added yet.</Text>
                )}

                {/* Custom add row */}
                <View style={styles.customAddRow}>
                  <TextInput
                    style={[styles.customInput, { flex: 2 }]}
                    placeholder="Charge reason (e.g. Painting)"
                    placeholderTextColor={colors.outline}
                    value={newDeductionTitle}
                    onChangeText={setNewDeductionTitle}
                  />
                  <TextInput
                    style={[styles.customInput, { flex: 1.2 }]}
                    placeholder="Amount (₹)"
                    placeholderTextColor={colors.outline}
                    keyboardType={Platform.OS === 'ios' ? 'ascii-capable-number-pad' : 'number-pad'}
                    value={newDeductionAmount}
                    onChangeText={(val) => setNewDeductionAmount(toAsciiDigits(val).replace(/[^0-9]/g, ''))}
                  />
                  <TouchableOpacity
                    style={styles.addDeductionBtn}
                    onPress={() => handleAddDeduction()}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons name="add" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* 4. Live Settlement Summary */}
              <View style={styles.settlementCard}>
                <View style={styles.settlementRow}>
                  <Text style={styles.settlementLabel}>Initial Deposit:</Text>
                  <Text style={styles.settlementValue}>{fmt(modalDepositNum)}</Text>
                </View>
                <View style={styles.settlementRow}>
                  <Text style={[styles.settlementLabel, { color: colors.error }]}>Less Deductions:</Text>
                  <Text style={[styles.settlementValue, { color: colors.error }]}>-{fmt(modalTotalDeductions)}</Text>
                </View>
                <View style={styles.settlementDivider} />
                <View style={styles.settlementRow}>
                  <Text style={styles.settlementFinalLabel}>Net Refund to Tenant:</Text>
                  <Text style={styles.settlementFinalValue}>{fmt(modalNetRefund)}</Text>
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveDeposit}
                activeOpacity={0.8}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSaveText}>Save Deposit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
  },

  summaryCard: {
    backgroundColor: colors.primaryContainer,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 14,
    padding: 18,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.onPrimaryContainer,
    opacity: 0.2,
  },
  summaryValue: {
    fontFamily: fonts.manropeBold,
    fontSize: 18,
    color: colors.onPrimaryContainer,
    marginBottom: 4,
  },
  summaryLabel: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.onPrimaryContainer,
    opacity: 0.7,
    textAlign: 'center',
  },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: `${colors.primary}10`,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    borderRadius: 10,
    gap: 8,
  },
  infoBannerText: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.onSurface,
    flex: 1,
    lineHeight: 16,
  },

  filterScroll: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerLow,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipText: {
    fontFamily: fonts.interMedium,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  filterChipTextActive: {
    color: colors.onPrimary,
  },

  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  miniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniBadgeText: {
    fontFamily: fonts.interMedium,
    fontSize: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tenantName: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 15,
    color: colors.onSurface,
  },
  tenantInfo: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    fontFamily: fonts.interMedium,
    fontSize: 10.5,
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 12,
    opacity: 0.4,
  },
  cardDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  detailValue: {
    fontFamily: fonts.interMedium,
    fontSize: 13,
    color: colors.onSurface,
  },
  depositValueHighlight: {
    fontFamily: fonts.manropeBold,
    fontSize: 15,
    color: colors.primary,
  },
  ownerBadge: {
    backgroundColor: `${colors.primary}15`,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  ownerBadgeText: {
    fontFamily: fonts.interMedium,
    fontSize: 9.5,
    color: colors.primary,
  },
  depositContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  depositContextText: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    opacity: 0.8,
  },

  deductionsBox: {
    backgroundColor: `${colors.error}08`,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: `${colors.error}20`,
  },
  deductionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  deductionsTitle: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11.5,
    color: colors.error,
  },
  deductionsTotal: {
    fontFamily: fonts.manropeBold,
    fontSize: 12,
    color: colors.error,
  },
  deductionRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  deductionItemTitle: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
  deductionItemAmount: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.error,
  },
  netRefundDivider: {
    height: 1,
    backgroundColor: `${colors.error}25`,
    marginVertical: 6,
  },
  netRefundRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netRefundLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11.5,
    color: colors.onSurface,
  },
  netRefundValue: {
    fontFamily: fonts.manropeBold,
    fontSize: 13,
    color: colors.tertiaryFixedDim,
  },

  actionRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${colors.primary}12`,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  manageBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.primary,
  },

  emptyTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 18,
    color: colors.onSurface,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.interRegular,
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  errorTitle: {
    fontFamily: fonts.manropeSemiBold, fontSize: 18, color: colors.onSurface,
    marginTop: 12, marginBottom: 6,
  },
  errorMsg: {
    fontFamily: fonts.interRegular, fontSize: 13,
    color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 28,
  },
  retryText: { fontFamily: fonts.interSemiBold, fontSize: 14, color: colors.onPrimary },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
    marginTop: 2,
  },
  modalSection: {
    marginBottom: 16,
  },
  inputSectionLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  inputSectionDesc: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.outline,
    marginBottom: 8,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  currencyPrefix: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: colors.outlineVariant,
  },
  currencyPrefixText: {
    fontFamily: fonts.manropeBold,
    fontSize: 16,
    color: colors.primary,
  },
  amountInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.manropeBold,
    fontSize: 16,
    color: colors.onSurface,
  },

  statusSegmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusSegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  statusSegmentActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusSegmentActiveSecondary: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  statusSegmentActiveTertiary: {
    backgroundColor: colors.tertiaryFixedDim,
    borderColor: colors.tertiaryFixedDim,
  },
  statusSegmentText: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
  statusSegmentTextActive: {
    color: colors.onPrimary,
  },
  statusSegmentTextActiveSecondary: {
    color: colors.onSecondary,
  },
  statusSegmentTextActiveTertiary: {
    color: '#fff',
  },

  quickPresetTitle: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    marginBottom: 6,
  },
  presetScroll: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: `${colors.primary}12`,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  presetChipText: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.primary,
  },

  modalDeductionsList: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 6,
  },
  modalDeductionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: `${colors.outlineVariant}50`,
  },
  modalDeductionTitle: {
    fontFamily: fonts.interMedium,
    fontSize: 12.5,
    color: colors.onSurface,
  },
  modalDeductionAmount: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.error,
    marginTop: 1,
  },
  deleteDeductionBtn: {
    padding: 4,
  },
  noDeductionsNote: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.outline,
    fontStyle: 'italic',
    marginBottom: 8,
  },

  customAddRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  customInput: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurface,
  },
  addDeductionBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  settlementCard: {
    backgroundColor: `${colors.tertiaryFixedDim}12`,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${colors.tertiaryFixedDim}30`,
  },
  settlementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  settlementLabel: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  settlementValue: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.onSurface,
  },
  settlementDivider: {
    height: 1,
    backgroundColor: `${colors.tertiaryFixedDim}30`,
    marginVertical: 6,
  },
  settlementFinalLabel: {
    fontFamily: fonts.interBold,
    fontSize: 13,
    color: colors.onSurface,
  },
  settlementFinalValue: {
    fontFamily: fonts.manropeBold,
    fontSize: 15,
    color: colors.tertiaryFixedDim,
  },

  notesInput: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurface,
    textAlignVertical: 'top',
  },

  modalActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
  },
  modalCancelText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalSaveText: {
    fontFamily: fonts.interBold,
    fontSize: 13,
    color: colors.onPrimary,
  },
});
