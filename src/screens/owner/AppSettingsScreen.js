import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import {
  getNotificationSettings,
  saveNotificationSettings,
  getRentalDefaults,
  saveRentalDefaults,
  checkBiometricsSupport,
  getBiometricEnabled,
  setBiometricEnabled,
  authenticateWithBiometrics,
  clearAppCache,
} from '../../lib/appSettings';

const DUE_DAY_PRESETS = [1, 5, 10, 15];
const GRACE_DAYS_OPTIONS = [0, 3, 5, 7];
const COLLECTION_WINDOW_PRESETS = [
  { label: 'Last Mo 25th – This Mo 10th', startMonth: 'previous', startDay: 25, endDay: 10 },
  { label: 'Last Mo 28th – This Mo 5th', startMonth: 'previous', startDay: 28, endDay: 5 },
  { label: 'This Mo 1st – This Mo 10th', startMonth: 'current', startDay: 1, endDay: 10 },
];

export default function AppSettingsScreen({ navigation }) {
  const { colors, theme, setTheme } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // ── States ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  // User Profile
  const [profile, setProfile] = useState({ fullName: '', phone: '', email: '' });
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: '', phone: '', email: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  // Password Change
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState({
    rentAlerts: true,
    overdueAlerts: true,
    maintenanceAlerts: true,
    leaseExpiryAlerts: true,
    pushEnabled: true,
    emailEnabled: true,
    whatsappEnabled: false,
  });

  // Rental Defaults
  const [rentalDefaults, setRentalDefaults] = useState({
    dueDay: 5,
    collectionMode: 'single',
    collectionStartMonth: 'previous',
    collectionStartDay: 25,
    collectionEndDay: 10,
    gracePeriodDays: 3,
  });
  const [customDayInput, setCustomDayInput] = useState('');
  const [showCustomDayInput, setShowCustomDayInput] = useState(false);
  const [customTab, setCustomTab] = useState('window'); // 'window' | 'single'
  const [windowStartMonth, setWindowStartMonth] = useState('previous'); // 'previous' | 'current'
  const [windowStartDayInput, setWindowStartDayInput] = useState('25');
  const [windowEndDayInput, setWindowEndDayInput] = useState('10');

  // Biometrics
  const [biometricsSupport, setBiometricsSupport] = useState({
    available: false,
    biometricType: 'Biometrics',
  });
  const [biometricEnabled, setBiometricEnabledState] = useState(false);

  // Legal & FAQ Modals
  const [legalModalVisible, setLegalModalVisible] = useState(false);
  const [legalModalType, setLegalModalType] = useState('terms'); // 'terms' | 'privacy'
  const [faqModalVisible, setFaqModalVisible] = useState(false);

  // ── Initial Data Load ──────────────────────────────────────────────────
  const loadAllSettings = useCallback(async () => {
    if (!user) return;
    try {
      // 1. Load user profile from Supabase
      const { data: userData } = await supabase
        .from('users')
        .select('full_name, phone, email')
        .eq('id', user.id)
        .single();

      const userProfile = {
        fullName: userData?.full_name || user.user_metadata?.full_name || '',
        phone: userData?.phone || '',
        email: userData?.email || user.email || '',
      };
      setProfile(userProfile);
      setProfileForm(userProfile);

      // 2. Load Notifications
      const notifs = await getNotificationSettings();
      setNotifications(notifs);

      // 3. Load Rental Defaults
      const defaults = await getRentalDefaults();
      setRentalDefaults(defaults);
      setWindowStartMonth(defaults.collectionStartMonth || 'previous');
      setWindowStartDayInput(String(defaults.collectionStartDay || 25));
      setWindowEndDayInput(String(defaults.collectionEndDay || 10));

      if (defaults.collectionMode === 'window') {
        setShowCustomDayInput(true);
        setCustomTab('window');
      } else if (!DUE_DAY_PRESETS.includes(defaults.dueDay)) {
        setShowCustomDayInput(true);
        setCustomTab('single');
        setCustomDayInput(String(defaults.dueDay));
      }

      // 4. Load Biometrics
      const bioSupport = await checkBiometricsSupport();
      setBiometricsSupport(bioSupport);
      const isBioOn = await getBiometricEnabled();
      setBiometricEnabledState(isBioOn);
    } catch (err) {
      console.warn('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadAllSettings();
  }, [loadAllSettings]);

  // ── Handlers ───────────────────────────────────────────────────────────

  // Notification Toggle
  const toggleNotification = async (key) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    await saveNotificationSettings(updated);
  };

  // Due Day Select
  const handleSelectDueDay = async (day) => {
    setShowCustomDayInput(false);
    setCustomDayInput('');
    const updated = { ...rentalDefaults, dueDay: day, collectionMode: 'single' };
    setRentalDefaults(updated);
    await saveRentalDefaults(updated);
  };

  const handleCustomDaySubmit = async () => {
    const parsed = parseInt(customDayInput, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 31) {
      Alert.alert('Invalid Day', 'Please enter a valid day between 1 and 31.');
      return;
    }
    const updated = { ...rentalDefaults, dueDay: parsed, collectionMode: 'single' };
    setRentalDefaults(updated);
    await saveRentalDefaults(updated);
    Alert.alert('Saved', `Default due date set to the ${parsed}${getOrdinal(parsed)} of every month.`);
  };

  const handleSelectWindowPreset = async (preset) => {
    setWindowStartMonth(preset.startMonth);
    setWindowStartDayInput(String(preset.startDay));
    setWindowEndDayInput(String(preset.endDay));
    const updated = {
      ...rentalDefaults,
      collectionMode: 'window',
      collectionStartMonth: preset.startMonth,
      collectionStartDay: preset.startDay,
      collectionEndDay: preset.endDay,
      dueDay: preset.endDay,
    };
    setRentalDefaults(updated);
    await saveRentalDefaults(updated);
  };

  const handleCustomWindowSubmit = async () => {
    const startDay = parseInt(windowStartDayInput, 10);
    const endDay = parseInt(windowEndDayInput, 10);
    if (isNaN(startDay) || startDay < 1 || startDay > 31) {
      Alert.alert('Invalid Start Day', 'Please enter a valid start day between 1 and 31.');
      return;
    }
    if (isNaN(endDay) || endDay < 1 || endDay > 31) {
      Alert.alert('Invalid End Day', 'Please enter a valid end day between 1 and 31.');
      return;
    }
    if (windowStartMonth === 'current' && startDay >= endDay) {
      Alert.alert(
        'Invalid Range',
        'When starting in the current month, the start day must be earlier than the end day.'
      );
      return;
    }
    const updated = {
      ...rentalDefaults,
      collectionMode: 'window',
      collectionStartMonth: windowStartMonth,
      collectionStartDay: startDay,
      collectionEndDay: endDay,
      dueDay: endDay,
    };
    setRentalDefaults(updated);
    await saveRentalDefaults(updated);
    const startMonthLabel = windowStartMonth === 'previous' ? 'last month' : 'current month';
    Alert.alert(
      'Collection Period Saved',
      `Rent collection period set from the ${startDay}${getOrdinal(startDay)} of ${startMonthLabel} to the ${endDay}${getOrdinal(endDay)} of current month.`
    );
  };

  // Grace Period Select
  const handleSelectGraceDays = async (days) => {
    const updated = { ...rentalDefaults, gracePeriodDays: days };
    setRentalDefaults(updated);
    await saveRentalDefaults(updated);
  };

  // Biometric Toggle
  const handleToggleBiometrics = async (val) => {
    if (val) {
      if (!biometricsSupport.available) {
        Alert.alert(
          'Biometrics Unavailable',
          `Please set up ${biometricsSupport.biometricType} in your device settings first.`
        );
        return;
      }
      const verified = await authenticateWithBiometrics(
        `Verify your identity to enable ${biometricsSupport.biometricType}`
      );
      if (!verified) {
        Alert.alert('Verification Failed', 'Could not enable biometric lock.');
        return;
      }
    }
    setBiometricEnabledState(val);
    await setBiometricEnabled(val);
  };

  // Save Profile
  const handleSaveProfile = async () => {
    if (!profileForm.fullName.trim()) {
      Alert.alert('Error', 'Full name cannot be empty.');
      return;
    }
    setSavingProfile(true);
    try {
      const updates = {
        full_name: profileForm.fullName.trim(),
        phone: profileForm.phone.trim(),
      };

      const { error: dbError } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      if (dbError) throw dbError;

      // Update auth metadata
      await supabase.auth.updateUser({
        data: { full_name: updates.full_name },
      });

      setProfile(prev => ({ ...prev, ...updates }));
      setEditProfileVisible(false);
      Alert.alert('Success', 'Profile updated successfully.');
    } catch (err) {
      Alert.alert('Update Failed', err.message || 'Could not update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  // Save Password
  const handleSavePassword = async () => {
    if (passwordForm.newPassword.length < 6) {
      Alert.alert('Invalid Password', 'Password must be at least 6 characters long.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      setPasswordForm({ newPassword: '', confirmPassword: '' });
      setChangePasswordVisible(false);
      Alert.alert('Success', 'Your password has been changed successfully.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not update password.');
    } finally {
      setSavingPassword(false);
    }
  };

  // Clear Cache
  const handleClearCache = async () => {
    Alert.alert(
      'Clear App Cache',
      'This will clear temporary files, statements, and cached documents. Your account and properties will remain safe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            const res = await clearAppCache();
            if (res.success) {
              Alert.alert('Cache Cleared', 'Temporary files have been cleared successfully.');
            } else {
              Alert.alert('Notice', 'App cache is already clean.');
            }
          },
        },
      ]
    );
  };

  // Sign Out
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of Tenura?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  // Delete Account
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action is permanent and will remove your profile, properties, and rental records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Security Verification',
              'For your security, please contact support at support@tenura.app with your registered email to process account deletion.',
              [
                {
                  text: 'Contact Support',
                  onPress: () => Linking.openURL('mailto:support@tenura.app?subject=Account%20Deletion%20Request'),
                },
                { text: 'Close', style: 'cancel' },
              ]
            );
          },
        },
      ]
    );
  };

  const getOrdinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="App Settings" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="App Settings" showBack onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 36 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. APPEARANCE & THEME ──────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primaryContainer }]}>
              <MaterialIcons name="palette" size={18} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Appearance & Theme</Text>
              <Text style={styles.sectionSubtitle}>Customize how Tenura looks</Text>
            </View>
          </View>

          <View style={styles.themeSelectorRow}>
            <TouchableOpacity
              style={[
                styles.themeOptionBtn,
                theme === 'light' && styles.themeOptionBtnActive,
              ]}
              onPress={() => setTheme('light')}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="light-mode"
                size={18}
                color={theme === 'light' ? colors.primary : colors.onSurface}
              />
              <Text
                style={[
                  styles.themeOptionText,
                  theme === 'light' && styles.themeOptionTextActive,
                ]}
              >
                Light
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.themeOptionBtn,
                theme === 'dark' && styles.themeOptionBtnActive,
              ]}
              onPress={() => setTheme('dark')}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="dark-mode"
                size={18}
                color={theme === 'dark' ? colors.primary : colors.onSurface}
              />
              <Text
                style={[
                  styles.themeOptionText,
                  theme === 'dark' && styles.themeOptionTextActive,
                ]}
              >
                Dark
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.themeOptionBtn,
                theme === 'system' && styles.themeOptionBtnActive,
              ]}
              onPress={() => setTheme('system')}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="settings-brightness"
                size={18}
                color={theme === 'system' ? colors.primary : colors.onSurface}
              />
              <Text
                style={[
                  styles.themeOptionText,
                  theme === 'system' && styles.themeOptionTextActive,
                ]}
              >
                System
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2. NOTIFICATIONS & ALERTS ──────────────────────────────── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
              <MaterialIcons name="notifications-active" size={18} color="#D97706" />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Notifications & Alerts</Text>
              <Text style={styles.sectionSubtitle}>Control your alerts and reminders</Text>
            </View>
          </View>

          {/* Event Toggles */}
          <View style={styles.settingRow}>
            <View style={styles.settingTextGroup}>
              <Text style={styles.settingLabel}>Rent Paid & Dues</Text>
              <Text style={styles.settingDesc}>Alert when tenants pay or rent is overdue</Text>
            </View>
            <Switch
              value={notifications.rentAlerts}
              onValueChange={() => toggleNotification('rentAlerts')}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingTextGroup}>
              <Text style={styles.settingLabel}>Resident Issues</Text>
              <Text style={styles.settingDesc}>Instant alerts when a tenant logs an issue</Text>
            </View>
            <Switch
              value={notifications.maintenanceAlerts}
              onValueChange={() => toggleNotification('maintenanceAlerts')}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingTextGroup}>
              <Text style={styles.settingLabel}>Lease Expiry Notice</Text>
              <Text style={styles.settingDesc}>30-day notice before tenant leases end</Text>
            </View>
            <Switch
              value={notifications.leaseExpiryAlerts}
              onValueChange={() => toggleNotification('leaseExpiryAlerts')}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.divider} />

          {/* Channel Toggles */}
          <Text style={styles.subSectionTitle}>Delivery Channels</Text>
          <View style={styles.channelsRow}>
            <TouchableOpacity
              style={[
                styles.channelPill,
                notifications.pushEnabled && styles.channelPillActive,
              ]}
              onPress={() => toggleNotification('pushEnabled')}
            >
              <MaterialIcons
                name="smartphone"
                size={16}
                color={notifications.pushEnabled ? colors.primary : colors.onSurface}
              />
              <Text
                style={[
                  styles.channelText,
                  notifications.pushEnabled && styles.channelTextActive,
                ]}
              >
                Push
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.channelPill,
                notifications.emailEnabled && styles.channelPillActive,
              ]}
              onPress={() => toggleNotification('emailEnabled')}
            >
              <MaterialIcons
                name="mail"
                size={16}
                color={notifications.emailEnabled ? colors.primary : colors.onSurface}
              />
              <Text
                style={[
                  styles.channelText,
                  notifications.emailEnabled && styles.channelTextActive,
                ]}
              >
                Email
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.channelPill,
                notifications.whatsappEnabled && styles.channelPillActive,
              ]}
              onPress={() => toggleNotification('whatsappEnabled')}
            >
              <MaterialIcons
                name="chat"
                size={16}
                color={notifications.whatsappEnabled ? '#16A34A' : colors.onSurface}
              />
              <Text
                style={[
                  styles.channelText,
                  notifications.whatsappEnabled && { color: '#16A34A', fontFamily: fonts.manropeBold },
                ]}
              >
                WhatsApp
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 3. RENT & PROPERTY COLLECTION ──────────────────────────── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#DCFCE7' }]}>
              <MaterialIcons name="event-available" size={18} color="#15803D" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Rent & Property Collection</Text>
              <Text style={styles.sectionSubtitle}>
                Configure rent collection cycle & billing defaults
              </Text>
            </View>
          </View>

          <Text style={styles.fieldLabel}>Rent Collection Schedule</Text>
          <View style={styles.pillsRow}>
            {DUE_DAY_PRESETS.map((day) => {
              const active =
                !showCustomDayInput &&
                rentalDefaults.collectionMode !== 'window' &&
                rentalDefaults.dueDay === day;
              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.presetDayBtn, active && styles.presetDayBtnActive]}
                  onPress={() => handleSelectDueDay(day)}
                >
                  <Text style={[styles.presetDayText, active && styles.presetDayTextActive]}>
                    {day}
                    {getOrdinal(day)}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[
                styles.presetDayBtn,
                (showCustomDayInput || rentalDefaults.collectionMode === 'window') &&
                  styles.presetDayBtnActive,
              ]}
              onPress={() => setShowCustomDayInput(true)}
            >
              <Text
                style={[
                  styles.presetDayText,
                  (showCustomDayInput || rentalDefaults.collectionMode === 'window') &&
                    styles.presetDayTextActive,
                ]}
              >
                Custom
              </Text>
            </TouchableOpacity>
          </View>

          {showCustomDayInput ? (
            <View style={styles.customCollectionPanel}>
              {/* Mode Switcher: Collection Window vs Single Day */}
              <View style={styles.customModeTabs}>
                <TouchableOpacity
                  style={[
                    styles.customModeTab,
                    customTab === 'window' && styles.customModeTabActive,
                  ]}
                  onPress={() => setCustomTab('window')}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name="date-range"
                    size={15}
                    color={customTab === 'window' ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.customModeTabText,
                      customTab === 'window' && styles.customModeTabTextActive,
                    ]}
                  >
                    Collection Window
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.customModeTab,
                    customTab === 'single' && styles.customModeTabActive,
                  ]}
                  onPress={() => setCustomTab('single')}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name="today"
                    size={15}
                    color={customTab === 'single' ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.customModeTabText,
                      customTab === 'single' && styles.customModeTabTextActive,
                    ]}
                  >
                    Single Due Day
                  </Text>
                </TouchableOpacity>
              </View>

              {customTab === 'window' ? (
                <View style={styles.windowConfigContainer}>
                  <Text style={styles.windowSubLabel}>Quick Collection Presets</Text>
                  <View style={styles.windowPresetsWrap}>
                    {COLLECTION_WINDOW_PRESETS.map((preset) => {
                      const isPresetActive =
                        rentalDefaults.collectionMode === 'window' &&
                        windowStartMonth === preset.startMonth &&
                        Number(windowStartDayInput) === preset.startDay &&
                        Number(windowEndDayInput) === preset.endDay;
                      return (
                        <TouchableOpacity
                          key={preset.label}
                          style={[
                            styles.windowPresetChip,
                            isPresetActive && styles.windowPresetChipActive,
                          ]}
                          onPress={() => handleSelectWindowPreset(preset)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.windowPresetChipText,
                              isPresetActive && styles.windowPresetChipTextActive,
                            ]}
                          >
                            {preset.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Start Collection Row */}
                  <View style={styles.windowFieldBlock}>
                    <Text style={styles.windowSubLabel}>Start Collecting From</Text>
                    <View style={styles.windowInputRow}>
                      <View style={styles.monthToggleGroup}>
                        <TouchableOpacity
                          style={[
                            styles.monthToggleBtn,
                            windowStartMonth === 'previous' && styles.monthToggleBtnActive,
                          ]}
                          onPress={() => setWindowStartMonth('previous')}
                        >
                          <Text
                            style={[
                              styles.monthToggleText,
                              windowStartMonth === 'previous' && styles.monthToggleTextActive,
                            ]}
                          >
                            Last Month
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.monthToggleBtn,
                            windowStartMonth === 'current' && styles.monthToggleBtnActive,
                          ]}
                          onPress={() => setWindowStartMonth('current')}
                        >
                          <Text
                            style={[
                              styles.monthToggleText,
                              windowStartMonth === 'current' && styles.monthToggleTextActive,
                            ]}
                          >
                            Current Month
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <TextInput
                        style={styles.windowDayInput}
                        placeholder="Day"
                        placeholderTextColor={colors.outline}
                        keyboardType="number-pad"
                        maxLength={2}
                        value={windowStartDayInput}
                        onChangeText={setWindowStartDayInput}
                      />
                    </View>
                  </View>

                  {/* End Collection Row */}
                  <View style={styles.windowFieldBlock}>
                    <Text style={styles.windowSubLabel}>Collect Until (Final Due Date)</Text>
                    <View style={styles.windowInputRow}>
                      <View style={styles.currentMonthFixedBadge}>
                        <MaterialIcons name="event" size={14} color={colors.primary} />
                        <Text style={styles.currentMonthFixedText}>Current Month</Text>
                      </View>

                      <TextInput
                        style={styles.windowDayInput}
                        placeholder="Day"
                        placeholderTextColor={colors.outline}
                        keyboardType="number-pad"
                        maxLength={2}
                        value={windowEndDayInput}
                        onChangeText={setWindowEndDayInput}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.applyWindowBtn}
                    onPress={handleCustomWindowSubmit}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.customDaySaveText}>Apply Collection Period</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.customDayBox}>
                  <TextInput
                    style={styles.customDayInput}
                    placeholder="Day (1–31)"
                    placeholderTextColor={colors.outline}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={customDayInput}
                    onChangeText={setCustomDayInput}
                  />
                  <TouchableOpacity style={styles.customDaySaveBtn} onPress={handleCustomDaySubmit}>
                    <Text style={styles.customDaySaveText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : null}

          {rentalDefaults.collectionMode === 'window' ? (
            <Text style={styles.captionText}>
              Rent collection runs from the{' '}
              <Text style={{ fontFamily: fonts.manropeBold, color: colors.primary }}>
                {rentalDefaults.collectionStartDay}
                {getOrdinal(rentalDefaults.collectionStartDay)} of{' '}
                {rentalDefaults.collectionStartMonth === 'previous' ? 'last month' : 'current month'}
              </Text>{' '}
              to the{' '}
              <Text style={{ fontFamily: fonts.manropeBold, color: colors.primary }}>
                {rentalDefaults.collectionEndDay}
                {getOrdinal(rentalDefaults.collectionEndDay)} of current month
              </Text>{' '}
              when onboarding new residents.
            </Text>
          ) : (
            <Text style={styles.captionText}>
              Rent will default to the{' '}
              <Text style={{ fontFamily: fonts.manropeBold, color: colors.primary }}>
                {rentalDefaults.dueDay}
                {getOrdinal(rentalDefaults.dueDay)}
              </Text>{' '}
              of each month when onboarding new residents.
            </Text>
          )}

          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Overdue Grace Period</Text>
          <View style={styles.pillsRow}>
            {GRACE_DAYS_OPTIONS.map((days) => {
              const active = rentalDefaults.gracePeriodDays === days;
              return (
                <TouchableOpacity
                  key={days}
                  style={[styles.presetDayBtn, active && styles.presetDayBtnActive]}
                  onPress={() => handleSelectGraceDays(days)}
                >
                  <Text style={[styles.presetDayText, active && styles.presetDayTextActive]}>
                    {days === 0 ? 'None' : `${days} Days`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── 4. ACCOUNT & SECURITY ─────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#E0E7FF' }]}>
              <MaterialIcons name="security" size={18} color="#4338CA" />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Account & Security</Text>
              <Text style={styles.sectionSubtitle}>Manage login, profile, and biometrics</Text>
            </View>
          </View>

          {/* Edit Profile Entry */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {
              setProfileForm(profile);
              setEditProfileVisible(true);
            }}
          >
            <View style={styles.actionLeft}>
              <MaterialIcons name="person" size={20} color={colors.onSurface} />
              <View>
                <Text style={styles.actionTitle}>Profile Details</Text>
                <Text style={styles.actionSubtitle}>
                  {profile.fullName || 'Set name'} · {profile.phone || 'Set phone'}
                </Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Change Password Entry */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setChangePasswordVisible(true)}
          >
            <View style={styles.actionLeft}>
              <MaterialIcons name="lock-outline" size={20} color={colors.onSurface} />
              <View>
                <Text style={styles.actionTitle}>Change Password</Text>
                <Text style={styles.actionSubtitle}>Update your account password</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Biometric Toggle */}
          <View style={styles.settingRow}>
            <View style={styles.actionLeft}>
              <MaterialIcons
                name={
                  biometricsSupport.biometricType.includes('Face')
                    ? 'face'
                    : 'fingerprint'
                }
                size={20}
                color={colors.onSurface}
              />
              <View>
                <Text style={styles.settingLabel}>{biometricsSupport.biometricType} Lock</Text>
                <Text style={styles.settingDesc}>
                  {biometricEnabled
                    ? `Enabled for quick authentication`
                    : `Lock Tenura with device ${biometricsSupport.biometricType}`}
                </Text>
              </View>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={handleToggleBiometrics}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* ── 5. SUPPORT & ABOUT ─────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#F3E8FF' }]}>
              <MaterialIcons name="help-outline" size={18} color="#7E22CE" />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Support & About</Text>
              <Text style={styles.sectionSubtitle}>Help desk, legal info, and cache</Text>
            </View>
          </View>

          {/* WhatsApp Support */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => Linking.openURL('https://wa.me/919876543210?text=Hello%20Tenura%20Team')}
          >
            <View style={styles.actionLeft}>
              <MaterialIcons name="chat-bubble-outline" size={20} color="#16A34A" />
              <View>
                <Text style={styles.actionTitle}>WhatsApp Help Desk</Text>
                <Text style={styles.actionSubtitle}>Chat directly with our support team</Text>
              </View>
            </View>
            <MaterialIcons name="open-in-new" size={18} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* FAQs */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setFaqModalVisible(true)}
          >
            <View style={styles.actionLeft}>
              <MaterialIcons name="quiz" size={20} color={colors.onSurface} />
              <View>
                <Text style={styles.actionTitle}>Frequently Asked Questions</Text>
                <Text style={styles.actionSubtitle}>Rental dues, security deposits, and tips</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Terms & Privacy */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {
              setLegalModalType('terms');
              setLegalModalVisible(true);
            }}
          >
            <View style={styles.actionLeft}>
              <MaterialIcons name="article" size={20} color={colors.onSurface} />
              <View>
                <Text style={styles.actionTitle}>Terms of Service</Text>
                <Text style={styles.actionSubtitle}>Read our user agreement</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {
              setLegalModalType('privacy');
              setLegalModalVisible(true);
            }}
          >
            <View style={styles.actionLeft}>
              <MaterialIcons name="privacy-tip" size={20} color={colors.onSurface} />
              <View>
                <Text style={styles.actionTitle}>Privacy Policy</Text>
                <Text style={styles.actionSubtitle}>How your data is protected</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Clear Cache */}
          <TouchableOpacity style={styles.actionRow} onPress={handleClearCache}>
            <View style={styles.actionLeft}>
              <MaterialIcons name="cleaning-services" size={20} color={colors.onSurface} />
              <View>
                <Text style={styles.actionTitle}>Clear App Cache</Text>
                <Text style={styles.actionSubtitle}>Free storage from statements & receipts</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* App Version Info */}
          <View style={[styles.settingRow, { paddingVertical: 8 }]}>
            <Text style={styles.versionLabel}>Tenura Version</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>v1.0.0 (Build 100)</Text>
            </View>
          </View>
        </View>

        {/* ── DANGER / ACCOUNT ACTIONS ──────────────────────────────── */}
        <View style={styles.accountActionsCard}>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
            <MaterialIcons name="logout" size={18} color={colors.primary} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteAccountBtn} onPress={handleDeleteAccount} activeOpacity={0.8}>
            <MaterialIcons name="delete-forever" size={18} color={colors.error} />
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── MODAL: EDIT PROFILE ───────────────────────────────────────── */}
      <Modal visible={editProfileVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile Details</Text>
              <TouchableOpacity onPress={() => setEditProfileVisible(false)}>
                <MaterialIcons name="close" size={22} color={colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.modalInput}
              value={profileForm.fullName}
              onChangeText={(t) => setProfileForm(p => ({ ...p, fullName: t }))}
              placeholder="e.g. Dinesh B K"
              placeholderTextColor={colors.outline}
            />

            <Text style={styles.inputLabel}>Phone Number</Text>
            <TextInput
              style={styles.modalInput}
              value={profileForm.phone}
              onChangeText={(t) => setProfileForm(p => ({ ...p, phone: t }))}
              placeholder="+91 98765 43210"
              placeholderTextColor={colors.outline}
              keyboardType="phone-pad"
            />

            <Text style={styles.inputLabel}>Contact Email (Read-only)</Text>
            <TextInput
              style={[styles.modalInput, styles.readOnlyInput]}
              value={profileForm.email}
              editable={false}
              placeholder="user@example.com"
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditProfileVisible(false)}
                disabled={savingProfile}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveProfile}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Profile</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: CHANGE PASSWORD ────────────────────────────────────── */}
      <Modal visible={changePasswordVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setChangePasswordVisible(false)}>
                <MaterialIcons name="close" size={22} color={colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.passwordInputContainer}>
              <TextInput
                style={styles.passwordTextInput}
                value={passwordForm.newPassword}
                onChangeText={(t) => setPasswordForm(p => ({ ...p, newPassword: t }))}
                placeholder="At least 6 characters"
                placeholderTextColor={colors.outline}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 8 }}>
                <MaterialIcons
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={20}
                  color={colors.outline}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Confirm New Password</Text>
            <TextInput
              style={styles.modalInput}
              value={passwordForm.confirmPassword}
              onChangeText={(t) => setPasswordForm(p => ({ ...p, confirmPassword: t }))}
              placeholder="Re-enter new password"
              placeholderTextColor={colors.outline}
              secureTextEntry={!showPassword}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setChangePasswordVisible(false)}
                disabled={savingPassword}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSavePassword}
                disabled={savingPassword}
              >
                {savingPassword ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: FAQ ────────────────────────────────────────────────── */}
      <Modal visible={faqModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Frequently Asked Questions</Text>
              <TouchableOpacity onPress={() => setFaqModalVisible(false)}>
                <MaterialIcons name="close" size={22} color={colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How do I onboard a new resident?</Text>
                <Text style={styles.faqAnswer}>
                  Go to Residents tab → tap "Add Resident" → enter tenant details, property, rent amount, and lease term. Once created, they will receive an invitation to access Tenura.
                </Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How do rent payments get recorded?</Text>
                <Text style={styles.faqAnswer}>
                  Rent statements are generated automatically on the due date. Tenants can pay via UPI/Card, or you can record direct payments from the Finance tab.
                </Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How does the security deposit work?</Text>
                <Text style={styles.faqAnswer}>
                  Under Finance → Security Deposit, you can view the initial deposit collected, log approved maintenance deductions, and process refunds when a resident moves out.
                </Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={styles.faqQuestion}>How can I export rent records?</Text>
                <Text style={styles.faqAnswer}>
                  In Rent Collection, tap the export icon at the top to export statements as formatted PDFs or Excel-compatible CSVs.
                </Text>
              </View>
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setFaqModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: LEGAL (TERMS & PRIVACY) ────────────────────────────── */}
      <Modal visible={legalModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {legalModalType === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
              </Text>
              <TouchableOpacity onPress={() => setLegalModalVisible(false)}>
                <MaterialIcons name="close" size={22} color={colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {legalModalType === 'terms' ? (
                <Text style={styles.legalBody}>
                  Welcome to Tenura. By using our property management platform, you agree to comply with our Terms of Service.{'\n\n'}
                  1. <Text style={{ fontFamily: fonts.manropeBold }}>Account Security:</Text> You are responsible for safeguarding your login credentials and ensuring all rental data provided is authentic.{'\n\n'}
                  2. <Text style={{ fontFamily: fonts.manropeBold }}>Payments & Settlements:</Text> Tenura provides tools to log and track rental obligations. Tenura does not hold escrow unless explicitly specified under partner services.{'\n\n'}
                  3. <Text style={{ fontFamily: fonts.manropeBold }}>Data Ownership:</Text> All property and resident records belong to you. You may export or delete your records at any time.{'\n\n'}
                  Last updated: October 2026.
                </Text>
              ) : (
                <Text style={styles.legalBody}>
                  At Tenura, your privacy and data security are our highest priority.{'\n\n'}
                  1. <Text style={{ fontFamily: fonts.manropeBold }}>Data Collection:</Text> We collect necessary property, contact, and billing details solely to facilitate property management operations.{'\n\n'}
                  2. <Text style={{ fontFamily: fonts.manropeBold }}>Encryption & Security:</Text> All data in transit and at rest is secured via enterprise-grade encryption backed by Supabase infrastructure.{'\n\n'}
                  3. <Text style={{ fontFamily: fonts.manropeBold }}>Third-Party Sharing:</Text> We never sell your personal data or your tenants' data to third-party advertisers.{'\n\n'}
                  Last updated: October 2026.
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setLegalModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      gap: 16,
    },

    // ── Cards & Headers ──────────────────────────────────────────
    sectionCard: {
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.06)',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionTitle: {
      fontFamily: fonts.manropeBold,
      fontSize: 15.5,
      color: colors.onSurface,
      letterSpacing: -0.2,
    },
    sectionSubtitle: {
      fontFamily: fonts.interMedium,
      fontSize: 12.5,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },

    // ── Theme Selector ───────────────────────────────────────────
    themeSelectorRow: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 12,
      padding: 4,
      gap: 6,
    },
    themeOptionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 8,
    },
    themeOptionBtnActive: {
      backgroundColor: colors.surface,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
    },
    themeOptionText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 13,
      color: colors.onSurface,
    },
    themeOptionTextActive: {
      fontFamily: fonts.manropeBold,
      color: colors.primary,
    },

    // ── Settings Rows & Dividers ─────────────────────────────────
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    settingTextGroup: {
      flex: 1,
      paddingRight: 12,
    },
    settingLabel: {
      fontFamily: fonts.manropeBold,
      fontSize: 14.5,
      color: colors.onSurface,
    },
    settingDesc: {
      fontFamily: fonts.interMedium,
      fontSize: 12.5,
      color: colors.onSurfaceVariant,
      marginTop: 2,
      lineHeight: 18,
    },
    divider: {
      height: 1,
      backgroundColor: colors.outlineVariant || 'rgba(0,0,0,0.06)',
      marginVertical: 10,
    },

    // ── Subsections & Channels ───────────────────────────────────
    subSectionTitle: {
      fontFamily: fonts.manropeBold,
      fontSize: 13.5,
      color: colors.onSurface,
      marginTop: 8,
      marginBottom: 10,
    },
    channelsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    channelPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.surfaceContainerLow,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.06)',
    },
    channelPillActive: {
      backgroundColor: colors.primaryContainer,
      borderColor: colors.primary,
    },
    channelText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 12.5,
      color: colors.onSurface,
    },
    channelTextActive: {
      fontFamily: fonts.manropeBold,
      color: colors.primary,
    },

    // ── Rental Defaults (Pills & Inputs) ─────────────────────────
    fieldLabel: {
      fontFamily: fonts.manropeBold,
      fontSize: 13.5,
      color: colors.onSurface,
      marginBottom: 8,
    },
    pillsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8,
    },
    presetDayBtn: {
      flex: 1,
      minWidth: 58,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainerLow,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.06)',
    },
    presetDayBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    presetDayText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 12.5,
      color: colors.onSurface,
    },
    presetDayTextActive: {
      fontFamily: fonts.manropeBold,
      color: '#FFFFFF',
    },
    customCollectionPanel: {
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 12,
      padding: 12,
      marginTop: 4,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.08)',
    },
    customModeTabs: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 10,
      padding: 3,
      gap: 4,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.06)',
    },
    customModeTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 8,
    },
    customModeTabActive: {
      backgroundColor: colors.primaryContainer,
    },
    customModeTabText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 12.5,
      color: colors.onSurfaceVariant,
    },
    customModeTabTextActive: {
      fontFamily: fonts.manropeBold,
      color: colors.primary,
    },
    windowConfigContainer: {
      gap: 10,
    },
    windowSubLabel: {
      fontFamily: fonts.manropeBold,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginBottom: 4,
    },
    windowPresetsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 2,
    },
    windowPresetChip: {
      backgroundColor: colors.surfaceContainerLowest,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.08)',
    },
    windowPresetChipActive: {
      backgroundColor: colors.primaryContainer,
      borderColor: colors.primary,
    },
    windowPresetChipText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 11.5,
      color: colors.onSurface,
    },
    windowPresetChipTextActive: {
      fontFamily: fonts.manropeBold,
      color: colors.primary,
    },
    windowFieldBlock: {
      gap: 4,
    },
    windowInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    monthToggleGroup: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 8,
      padding: 3,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.08)',
    },
    monthToggleBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 7,
      borderRadius: 6,
    },
    monthToggleBtnActive: {
      backgroundColor: colors.primary,
    },
    monthToggleText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 12,
      color: colors.onSurface,
    },
    monthToggleTextActive: {
      fontFamily: fonts.manropeBold,
      color: '#FFFFFF',
    },
    windowDayInput: {
      width: 76,
      backgroundColor: colors.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.1)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
      fontFamily: fonts.manropeBold,
      color: colors.onSurface,
      textAlign: 'center',
    },
    currentMonthFixedBadge: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.08)',
    },
    currentMonthFixedText: {
      fontFamily: fonts.manropeBold,
      fontSize: 12.5,
      color: colors.onSurface,
    },
    applyWindowBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 11,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    customDayBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    customDayInput: {
      flex: 1,
      backgroundColor: colors.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.1)',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      fontFamily: fonts.interMedium,
      color: colors.onSurface,
    },
    customDaySaveBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
    customDaySaveText: {
      fontFamily: fonts.manropeBold,
      fontSize: 13,
      color: '#FFFFFF',
    },
    captionText: {
      fontFamily: fonts.interMedium,
      fontSize: 12.5,
      color: colors.onSurfaceVariant,
      marginTop: 4,
      marginBottom: 6,
      lineHeight: 18,
    },

    // ── Action Rows ──────────────────────────────────────────────
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    actionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
      paddingRight: 8,
    },
    actionTitle: {
      fontFamily: fonts.manropeBold,
      fontSize: 14.5,
      color: colors.onSurface,
    },
    actionSubtitle: {
      fontFamily: fonts.interMedium,
      fontSize: 12.5,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },

    // ── Version Badge ────────────────────────────────────────────
    versionLabel: {
      fontFamily: fonts.interSemiBold,
      fontSize: 13.5,
      color: colors.onSurface,
    },
    versionBadge: {
      backgroundColor: colors.surfaceContainerHighest,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    versionBadgeText: {
      fontFamily: fonts.manropeBold,
      fontSize: 12,
      color: colors.onSurface,
    },

    // ── Bottom Account Actions ───────────────────────────────────
    accountActionsCard: {
      gap: 12,
      marginTop: 4,
      marginBottom: 16,
    },
    signOutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.08)',
      paddingVertical: 14,
      borderRadius: 12,
    },
    signOutText: {
      fontFamily: fonts.manropeBold,
      fontSize: 14,
      color: colors.primary,
    },
    deleteAccountBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
    },
    deleteAccountText: {
      fontFamily: fonts.interMedium,
      fontSize: 13,
      color: colors.error,
    },

    // ── Modals ───────────────────────────────────────────────────
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
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
      fontSize: 16,
      color: colors.onSurface,
    },
    inputLabel: {
      fontFamily: fonts.manropeBold,
      fontSize: 13,
      color: colors.onSurface,
      marginTop: 8,
      marginBottom: 4,
    },
    modalInput: {
      backgroundColor: colors.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.1)',
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: fonts.interMedium,
      color: colors.onSurface,
      marginBottom: 8,
    },
    readOnlyInput: {
      backgroundColor: colors.surfaceContainerLow,
      color: colors.onSurfaceVariant,
    },
    passwordInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.1)',
      borderRadius: 10,
      paddingLeft: 14,
      paddingRight: 6,
      marginBottom: 8,
    },
    passwordTextInput: {
      flex: 1,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: fonts.interMedium,
      color: colors.onSurface,
    },
    modalButtonsRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    cancelBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.outlineVariant || 'rgba(0,0,0,0.12)',
    },
    cancelBtnText: {
      fontFamily: fonts.manropeBold,
      fontSize: 14,
      color: colors.onSurface,
    },
    saveBtn: {
      flex: 2,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 10,
    },
    saveBtnText: {
      fontFamily: fonts.manropeBold,
      fontSize: 14,
      color: '#FFFFFF',
    },
    faqItem: {
      marginBottom: 16,
    },
    faqQuestion: {
      fontFamily: fonts.manropeBold,
      fontSize: 14.5,
      color: colors.onSurface,
      marginBottom: 4,
    },
    faqAnswer: {
      fontFamily: fonts.interMedium,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      lineHeight: 19,
    },
    legalBody: {
      fontFamily: fonts.interRegular,
      fontSize: 13.5,
      color: colors.onSurface,
      lineHeight: 20,
    },
    modalCloseBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    modalCloseBtnText: {
      fontFamily: fonts.manropeBold,
      fontSize: 14,
      color: '#FFFFFF',
    },
  });
