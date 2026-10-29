import React from 'react';
import { Platform, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../theme/typography';

import OwnerDashboard from '../screens/owner/OwnerDashboard';
import AddPropertyScreen from '../screens/owner/AddPropertyScreen';
import EditPropertyScreen from '../screens/owner/EditPropertyScreen';
import PropertyDetailScreen from '../screens/owner/PropertyDetailScreen';
import ResidentDataScreen from '../screens/owner/ResidentDataScreen';
import TenantOnboardingScreen from '../screens/owner/TenantOnboardingScreen';
import TenantDetailScreen from '../screens/owner/TenantDetailScreen';
import FinanceOverviewScreen from '../screens/owner/FinanceOverviewScreen';
import RentCollectionScreen from '../screens/owner/RentCollectionScreen';
import RecentActivityScreen from '../screens/owner/RecentActivityScreen';
import SecurityDepositScreen from '../screens/owner/SecurityDepositScreen';
import ResidentIssuesScreen from '../screens/owner/ResidentIssuesScreen';
import IssueMessagesScreen from '../screens/shared/IssueMessagesScreen';

import MenuScreen from '../screens/owner/MenuScreen';
import LeaseDocumentsScreen from '../screens/owner/LeaseDocumentsScreen';
import CommunityScreen from '../screens/owner/CommunityScreen';
import OfficeProfileScreen from '../screens/owner/OfficeProfileScreen';
import AnnouncementsScreen from '../screens/owner/AnnouncementsScreen';
import MessagesAlertsScreen from '../screens/owner/MessagesAlertsScreen';
import ShipPlayScreen from '../screens/owner/ShipPlayScreen';
import AppSettingsScreen from '../screens/owner/AppSettingsScreen';

const Tab = createBottomTabNavigator();
const PortfolioStack = createStackNavigator();
const ResidentsStack = createStackNavigator();
const FinanceStack = createStackNavigator();
const MenuStack = createStackNavigator();

function PortfolioStackNav() {
  return (
    <PortfolioStack.Navigator screenOptions={{ headerShown: false }}>
      <PortfolioStack.Screen name="OwnerDashboard" component={OwnerDashboard} />
      <PortfolioStack.Screen name="AddProperty" component={AddPropertyScreen} />
      <PortfolioStack.Screen name="PropertyDetail" component={PropertyDetailScreen} />
      <PortfolioStack.Screen name="EditProperty" component={EditPropertyScreen} />
    </PortfolioStack.Navigator>
  );
}

function ResidentsStackNav() {
  return (
    <ResidentsStack.Navigator screenOptions={{ headerShown: false }}>
      <ResidentsStack.Screen name="ResidentData" component={ResidentDataScreen} />
      <ResidentsStack.Screen name="TenantOnboarding" component={TenantOnboardingScreen} />
      <ResidentsStack.Screen name="TenantDetail" component={TenantDetailScreen} />
    </ResidentsStack.Navigator>
  );
}

function FinanceStackNav() {
  return (
    <FinanceStack.Navigator screenOptions={{ headerShown: false }}>
      <FinanceStack.Screen name="FinanceOverview" component={FinanceOverviewScreen} />
      <FinanceStack.Screen name="RentCollection" component={RentCollectionScreen} />
      <FinanceStack.Screen name="RecentActivity" component={RecentActivityScreen} />
      <FinanceStack.Screen name="SecurityDeposit" component={SecurityDepositScreen} />
    </FinanceStack.Navigator>
  );
}

function MenuStackNav() {
  return (
    <MenuStack.Navigator screenOptions={{ headerShown: false }}>
      <MenuStack.Screen name="MenuMain" component={MenuScreen} />
      <MenuStack.Screen name="ResidentIssues" component={ResidentIssuesScreen} />
      <MenuStack.Screen name="IssueMessages" component={IssueMessagesScreen} />
      <MenuStack.Screen name="CommunityMain" component={CommunityScreen} />
      <MenuStack.Screen name="OfficeProfile" component={OfficeProfileScreen} />
      <MenuStack.Screen name="Announcements" component={AnnouncementsScreen} />
      <MenuStack.Screen name="MessagesAlerts" component={MessagesAlertsScreen} />
      <MenuStack.Screen name="ShipPlay" component={ShipPlayScreen} />
      <MenuStack.Screen name="LeaseDocuments" component={LeaseDocumentsScreen} />
      <MenuStack.Screen name="AppSettings" component={AppSettingsScreen} />
    </MenuStack.Navigator>
  );
}


export default function OwnerNavigator() {
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
            Portfolio: 'domain',
            Residents: 'groups',
            Finance: 'payments',
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
      <Tab.Screen name="Portfolio" component={PortfolioStackNav} />
      <Tab.Screen name="Residents" component={ResidentsStackNav} />
      <Tab.Screen name="Finance" component={FinanceStackNav} />
      <Tab.Screen name="Menu" component={MenuStackNav} />
    </Tab.Navigator>
  );
}

