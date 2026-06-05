import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';

import TenantDashboard from '../screens/tenant/TenantDashboard';
import RentalAgreementScreen from '../screens/tenant/RentalAgreementScreen';
import PaymentHistoryScreen from '../screens/tenant/PaymentHistoryScreen';
import RentPaymentScreen from '../screens/tenant/RentPaymentScreen';
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
const CommunityStack = createStackNavigator();

function DashboardStackNav() {
  return (
    <DashboardStack.Navigator screenOptions={{ headerShown: false }}>
      <DashboardStack.Screen name="TenantDashboard" component={TenantDashboard} />
      <DashboardStack.Screen name="RentalAgreement" component={RentalAgreementScreen} />
    </DashboardStack.Navigator>
  );
}

function PaymentsStackNav() {
  return (
    <PaymentsStack.Navigator screenOptions={{ headerShown: false }}>
      <PaymentsStack.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
      <PaymentsStack.Screen name="RentPayment" component={RentPaymentScreen} />
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

function CommunityStackNav() {
  return (
    <CommunityStack.Navigator screenOptions={{ headerShown: false }}>
      <CommunityStack.Screen name="CommunityMain" component={CommunityScreen} />
      <CommunityStack.Screen name="OfficeInfo" component={OfficeInfoScreen} />
      <CommunityStack.Screen name="Announcements" component={AnnouncementsScreen} />
      <CommunityStack.Screen name="MessagesAlerts" component={MessagesAlertsScreen} />
      <CommunityStack.Screen name="ShipPlay" component={ShipPlayScreen} />
    </CommunityStack.Navigator>
  );
}

const TAB_BAR_STYLE = {
  backgroundColor: colors.primary,
  borderTopWidth: 0,
  elevation: 0,
  height: 64,
  paddingBottom: 8,
  paddingTop: 8,
};

export default function TenantNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: TAB_BAR_STYLE,
        tabBarActiveTintColor: colors.tertiaryFixedDim,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
        tabBarLabelStyle: {
          fontFamily: fonts.interMedium,
          fontSize: 11,
        },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Dashboard: 'dashboard',
            Payments: 'payments',
            Maintenance: 'build',
            Community: 'business',
            Menu: 'menu',
          };
          return <MaterialIcons name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardStackNav} />
      <Tab.Screen name="Payments" component={PaymentsStackNav} />
      <Tab.Screen name="Maintenance" component={MaintenanceStackNav} />
      <Tab.Screen name="Community" component={CommunityStackNav} />
      <Tab.Screen name="Menu" component={MenuScreen} />
    </Tab.Navigator>
  );
}
