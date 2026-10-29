import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
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

export default function RecentActivityScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setError(null);

    // Fetch properties
    const { data: propRows, error: propErr } = await supabase
      .from('properties')
      .select('id')
      .eq('owner_id', user.id);

    if (propErr) {
      setError(propErr.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const propIds = (propRows ?? []).map(p => p.id);

    // Fetch payments and transactions in parallel
    const [paymentsRes, txRes] = await Promise.all([
      supabase
        .from('payments')
        .select('*, tenants!inner(owner_id, full_name)')
        .eq('tenants.owner_id', user.id)
        .order('due_date', { ascending: false }),
      propIds.length > 0
        ? supabase
            .from('transactions')
            .select('*')
            .in('property_id', propIds)
            .order('date', { ascending: false })
        : { data: [], error: null },
    ]);

    if (paymentsRes.error) {
      setError(paymentsRes.error.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (txRes.error) {
      setError(txRes.error.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const paidPayments = (paymentsRes.data ?? [])
      .filter(p => p.status === 'paid')
      .map(p => ({ ...p, _kind: 'payment', _date: p.paid_at ?? p.due_date }));
    const transactions = (txRes.data ?? [])
      .map(t => ({ ...t, _kind: 'transaction', _date: t.date }));

    const merged = [...paidPayments, ...transactions]
      .sort((a, b) => new Date(b._date) - new Date(a._date));

    setActivity(merged);
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

  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Recent Activity" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Recent Activity" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="error-outline" size={40} color={colors.error} />
          <Text style={styles.errorTitle}>Unable to load activity</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <RateLimitedButton style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryText}>Retry</Text>
          </RateLimitedButton>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }) => {
    const isPayment = item._kind === 'payment';
    const label = isPayment
      ? (item.tenants?.full_name ?? 'Tenant')
      : (item.description ?? item.category ?? item.type);
    const subtitle = isPayment
      ? `Rent payment from ${item.tenants?.full_name ?? 'Tenant'}`
      : (item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : item.type);
    const dateStr = new Date(item._date).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });

    return (
      <View style={styles.lineItem}>
        <View style={styles.lineItemLeft}>
          <View style={[styles.iconCircle, {
            backgroundColor: isPayment ? `${colors.tertiaryFixedDim}20` : `${colors.error}15`,
          }]}>
            <MaterialIcons
              name={isPayment ? 'check-circle' : 'receipt'}
              size={20}
              color={isPayment ? colors.tertiaryFixedDim : colors.onSurfaceVariant}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineItemLabel}>{label}</Text>
            <Text style={styles.lineItemSubtitle}>{subtitle}</Text>
            <Text style={styles.lineItemDate}>{dateStr}</Text>
          </View>
        </View>
        <Text style={[styles.lineItemAmount, {
          color: isPayment ? colors.tertiaryFixedDim : colors.error,
        }]}>
          {isPayment ? '+' : '-'}{fmt(item.amount)}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Recent Activity" showBack onBack={() => navigation.goBack()} />
      {activity.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="history" size={48} color={colors.outline} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptySubtitle}>
            Payment and transaction activity will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={activity}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
  },

  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  lineItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineItemLabel: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 15,
    color: colors.onSurface,
  },
  lineItemSubtitle: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  lineItemDate: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.outline,
    marginTop: 2,
  },
  lineItemAmount: {
    fontFamily: fonts.manropeBold,
    fontSize: 15,
    marginLeft: 8,
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
});
