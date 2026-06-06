import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PropTypes from 'prop-types';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../theme/typography';

export default function StatusChip({ label, variant }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const variantStyles = {
    active: {
      bg: 'rgba(104, 219, 169, 0.12)',
      text: colors.onTertiaryContainer,
    },
    pending: {
      bg: colors.secondaryContainer,
      text: colors.onSecondaryContainer,
    },
    urgent: {
      bg: colors.errorContainer,
      text: colors.error,
    },
  };

  const style = variantStyles[variant] || variantStyles.pending;
  return (
    <View style={[styles.chip, { backgroundColor: style.bg }]}>
      <Text style={[styles.label, { color: style.text }]}>{label}</Text>
    </View>
  );
}


StatusChip.propTypes = {
  label: PropTypes.string.isRequired,
  variant: PropTypes.oneOf(['active', 'pending', 'urgent']),
};

StatusChip.defaultProps = {
  variant: 'pending',
};

const getStyles = (colors) => StyleSheet.create({
  chip: {
    borderRadius: 9999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
