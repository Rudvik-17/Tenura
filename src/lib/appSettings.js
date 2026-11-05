import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as FileSystem from 'expo-file-system/legacy';

export const NOTIFICATION_SETTINGS_KEY = '@tenura_notification_settings';
export const RENTAL_DEFAULTS_KEY = '@tenura_rental_defaults';
export const BIOMETRIC_KEY = '@tenura_biometric_enabled';

export const DEFAULT_NOTIFICATION_SETTINGS = {
  rentAlerts: true,
  overdueAlerts: true,
  maintenanceAlerts: true,
  leaseExpiryAlerts: true,
  pushEnabled: true,
  emailEnabled: true,
  whatsappEnabled: false,
};

export const DEFAULT_RENTAL_DEFAULTS = {
  dueDay: 5, // 5th of every month
  collectionMode: 'single', // 'single' | 'window'
  collectionStartMonth: 'previous', // 'previous' | 'current'
  collectionStartDay: 25, // e.g., 25th of last month
  collectionEndDay: 10, // e.g., 10th of current month
  gracePeriodDays: 3, // 3 days grace
  autoLateFee: false,
  lateFeeAmount: 500,
};

// ── Notification Settings ───────────────────────────────────────────────────

export async function getNotificationSettings() {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(raw) };
  } catch (err) {
    console.warn('Error reading notification settings:', err);
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

export async function saveNotificationSettings(settings) {
  try {
    await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.error('Error saving notification settings:', err);
    return false;
  }
}

// ── Rental Defaults (Due Date & Grace Period) ───────────────────────────────

export async function getRentalDefaults() {
  try {
    const raw = await AsyncStorage.getItem(RENTAL_DEFAULTS_KEY);
    if (!raw) return { ...DEFAULT_RENTAL_DEFAULTS };
    return { ...DEFAULT_RENTAL_DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    console.warn('Error reading rental defaults:', err);
    return { ...DEFAULT_RENTAL_DEFAULTS };
  }
}

export async function saveRentalDefaults(defaults) {
  try {
    await AsyncStorage.setItem(RENTAL_DEFAULTS_KEY, JSON.stringify(defaults));
    return true;
  } catch (err) {
    console.error('Error saving rental defaults:', err);
    return false;
  }
}

// ── Biometric Lock (Face ID / Fingerprint) ───────────────────────────────────

export async function checkBiometricsSupport() {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

    let biometricType = 'Biometrics';
    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      biometricType = 'Face ID';
    } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      biometricType = 'Touch ID / Fingerprint';
    }

    return {
      available: hasHardware && isEnrolled,
      hasHardware,
      isEnrolled,
      biometricType,
    };
  } catch (err) {
    console.warn('Error checking biometrics:', err);
    return {
      available: false,
      hasHardware: false,
      isEnrolled: false,
      biometricType: 'Biometrics',
    };
  }
}

export async function getBiometricEnabled() {
  try {
    const val = await AsyncStorage.getItem(BIOMETRIC_KEY);
    return val === 'true';
  } catch (err) {
    console.warn('Error reading biometric preference:', err);
    return false;
  }
}

export async function setBiometricEnabled(enabled) {
  try {
    await AsyncStorage.setItem(BIOMETRIC_KEY, enabled ? 'true' : 'false');
    return true;
  } catch (err) {
    console.error('Error saving biometric preference:', err);
    return false;
  }
}

export async function authenticateWithBiometrics(reason = 'Verify your identity to proceed') {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use Device Passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch (err) {
    console.warn('Biometric authentication failed:', err);
    return false;
  }
}

// ── App Cache Management ────────────────────────────────────────────────────

export async function clearAppCache() {
  try {
    if (FileSystem.cacheDirectory) {
      const files = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
      for (const file of files) {
        // Clean cache files safely
        try {
          await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${file}`, { idempotent: true });
        } catch {}
      }
    }
    return { success: true };
  } catch (err) {
    console.error('Error clearing app cache:', err);
    return { success: false, error: err.message };
  }
}
