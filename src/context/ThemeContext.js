import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors } from '../theme/colors';

const ThemeContext = createContext();

const THEME_KEY = '@estatelogic_theme';

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState('light');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStoredTheme() {
      try {
        const stored = await AsyncStorage.getItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark') {
          setThemeState(stored);
        } else if (systemScheme === 'dark') {
          setThemeState('dark');
        }
      } catch (err) {
        console.error('Failed to load theme preference:', err);
      } finally {
        setLoading(false);
      }
    }
    loadStoredTheme();
  }, [systemScheme]);

  const setTheme = async (newTheme) => {
    if (newTheme !== 'light' && newTheme !== 'dark') return;
    try {
      setThemeState(newTheme);
      await AsyncStorage.setItem(THEME_KEY, newTheme);
    } catch (err) {
      console.error('Failed to save theme preference:', err);
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
  };

  const colors = theme === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ theme, colors, setTheme, toggleTheme, loading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
