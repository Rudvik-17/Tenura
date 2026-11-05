import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';
import SplashAnimation from './src/components/SplashAnimation';
import { requestPermissions } from './src/lib/notifications';

// Prevent the native splash screen from auto-hiding before fonts and assets are ready
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const [fontTimeout, setFontTimeout] = useState(false);
  const [splashActive, setSplashActive] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    requestPermissions();
  }, []);

  const handleSplashFinish = React.useCallback(() => {
    setSplashActive(false);
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontTimeout) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontTimeout]);

  // Hold render until fonts are ready or 3s timeout has passed.
  if (!fontsLoaded && !fontTimeout) {
    return null;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <View style={{ flex: 1, position: 'relative' }}>
          <RootNavigator />
          {splashActive && (
            <SplashAnimation onFinish={handleSplashFinish} />
          )}
        </View>
      </AuthProvider>
    </ThemeProvider>
  );
}

