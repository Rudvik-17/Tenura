import React from 'react';
import { Platform, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../theme/typography';

import TenantDashboard from '../screens/tenant/TenantDashboard';
import RentalAgreementScreen from '../screens/tenant/RentalAgreementScreen';
import PaymentHistoryScreen from '../screens/tenant/PaymentHistoryScreen';
import RentPaymentScreen from '../screens/tenant/RentPaymentScreen';
import UtilityBillsScreen from '../screens/tenant/UtilityBillsScreen';
import PaymentSuccessScreen from '../screens/tenant/PaymentSuccessScreen';
import MaintenanceRequestScreen from '../screens/tenant/MaintenanceRequestScreen';
import IssueMessagesScreen from '../screens/shared/IssueMessagesScreen';
import MenuScreen from '../screens/tenant/MenuScreen';
import CommunityScreen from '../screens/tenant/CommunityScreen';
import OfficeInfoScreen from '../screens/tenant/OfficeInfoScreen';
import AnnouncementsScreen from '../screens/tenant/AnnouncementsScreen';
import MessagesAlertsScreen from '../screens/tenant/MessagesAlertsScreen';
import ShipPlayScreen from '../screens/tenant/ShipPlayScreen';

const Tab = createBottomTabNavigator();
const DashboardStack = createStackNavigator();
const PaymentsStack = createStackNavigator();
const MaintenanceStack = createStackNavigator();
const MenuStack = createStackNavigator();

function DashboardStackNav() {
  return (
    <DashboardStack.Navigator screenOptions={{ headerShown: false }}>
      <DashboardStack.Screen name="TenantDashboard" component={TenantDashboard} />
      <DashboardStack.Screen name="RentalAgreement" component={RentalAgreementScreen} />
      <DashboardStack.Screen name="UtilityBills" component={UtilityBillsScreen} />
      <DashboardStack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} />
    </DashboardStack.Navigator>
  );
}

function PaymentsStackNav() {
  return (
    <PaymentsStack.Navigator screenOptions={{ headerShown: false }}>
      <PaymentsStack.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
      <PaymentsStack.Screen name="RentPayment" component={RentPaymentScreen} />
      <PaymentsStack.Screen name="UtilityBills" component={UtilityBillsScreen} />
      <PaymentsStack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} />
    </PaymentsStack.Navigator>
  );
}

function MaintenanceStackNav() {
  return (
    <MaintenanceStack.Navigator screenOptions={{ headerShown: false }}>
      <MaintenanceStack.Screen name="MaintenanceRequest" component={MaintenanceRequestScreen} />
      <MaintenanceStack.Screen name="IssueMessages" component={IssueMessagesScreen} />
    </MaintenanceStack.Navigator>
  );
}

function MenuStackNav() {
  return (
    <MenuStack.Navigator screenOptions={{ headerShown: false }}>
      <MenuStack.Screen name="MenuMain" component={MenuScreen} />
      <MenuStack.Screen name="CommunityMain" component={CommunityScreen} />
      <MenuStack.Screen name="Community" component={CommunityScreen} />
      <MenuStack.Screen name="OfficeInfo" component={OfficeInfoScreen} />
      <MenuStack.Screen name="Announcements" component={AnnouncementsScreen} />
      <MenuStack.Screen name="MessagesAlerts" component={MessagesAlertsScreen} />
      <MenuStack.Screen name="ShipPlay" component={ShipPlayScreen} />
    </MenuStack.Navigator>
  );
}

export default function TenantNavigator() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const tabBarStyle = {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    elevation: 12,
    height: Platform.OS === 'ios' ? (insets.bottom > 0 ? 64 + insets.bottom : 70) : 70,
    paddingBottom: Platform.OS === 'ios' ? (insets.bottom > 0 ? insets.bottom : 8) : 8,
    paddingTop: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: isDark ? 0.3 : 0.05,
    shadowRadius: 8,
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: tabBarStyle,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarLabelStyle: {
          fontFamily: fonts.interSemiBold,
          fontSize: 11,
          letterSpacing: -0.1,
          marginTop: -2,
        },
        tabBarIcon: ({ focused, color }) => {
          const icons = {
            Dashboard: 'dashboard',
            Payments: 'payments',
            Maintenance: 'build',
            Menu: 'menu',
          };
          return (
            <View style={{ width: 48, height: 28, alignItems: 'center', justifyContent: 'center' }}>
              {focused && (
                <View
                  style={{
                    position: 'absolute',
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: isDark ? 'rgba(129, 140, 248, 0.18)' : 'rgba(79, 70, 229, 0.12)',
                  }}
                />
              )}
              <MaterialIcons
                name={icons[route.name]}
                size={22}
                color={color}
              />
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardStackNav} />
      <Tab.Screen name="Payments" component={PaymentsStackNav} />
      <Tab.Screen name="Maintenance" component={MaintenanceStackNav} />
      <Tab.Screen name="Menu" component={MenuStackNav} />
    </Tab.Navigator>
  );
}

