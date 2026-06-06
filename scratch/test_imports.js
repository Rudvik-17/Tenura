const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../src');

// Mock React Native and other modules so we can load files in pure Node
const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock dependencies
const mocks = {
  'react-native': {
    StyleSheet: {
      create: (obj) => obj,
    },
    Platform: { OS: 'ios' },
    Dimensions: {
      get: () => ({ width: 375, height: 812 }),
    },
    Animated: {
      Value: function() {
        return {
          interpolate: () => ({}),
        };
      },
      timing: () => ({ start: (cb) => cb && cb() }),
      spring: () => ({ start: (cb) => cb && cb() }),
      sequence: () => ({ start: (cb) => cb && cb() }),
      parallel: () => ({ start: (cb) => cb && cb() }),
      delay: () => ({ start: (cb) => cb && cb() }),
      View: 'View',
    },
    View: 'View',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    TextInput: 'TextInput',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    RefreshControl: 'RefreshControl',
    Alert: { alert: () => {} },
    StatusBar: 'StatusBar',
  },
  'react': {
    createContext: () => ({ Provider: 'Provider' }),
    useContext: () => ({ colors: {} }),
    useState: (val) => [val, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: {} }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  },
  'expo-font': {
    useFonts: () => [true],
  },
  '@expo-google-fonts/manrope': {},
  '@expo-google-fonts/inter': {},
  '@react-native-async-storage/async-storage': {
    getItem: () => Promise.resolve('light'),
    setItem: () => Promise.resolve(),
  },
  'react-native-safe-area-context': {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  },
  '@react-navigation/native': {
    useFocusEffect: (fn) => fn(),
    NavigationContainer: 'NavigationContainer',
  },
  '@react-navigation/bottom-tabs': {
    createBottomTabNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }),
  },
  '@react-navigation/stack': {
    createStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }),
  },
  '@expo/vector-icons': {
    MaterialIcons: 'MaterialIcons',
  },
  '@supabase/supabase-js': {
    createClient: () => ({}),
  },
};

Module.prototype.require = function(id) {
  if (mocks[id]) {
    return mocks[id];
  }
  // Mock any path containing supabase, notifications, expo-print, expo-sharing, expo-image-picker
  if (
    id.includes('supabase') || 
    id.includes('notifications') || 
    id.includes('expo-print') || 
    id.includes('expo-sharing') || 
    id.includes('expo-image-picker') ||
    id.includes('async-storage')
  ) {
    return {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: {}, error: null }),
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
        auth: {
          signOut: () => Promise.resolve({ error: null }),
        },
      },
      requestPermissions: () => {},
    };
  }
  return originalRequire.apply(this, arguments);
};

function walk(dir, filter, done) {
  let results = [];
  fs.readdir(dir, (err, list) => {
    if (err) return done(err);
    let pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(file => {
      file = path.resolve(dir, file);
      fs.stat(file, (err, stat) => {
        if (stat && stat.isDirectory()) {
          walk(file, filter, (err, res) => {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          if (!filter || filter(file)) {
            results.push(file);
          }
          if (!--pending) done(null, results);
        }
      });
    });
  });
}

walk(SRC_DIR, (file) => file.endsWith('.js'), (err, files) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  files.forEach(file => {
    const relative = path.relative(SRC_DIR, file);
    try {
      require(file);
    } catch (e) {
      // We only care about ReferenceError or SyntaxError related to colors
      if (e.message.includes('colors')) {
        console.log(`\n[COLOR REFERENCE ERROR] ${relative}`);
        console.error(e);
      }
    }
  });
  console.log('\nImport test complete.');
});
