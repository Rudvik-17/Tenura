import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import SectionHeader from '../../components/SectionHeader';
import StatusChip from '../../components/StatusChip';
import MetricCard from '../../components/MetricCard';
import PrimaryButton from '../../components/PrimaryButton';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import { RateLimitedIconButton } from '../../components/RateLimitedIconButton';

export default function ResidentDataScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tenants, setTenants] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTenants = useCallback(async () => {
    if (!user) return;
    setError(null);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('tenants')
      .select('*, properties(name, city), leases(id, status, start_date, end_date, monthly_rent)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    if (fetchError) { setError(fetchError.message); setLoading(false); setRefreshing(false); return; }
    setTenants(data ?? []);
    setFiltered(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useFocusEffect(useCallback(() => { fetchTenants(); }, [fetchTenants]));

  const onRefresh = () => { setRefreshing(true); fetchTenants(); };

  useEffect(() => {
    const q = query.toLowerCase();
    setFiltered(
      q
        ? tenants.filter(
            t =>
              t.full_name.toLowerCase().includes(q) ||
              t.unit_number.toLowerCase().includes(q) ||
              t.email?.toLowerCase().includes(q)
          )
        : tenants
    );
  }, [query, tenants]);

  if (!user) return null;

  const chipVariant = (status) =>
    status === 'active' ? 'active' : status === 'pending' ? 'pending' : 'urgent';

  const renderTenant = ({ item }) => (
    <TouchableOpacity
      style={styles.tenantRow}
      onPress={() => navigation.navigate('TenantDetail', { tenant: item })}
      activeOpacity={0.8}
    >
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarInitial}>{item.full_name[0]}</Text>
      </View>
      <View style={styles.tenantInfo}>
        <Text style={styles.tenantName}>{item.full_name}</Text>
        <Text style={styles.tenantMeta}>
          Unit {item.unit_number} · {item.properties?.name}
        </Text>
        {item.email ? (
          <View style={styles.emailRow}>
            <MaterialIcons name="mail-outline" size={13} color={colors.onSurfaceVariant} style={{ marginRight: 4 }} />
            <Text style={styles.tenantEmail} numberOfLines={1}>{item.email}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.tenantRight}>
        <StatusChip
          label={item.status}
          variant={chipVariant(item.status)}
        />
        <MaterialIcons name="chevron-right" size={18} color={colors.outline} style={{ marginTop: 6 }} />
      </View>
    </TouchableOpacity>
  );

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
        <Text style={styles.errorTitle}>Unable to load residents</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <RateLimitedButton style={styles.retryBtn} onPress={fetchTenants}>
          <Text style={styles.retryText}>Retry</Text>
        </RateLimitedButton>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Residents" showBell />

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderTenant}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            {/* Metrics */}
            <View style={styles.metricsRow}>
              <MetricCard icon="groups" value={String(tenants.length)} label="Total Residents" />
            </View>

            {/* Search + Add */}
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <MaterialIcons name="search" size={20} color={colors.primary} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search (e.g. Arjun, Unit 102, or email)..."
                  placeholderTextColor={colors.onSurfaceVariant}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="close" size={18} color={colors.onSurfaceVariant} />
                  </TouchableOpacity>
                )}
              </View>
              <RateLimitedIconButton
                style={styles.addBtn}
                onPress={() => navigation.navigate('TenantOnboarding')}
                icon={<MaterialIcons name="person-add" size={20} color={colors.onPrimary} />}
              />
            </View>

            <View style={styles.sectionHeaderWrapper}>
              <SectionHeader
                title="All Residents"
                actionLabel="Add Resident"
                onAction={() => navigation.navigate('TenantOnboarding')}
              />
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="groups" size={40} color={colors.outline} />
            <Text style={styles.emptyTitle}>No residents added yet</Text>
            <Text style={styles.emptySubtitle}>Add your first resident to get started.</Text>
            <View style={{ marginTop: 20 }}>
              <PrimaryButton
                label="Add your first resident"
                onPress={() => navigation.navigate('TenantOnboarding')}
                icon="person-add"
              />
            </View>
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    padding: 24,
  },

  metricsRow: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.surfaceContainerLow,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.interRegular,
    fontSize: 14,
    color: colors.onSurface,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },

  sectionHeaderWrapper: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  tenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
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
    color: colors.primary,
  },
  tenantInfo: { flex: 1 },
  tenantName: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 15,
    color: colors.onSurface,
    marginBottom: 2,
  },
  tenantMeta: {
    fontFamily: fonts.interMedium,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginBottom: 2,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  tenantEmail: {
    fontFamily: fonts.interMedium,
    fontSize: 12.5,
    color: colors.onSurfaceVariant,
  },
  tenantRight: { alignItems: 'flex-end' },

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

  errorTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 18,
    color: colors.onSurface,
    marginTop: 12,
    marginBottom: 6,
  },
  errorMsg: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  retryText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 14,
    color: colors.onPrimary,
  },
});
