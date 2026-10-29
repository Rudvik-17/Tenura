import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PropTypes from 'prop-types';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../theme/typography';

export default function MetricCard({ icon, value, label, trend, trendUp }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={styles.card}>
      <View style={styles.iconBadge}>
        <MaterialIcons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {trend ? (
        <View style={styles.trendRow}>
          <MaterialIcons
            name={trendUp ? 'trending-up' : 'trending-down'}
            size={12}
            color={trendUp ? colors.onTertiaryContainer : colors.error}
          />
          <Text style={[styles.trend, { color: trendUp ? colors.onTertiaryContainer : colors.error }]}>
            {trend}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

MetricCard.propTypes = {
  icon: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  trend: PropTypes.string,
  trendUp: PropTypes.bool,
};

MetricCard.defaultProps = {
  trend: null,
  trendUp: true,
};

const getStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: 16,
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  value: {
    fontFamily: fonts.manropeBold,
    fontSize: 20,
    color: colors.onSurface,
    marginBottom: 4,
  },
  label: {
    fontFamily: fonts.interMedium,
    fontSize: 12.5,
    color: colors.onSurfaceVariant,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 3,
  },
  trend: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
  },
});
