import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import StatusChip from '../../components/StatusChip';
import PrimaryButton from '../../components/PrimaryButton';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import { getTenantDeposit, saveTenantDeposit, removeTenantDeposit, toAsciiDigits } from '../../lib/securityDeposit';

export default function TenantDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { tenant: initialTenant } = route.params;

  const [tenant, setTenant] = useState(initialTenant);
  const [lease, setLease] = useState(null);
  const [loadingLease, setLoadingLease] = useState(true);
  const [leaseError, setLeaseError] = useState(null);

  const [editMode, setEditMode] = useState(false);
  const [unitEdit, setUnitEdit] = useState('');
  const [phoneEdit, setPhoneEdit] = useState('');
  const [rentEdit, setRentEdit] = useState('');
  const [deposit, setDeposit] = useState(null);
  const [depositEdit, setDepositEdit] = useState('');
  const [editErrors, setEditErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [removing, setRemoving] = useState(false);

  if (!user) return null;

  const fetchLease = useCallback(async () => {
    setLeaseError(null);
    setLoadingLease(true);
    const { data, error } = await supabase
      .from('leases')
      .select('id, start_date, end_date, monthly_rent, status')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      setLeaseError(error.message);
      setLoadingLease(false);
      return;
    }
    const l = data?.[0] ?? null;
    setLease(l);

    // Fetch tenant security deposit
    try {
      const depInfo = await getTenantDeposit(
        tenant.id,
        tenant.full_name,
        l?.monthly_rent ?? 0,
        tenant.security_deposit
      );
      setDeposit(depInfo);
    } catch (dErr) {
      console.warn('Error fetching deposit:', dErr);
    }

    setLoadingLease(false);
  }, [tenant.id, tenant.full_name, tenant.security_deposit]);

  // Fetch on mount — inline effect via useState initializer pattern not available,
  // so we use a ref-based one-time call
  const [leaseFetched, setLeaseFetched] = useState(false);
  if (!leaseFetched) {
    setLeaseFetched(true);
    fetchLease();
  }

  const enterEditMode = () => {
    setUnitEdit(tenant.unit_number ?? '');
    setPhoneEdit(tenant.phone ?? '');
    setRentEdit(lease ? String(lease.monthly_rent) : '');
    setDepositEdit(deposit ? String(deposit.amount) : '');
    setEditErrors({});
    setSaveError(null);
    setEditMode(true);
  };

  const validateEdit = () => {
    const errs = {};
    if (!unitEdit.trim()) errs.unit = 'Unit number is required.';
    const rent = Number(rentEdit);
    if (!rentEdit.trim()) errs.rent = 'Monthly rent is required.';
    else if (isNaN(rent) || rent <= 0) errs.rent = 'Enter a valid rent amount.';
    if (depositEdit.trim()) {
      const d = Number(depositEdit);
      if (isNaN(d) || d < 0) errs.deposit = 'Enter a valid deposit amount.';
    }
    setEditErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateEdit()) return;
    setSaveError(null);
    setSaving(true);

    const updates = [];

    // Update tenant: unit_number + phone
    updates.push(
      supabase
        .from('tenants')
        .update({
          unit_number: unitEdit.trim(),
          phone: phoneEdit.trim() || null,
        })
        .eq('id', tenant.id)
        .eq('owner_id', user.id),
    );

    // Update lease: monthly_rent (if lease exists)
    if (lease) {
      updates.push(
        supabase
          .from('leases')
          .update({ monthly_rent: Number(rentEdit) })
          .eq('id', lease.id),
      );
    }

    // Save custom deposit price if provided
    if (depositEdit.trim()) {
      try {
        await saveTenantDeposit(tenant.id, tenant.full_name, {
          amount: Number(depositEdit),
          status: deposit?.status || 'collected',
          deductions: deposit?.deductions || [],
          notes: deposit?.notes || '',
        });
        setDeposit(prev => ({ ...prev, amount: Number(depositEdit) }));
      } catch (depErr) {
        console.warn('Error updating deposit:', depErr);
      }
    }

    const results = await Promise.all(updates);
    setSaving(false);

    const failed = results.find(r => r.error);
    if (failed) {
      setSaveError(failed.error.message);
      return;
    }

    // Reflect changes locally so the screen updates immediately
    setTenant(prev => ({
      ...prev,
      unit_number: unitEdit.trim(),
      phone: phoneEdit.trim() || null,
    }));
    if (lease) {
      setLease(prev => ({ ...prev, monthly_rent: Number(rentEdit) }));
    }
    setEditMode(false);
  };

  const handleRemove = () => {
    Alert.alert(
      'Remove Resident',
      `Are you sure you want to remove ${tenant.full_name}? Financial and payment ledger records will be preserved for audit compliance.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: confirmRemove,
        },
      ],
    );
  };

  const confirmRemove = async () => {
    setRemoving(true);
    try {
      // 1. Delete maintenance requests and any child issue messages
      const { data: issues } = await supabase
        .from('maintenance_requests')
        .select('id')
        .eq('tenant_id', tenant.id);

      if (issues && issues.length > 0) {
        const issueIds = issues.map(i => i.id);
        await supabase.from('issue_messages').delete().in('issue_id', issueIds);
        await supabase.from('maintenance_requests').delete().in('id', issueIds);
      }

      // 2. Check if this tenant has any payment records (financial history must never be deleted)
      const { data: existingPayments, error: payCheckErr } = await supabase
        .from('payments')
        .select('id')
        .eq('tenant_id', tenant.id)
        .limit(1);

      if (payCheckErr) {
        throw payCheckErr;
      }

      if (existingPayments && existingPayments.length > 0) {
        // Preserve financial history: terminate active leases and mark resident as exiting
        await supabase
          .from('leases')
          .update({ status: 'terminated' })
          .eq('tenant_id', tenant.id)
          .eq('status', 'active');

        const { error: archiveErr } = await supabase
          .from('tenants')
          .update({ status: 'exiting', user_id: null })
          .eq('id', tenant.id)
          .eq('owner_id', user.id);

        if (archiveErr) {
          throw archiveErr;
        }
      } else {
        // No financial history exists — safe to remove draft leases and tenant record
        await supabase.from('leases').delete().eq('tenant_id', tenant.id);

        const { error: delError } = await supabase
          .from('tenants')
          .delete()
          .eq('id', tenant.id);

        if (delError) {
          throw delError;
        }
      }

      // Clean up cached deposit record
      await removeTenantDeposit(tenant.id, tenant.full_name);

      setRemoving(false);
      navigation.goBack();
    } catch (err) {
      setRemoving(false);
      console.error('Error removing resident:', err);
      Alert.alert('Error', err.message || 'Could not remove resident.');
    }
  };

  const chipVariant = status =>
    status === 'active' ? 'active' : status === 'pending' ? 'pending' : 'urgent';

  const formatDate = d =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenHeader title="Resident Details" showBack onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{tenant.full_name[0]}</Text>
            </View>
            <Text style={styles.heroName}>{tenant.full_name}</Text>
            {tenant.email ? (
              <Text style={styles.heroEmail}>{tenant.email}</Text>
            ) : null}
            <View style={styles.heroChipRow}>
              <StatusChip label={tenant.status} variant={chipVariant(tenant.status)} />
            </View>
          </View>

          {/* Details card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>TENANT INFORMATION</Text>
            <DetailRow icon="domain" label="Property" value={tenant.properties?.name ?? '—'} />
            <DetailRow icon="location-city" label="City" value={tenant.properties?.city ?? '—'} />
            <DetailRow icon="home" label="Unit" value={tenant.unit_number} />
            <DetailRow icon="phone" label="Phone" value={tenant.phone ?? 'Not provided'} />
          </View>

          {/* Lease card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>LEASE DETAILS</Text>
            {loadingLease ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
            ) : leaseError ? (
              <View style={styles.leaseErrorRow}>
                <MaterialIcons name="error-outline" size={16} color={colors.error} />
                <Text style={styles.leaseErrorText}>{leaseError}</Text>
              </View>
            ) : lease ? (
              <>
                <DetailRow
                  icon="event"
                  label="Lease Start"
                  value={formatDate(lease.start_date)}
                />
                <DetailRow
                  icon="event-busy"
                  label="Lease End"
                  value={formatDate(lease.end_date)}
                />
                <DetailRow
                  icon="payments"
                  label="Monthly Rent"
                  value={`₹${Number(lease.monthly_rent).toLocaleString('en-IN')}/mo`}
                  accent
                />
                <DetailRow
                  icon="shield"
                  label="Security Deposit"
                  value={deposit?.amount ? `₹${Number(deposit.amount).toLocaleString('en-IN')}` : 'Not set'}
                />
                <DetailRow
                  icon="description"
                  label="Lease Status"
                  value={lease.status.replace('_', ' ')}
                  last
                />
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    backgroundColor: `${colors.primary}12`,
                    borderRadius: 8,
                    paddingVertical: 10,
                    marginTop: 12,
                  }}
                  onPress={() => navigation.navigate('Finance', { screen: 'SecurityDeposit' })}
                >
                  <MaterialIcons name="tune" size={16} color={colors.primary} />
                  <Text style={{ fontFamily: fonts.interSemiBold, fontSize: 13, color: colors.primary }}>
                    Manage Security Deposit & Deductions
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.noLeaseText}>No active lease found.</Text>
            )}
          </View>

          {/* Edit form */}
          {editMode ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>EDIT DETAILS</Text>

              <Text style={styles.fieldLabel}>UNIT NUMBER</Text>
              <TextInput
                style={[styles.input, editErrors.unit && styles.inputError]}
                value={unitEdit}
                onChangeText={t => { setUnitEdit(t); setEditErrors(e => ({ ...e, unit: null })); }}
                placeholder="e.g. A-204"
                placeholderTextColor={colors.outline}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {editErrors.unit ? <Text style={styles.fieldError}>{editErrors.unit}</Text> : null}

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>PHONE</Text>
              <TextInput
                style={styles.input}
                value={phoneEdit}
                onChangeText={setPhoneEdit}
                placeholder="e.g. +91 98765 43210"
                placeholderTextColor={colors.outline}
                keyboardType="phone-pad"
              />

              {lease ? (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: 16 }]}>MONTHLY RENT</Text>
                  <View style={styles.prefixRow}>
                    <View style={styles.prefixBox}>
                      <Text style={styles.prefixText}>₹</Text>
                    </View>
                    <TextInput
                      style={[styles.input, styles.prefixInput, editErrors.rent && styles.inputError]}
                      value={rentEdit}
                      onChangeText={t => { setRentEdit(toAsciiDigits(t).replace(/[^0-9]/g, '')); setEditErrors(e => ({ ...e, rent: null })); }}
                      placeholder="e.g. 45000"
                      placeholderTextColor={colors.outline}
                      keyboardType={Platform.OS === 'ios' ? 'ascii-capable-number-pad' : 'number-pad'}
                    />
                  </View>
                  {editErrors.rent ? <Text style={styles.fieldError}>{editErrors.rent}</Text> : null}

                  <Text style={[styles.fieldLabel, { marginTop: 16 }]}>SECURITY DEPOSIT (OWNER SET)</Text>
                  <View style={styles.prefixRow}>
                    <View style={styles.prefixBox}>
                      <Text style={styles.prefixText}>₹</Text>
                    </View>
                    <TextInput
                      style={[styles.input, styles.prefixInput, editErrors.deposit && styles.inputError]}
                      value={depositEdit}
                      onChangeText={t => { setDepositEdit(toAsciiDigits(t).replace(/[^0-9]/g, '')); setEditErrors(e => ({ ...e, deposit: null })); }}
                      placeholder="e.g. 50000"
                      placeholderTextColor={colors.outline}
                      keyboardType={Platform.OS === 'ios' ? 'ascii-capable-number-pad' : 'number-pad'}
                    />
                  </View>
                  {editErrors.deposit ? <Text style={styles.fieldError}>{editErrors.deposit}</Text> : null}
                </>
              ) : null}

              {saveError ? (
                <View style={styles.errorCard}>
                  <MaterialIcons name="error-outline" size={16} color={colors.error} />
                  <Text style={styles.errorCardText}>{saveError}</Text>
                </View>
              ) : null}

              <View style={styles.editActions}>
                <PrimaryButton label="Save Changes" onPress={handleSave} loading={saving} icon="check" />
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditMode(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* Action buttons — shown when not editing */
            <View style={styles.actions}>
              <TouchableOpacity style={styles.editBtn} onPress={enterEditMode}>
                <MaterialIcons name="edit" size={18} color={colors.primary} />
                <Text style={styles.editBtnText}>Edit Tenant</Text>
              </TouchableOpacity>

              <RateLimitedButton
                style={styles.removeBtn}
                onPress={handleRemove}
                disabled={removing}
              >
                {removing ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <>
                    <MaterialIcons name="person-remove" size={18} color={colors.error} />
                    <Text style={styles.removeBtnText}>Remove Tenant</Text>
                  </>
                )}
              </RateLimitedButton>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function DetailRow({ icon, label, value, accent, last }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={[styles.detailRow, last && { marginBottom: 0 }]}>
      <MaterialIcons
        name={icon}
        size={16}
        color={accent ? colors.tertiaryFixedDim : colors.onSurfaceVariant}
      />
      <View style={styles.detailContent}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={[styles.detailValue, accent && styles.detailAccent]}>{value}</Text>
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  // ── Hero ──────────────────────────────────────────────────────────────────────
  hero: {
    alignItems: 'center',
    backgroundColor: colors.primaryContainer,
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 24,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarInitial: {
    fontFamily: fonts.manropeBold,
    fontSize: 30,
    color: colors.onPrimary,
  },
  heroName: {
    fontFamily: fonts.manropeBold,
    fontSize: 22,
    color: colors.onPrimaryContainer,
    marginBottom: 4,
  },
  heroEmail: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onPrimaryContainer,
    marginBottom: 12,
  },
  heroChipRow: {
    flexDirection: 'row',
  },

  // ── Cards ─────────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
  },
  cardTitle: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
    marginBottom: 14,
  },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  detailContent: { flex: 1 },
  detailLabel: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  detailValue: {
    fontFamily: fonts.interMedium,
    fontSize: 14,
    color: colors.onSurface,
  },
  detailAccent: {
    fontFamily: fonts.manropeSemiBold,
    color: colors.tertiaryFixedDim,
  },

  leaseErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  leaseErrorText: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.error,
    flex: 1,
  },
  noLeaseText: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    paddingVertical: 4,
  },

  // ── Edit form ─────────────────────────────────────────────────────────────────
  fieldLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.interRegular,
    fontSize: 15,
    color: colors.onSurface,
  },
  inputError: {
    backgroundColor: colors.errorContainer,
  },
  fieldError: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  prefixRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  prefixBox: {
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  prefixText: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 16,
    color: colors.onSurfaceVariant,
  },
  prefixInput: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.errorContainer,
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  errorCardText: {
    flex: 1,
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onErrorContainer,
  },
  editActions: {
    marginTop: 20,
    gap: 12,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 14,
    color: colors.onSurfaceVariant,
  },

  // ── Action buttons ────────────────────────────────────────────────────────────
  actions: {
    marginHorizontal: 16,
    marginTop: 16,
    gap: 10,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 10,
    paddingVertical: 16,
  },
  editBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 15,
    color: colors.primary,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.errorContainer,
    borderRadius: 10,
    paddingVertical: 16,
  },
  removeBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 15,
    color: colors.error,
  },
});
