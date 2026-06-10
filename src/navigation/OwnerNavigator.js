import React from 'react';
import { Platform } from 'react-native';
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
import ResidentIssuesScreen from '../screens/owner/ResidentIssuesScreen';
import IssueMessagesScreen from '../screens/shared/IssueMessagesScreen';

import MenuScreen from '../screens/owner/MenuScreen';
import LeaseDocumentsScreen from '../screens/owner/LeaseDocumentsScreen';
import CommunityScreen from '../screens/owner/CommunityScreen';
import OfficeProfileScreen from '../screens/owner/OfficeProfileScreen';
import AnnouncementsScreen from '../screens/owner/AnnouncementsScreen';
import MessagesAlertsScreen from '../screens/owner/MessagesAlertsScreen';
import ShipPlayScreen from '../screens/owner/ShipPlayScreen';

const Tab = createBottomTabNavigator();
const PortfolioStack = createStackNavigator();
const ResidentsStack = createStackNavigator();
const FinanceStack = createStackNavigator();
const IssuesStack = createStackNavigator();
const CommunityStack = createStackNavigator();
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
    </FinanceStack.Navigator>
  );
}

function IssuesStackNav() {
  return (
    <IssuesStack.Navigator screenOptions={{ headerShown: false }}>
      <IssuesStack.Screen name="ResidentIssues" component={ResidentIssuesScreen} />
      <IssuesStack.Screen name="IssueMessages" component={IssueMessagesScreen} />
    </IssuesStack.Navigator>
  );
}

function CommunityStackNav() {
  return (
    <CommunityStack.Navigator screenOptions={{ headerShown: false }}>
      <CommunityStack.Screen name="CommunityMain" component={CommunityScreen} />
      <CommunityStack.Screen name="OfficeProfile" component={OfficeProfileScreen} />
      <CommunityStack.Screen name="Announcements" component={AnnouncementsScreen} />
      <CommunityStack.Screen name="MessagesAlerts" component={MessagesAlertsScreen} />
      <CommunityStack.Screen name="ShipPlay" component={ShipPlayScreen} />
    </CommunityStack.Navigator>
  );
}

function MenuStackNav() {
  return (
    <MenuStack.Navigator screenOptions={{ headerShown: false }}>
      <MenuStack.Screen name="MenuMain" component={MenuScreen} />
      <MenuStack.Screen name="LeaseDocuments" component={LeaseDocumentsScreen} />
    </MenuStack.Navigator>
  );
}


export default function OwnerNavigator() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const tabBarStyle = {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
    elevation: 8,
    height: Platform.OS === 'ios' ? (insets.bottom > 0 ? 58 + insets.bottom : 64) : 64,
    paddingBottom: Platform.OS === 'ios' ? (insets.bottom > 0 ? insets.bottom - 4 : 8) : 8,
    paddingTop: 8,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: tabBarStyle,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.outline,
        tabBarLabelStyle: {
          fontFamily: fonts.interMedium,
          fontSize: 10,
          letterSpacing: -0.2,
        },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Portfolio: 'domain',
            Residents: 'groups',
            Finance: 'payments',
            Issues: 'report-problem',
            Community: 'business',
            Menu: 'menu',
          };
          return <MaterialIcons name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Portfolio" component={PortfolioStackNav} />
      <Tab.Screen name="Residents" component={ResidentsStackNav} />
      <Tab.Screen name="Finance" component={FinanceStackNav} />
      <Tab.Screen name="Issues" component={IssuesStackNav} />
      <Tab.Screen name="Community" component={CommunityStackNav} />
      <Tab.Screen name="Menu" component={MenuStackNav} />
    </Tab.Navigator>
  );
}

