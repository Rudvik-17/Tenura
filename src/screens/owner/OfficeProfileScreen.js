import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import PrimaryButton from '../../components/PrimaryButton';

export default function OfficeProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    async function loadProfile() {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('users')
          .select('full_name, email, phone')
          .eq('id', user.id)
          .single();

        if (error) throw error;
        setFullName(data?.full_name || '');
        setEmail(data?.email || user.email || '');
        setPhone(data?.phone || '');
      } catch (err) {
        console.error('Error loading office profile:', err.message);
        Alert.alert('Error', 'Could not load office profile details.');
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [user?.id]);

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Validation Error', 'Full Name is required.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        })
        .eq('id', user.id);

      if (error) throw error;
      Alert.alert('Success', 'Office profile updated successfully.');
      navigation.goBack();
    } catch (err) {
      console.error('Error saving profile:', err.message);
      Alert.alert('Error', 'Could not save profile changes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader
        title="Office Profile"
        showBack
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Contact Information</Text>
          <Text style={styles.cardSubtitle}>
            These details will be displayed to all your tenants under the "Office Information" tab.
          </Text>

          {/* Full Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Manager Full Name</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="person" size={20} color={colors.outline} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="e.g. Vikram Malhotra"
                placeholderTextColor={colors.outline}
              />
            </View>
          </View>

          {/* Email Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Office Email Address</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="email" size={20} color={colors.outline} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="e.g. office@estatelogic.com"
                placeholderTextColor={colors.outline}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Phone Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Office Phone Number</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="phone" size={20} color={colors.outline} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="e.g. +91 98765 43210"
                placeholderTextColor={colors.outline}
                keyboardType="phone-pad"
              />
            </View>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <PrimaryButton
            label="Save Office Profile"
            onPress={handleSave}
            loading={saving}
            icon="save"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  infoCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 16,
    color: colors.onSurface,
  },
  cardSubtitle: {
    fontFamily: fonts.interRegular,
    fontSize: 13,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
    marginBottom: 8,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 48,
    fontFamily: fonts.interRegular,
    fontSize: 14,
    color: colors.onSurface,
  },
  buttonContainer: {
    marginTop: 8,
  },
});
