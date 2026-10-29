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

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
];

const statusVariant = (status) =>
  status === 'paid' ? 'active' : status === 'overdue' ? 'urgent' : 'pending';

export default function RentCollectionScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [payments, setPayments] = useState([]);
  const [ownerName, setOwnerName] = useState('Property Owner');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(null); // 'pdf' | 'excel' | null

  const fetchData = useCallback(async () => {
    if (!user) return;
    setError(null);

    const [paymentsRes, profileRes] = await Promise.all([
      supabase
        .from('payments')
        .select('*, tenants!inner(owner_id, full_name, unit_number, properties(name))')
        .eq('tenants.owner_id', user.id)
        .order('due_date', { ascending: false }),
      supabase
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle(),
    ]);

    if (profileRes.data?.full_name) {
      setOwnerName(profileRes.data.full_name);
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
  }, [user?.id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  if (!user) return null;

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const now = new Date();
  const currentMonthName = now.toLocaleString('en-IN', { month: 'long' });
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const mtdCollected = payments
    .filter(p => {
      if (p.status !== 'paid') return false;
      const d = p.paid_at ? new Date(p.paid_at) : (p.due_date ? new Date(p.due_date) : null);
      return d && d >= startOfMonth && d <= endOfMonth;
    })
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalPending = payments
    .filter(p => p.status === 'pending' || p.status === 'overdue')
    .reduce((s, p) => s + Number(p.amount), 0);
  const paidCount = payments.filter(p => p.status === 'paid').length;
  const collectionRate = payments.length > 0
    ? Math.round((paidCount / payments.length) * 100)
    : 0;

  const filtered = filter === 'all' ? payments : payments.filter(p => p.status === filter);

  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const formatDate = (d) =>
    d
      ? new Date(d).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : '—';

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

  const renderPayment = ({ item }) => (
    <View style={styles.paymentRow}>
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
        <Text style={styles.paymentDue}>Due {formatDate(item.due_date)}</Text>
      </View>
      <View style={styles.paymentRight}>
        <Text style={styles.paymentAmount}>{fmt(item.amount)}</Text>
        <StatusChip label={item.status} variant={statusVariant(item.status)} />
      </View>
    </View>
  );

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
                  label={`${currentMonthName} Collection`}
                  trendUp={mtdCollected > 0}
                />
                <View style={{ width: 12 }} />
                <MetricCard
                  icon="schedule"
                  value={fmt(totalPending)}
                  label="Pending"
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
                    ({f.key === 'all'
                      ? payments.length
                      : payments.filter(p => p.status === f.key).length})
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
                : `No ${filter} payments found.`}
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
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

  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
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
  paymentRight: { alignItems: 'flex-end', gap: 6 },
  paymentAmount: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 14,
    color: colors.onSurface,
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
