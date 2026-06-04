import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import StatusChip from '../../components/StatusChip';

export default function MessagesAlertsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alerts, setAlerts] = useState([]);

  const fetchAlerts = useCallback(async () => {
    if (!user) return;
    try {
      // 1. Get tenant's property ID
      const { data: tenantRows, error: tErr } = await supabase
        .from('tenants')
        .select('property_id')
        .eq('user_id', user.id)
        .limit(1);

      if (tErr) throw tErr;

      const propertyId = tenantRows?.[0]?.property_id;

      if (!propertyId) {
        setAlerts([]);
        return;
      }

      // 2. Fetch alerts for this property or global alerts
      const { data: alertsData, error: aErr } = await supabase
        .from('alerts')
        .select('*')
        .or(`property_id.eq.${propertyId},property_id.is.null`)
        .order('created_at', { ascending: false });

      if (aErr) throw aErr;
      setAlerts(alertsData ?? []);
    } catch (err) {
      console.error('Error fetching alerts:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAlerts();
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getAlertVariant = (type) => {
    switch (type) {
      case 'urgent':
        return 'urgent';
      case 'warning':
        return 'pending';
      case 'info':
      default:
        return 'stable';
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case 'urgent':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
      default:
        return 'info';
    }
  };

  const getAlertIconColor = (type) => {
    switch (type) {
      case 'urgent':
        return colors.error;
      case 'warning':
        return '#f59e0b'; // Amber / Warning
      case 'info':
      default:
        return colors.primary;
    }
  };

  const renderAlert = ({ item }) => (
    <View style={styles.alertCard}>
      <View style={styles.cardHeader}>
        <View style={styles.alertTypeRow}>
          <MaterialIcons 
            name={getAlertIcon(item.type)} 
            size={18} 
            color={getAlertIconColor(item.type)} 
          />
          <StatusChip 
            label={item.type} 
            variant={getAlertVariant(item.type)} 
          />
        </View>
        <Text style={styles.alertDate}>{formatDate(item.created_at)}</Text>
      </View>
      <Text style={styles.alertTitle}>{item.title}</Text>
      <Text style={styles.alertContent}>{item.content}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Messages & Alerts"
        showBack
        onBack={() => navigation.goBack()}
      />
      <FlatList
        data={alerts}
        renderItem={renderAlert}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialIcons name="mail-outline" size={48} color={colors.outlineVariant} />
            <Text style={styles.emptyTitle}>No messages or alerts</Text>
            <Text style={styles.emptySubtitle}>
              Direct communications and emergency alerts will appear here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  alertCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  alertDate: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  alertTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 15,
    color: colors.onSurface,
  },
  alertContent: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
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
    fontSize: 13,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
