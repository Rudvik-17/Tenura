import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import ScreenHeader from '../../components/ScreenHeader';
import StatusChip from '../../components/StatusChip';
import PrimaryButton from '../../components/PrimaryButton';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import { showPaymentConfirmed } from '../../lib/notifications';
import { buildReceiptHTML } from '../../lib/receiptHTML';
import { toAsciiDigits } from '../../lib/securityDeposit';
import {
  ELECTRICITY_DEPARTMENTS,
  WATER_DEPARTMENTS,
  UPI_PHONE_APPS,
  getTenantUtilityBills,
  updateTenantUtilityBill,
  markUtilityBillPaid,
  openPhoneUpiApp,
} from '../../lib/utilityBills';

const METHOD_LABELS = {
  gpay: 'Google Pay',
  phonepe: 'PhonePe',
  paytm: 'Paytm UPI',
  bhim: 'BHIM / UPI App',
};

export default function UtilityBillsScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const initialType = route?.params?.initialBillType === 'water' ? 'water' : 'electricity';
  const [selectedType, setSelectedType] = useState(initialType); // 'electricity' | 'water'
  const [selectedUpiApp, setSelectedUpiApp] = useState('gpay');

  const [tenantProfile, setTenantProfile] = useState(null);
  const [utilityData, setUtilityData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  // Edit Bill & Department Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDeptCode, setEditDeptCode] = useState('');
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptUpi, setEditDeptUpi] = useState('');
  const [editConsumerNo, setEditConsumerNo] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editReading, setEditReading] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // UPI UTR Confirmation Modal State
  const [showUtrModal, setShowUtrModal] = useState(false);
  const [utrInput, setUtrInput] = useState('');
  const [submittingUtr, setSubmittingUtr] = useState(false);

  const awaitingUpiReturn = useRef(false);

  useEffect(() => {
    if (route?.params?.initialBillType === 'water' || route?.params?.initialBillType === 'electricity') {
      setSelectedType(route.params.initialBillType);
    }
  }, [route?.params?.initialBillType]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: tenantRows } = await supabase
        .from('tenants')
        .select('id, full_name, unit_number, phone, properties(name, city, address)')
        .eq('user_id', user.id)
        .limit(1);

      const tenant = tenantRows?.[0] ?? {
        id: `tenant-${user.id}`,
        full_name: user.user_metadata?.full_name || 'Resident',
        unit_number: '101',
        properties: { name: 'Tenura Residency', city: 'Bangalore' },
      };

      setTenantProfile(tenant);
      const bills = await getTenantUtilityBills(
        tenant.id,
        tenant.unit_number || '101',
        tenant.properties?.city || 'Bangalore'
      );
      setUtilityData(bills);
    } catch (err) {
      console.warn('Error loading utility bills screen:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for return from phone UPI app
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && awaitingUpiReturn.current) {
        awaitingUpiReturn.current = false;
        setPaying(false);
        const activeBill = utilityData?.[selectedType];
        const deptLabel = activeBill?.departmentShortName || activeBill?.departmentName || 'Department';
        Alert.alert(
          'Confirm Department Payment',
          `Did you complete the ${activeBill?.title || 'utility bill'} payment of ₹${Number(activeBill?.amount || 0).toLocaleString('en-IN')} to ${deptLabel} in your UPI app?`,
          [
            {
              text: 'No, Not Yet',
              style: 'cancel',
            },
            {
              text: 'Yes, Payment Done',
              onPress: () => {
                setUtrInput('');
                setShowUtrModal(true);
              },
            },
          ],
          { cancelable: false }
        );
      }
    });
    return () => sub.remove();
  }, [utilityData, selectedType]);

  if (!user) return null;

  const currentBill = utilityData?.[selectedType] ?? null;
  const departmentsList = selectedType === 'electricity' ? ELECTRICITY_DEPARTMENTS : WATER_DEPARTMENTS;

  const openEditBillModal = () => {
    if (!currentBill) return;
    setEditDeptCode(currentBill.departmentCode || departmentsList[0].code);
    setEditDeptName(currentBill.departmentName || departmentsList[0].name);
    setEditDeptUpi(currentBill.departmentUpiId || departmentsList[0].upiId);
    setEditConsumerNo(currentBill.consumerNumber || '');
    setEditAmount(String(currentBill.amount || ''));
    setEditReading(currentBill.readingInfo || '');
    setShowEditModal(true);
  };

  const handleSelectDepartmentPreset = (dept) => {
    setEditDeptCode(dept.code);
    if (!dept.code.startsWith('CUSTOM')) {
      setEditDeptName(dept.name);
      setEditDeptUpi(dept.upiId);
    }
  };

  const handleSaveBillDetails = async () => {
    const cleanAmountStr = toAsciiDigits(editAmount).trim();
    const numericAmount = Number(cleanAmountStr);

    if (!editConsumerNo.trim()) {
      Alert.alert('Missing Consumer No.', 'Please enter your Consumer / RR / Connection Number.');
      return;
    }
    if (!editDeptUpi.trim() || !editDeptUpi.includes('@')) {
      Alert.alert('Invalid Department UPI ID', 'Please enter a valid UPI ID for the department (e.g. bescom.billdesk@upi).');
      return;
    }
    if (!cleanAmountStr || isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid Bill Amount', 'Please enter a valid bill amount greater than ₹0.');
      return;
    }

    setSavingEdit(true);
    try {
      const preset = departmentsList.find(d => d.code === editDeptCode);
      const shortName = editDeptCode.startsWith('CUSTOM')
        ? editDeptName.trim() || 'Utility Department'
        : preset?.shortName || editDeptName.trim();

      const updated = await updateTenantUtilityBill(
        tenantProfile?.id,
        selectedType,
        {
          departmentCode: editDeptCode,
          departmentName: editDeptName.trim(),
          departmentShortName: shortName,
          departmentUpiId: editDeptUpi.trim().toLowerCase(),
          consumerNumber: editConsumerNo.trim(),
          amount: numericAmount,
          readingInfo: editReading.trim() || currentBill.readingInfo,
          status: 'pending',
          paidAt: null,
          txnId: null,
        },
        tenantProfile?.unit_number,
        tenantProfile?.properties?.city
      );
      setUtilityData(updated);
      setShowEditModal(false);
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not update bill details.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handlePayDirectViaUpi = async () => {
    if (!currentBill) return;
    if (currentBill.status === 'paid') {
      Alert.alert(
        'Bill Already Paid',
        'This month’s bill is already marked as paid. Would you like to enter a new bill amount to make another payment?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enter New Bill', onPress: openEditBillModal },
        ]
      );
      return;
    }

    const appObj = UPI_PHONE_APPS.find(a => a.id === selectedUpiApp) || UPI_PHONE_APPS[0];
    const transactionNote = `${currentBill.departmentShortName || currentBill.title} - Consumer ${currentBill.consumerNumber} (${currentBill.billingMonth})`;

    setPaying(true);
    const { opened, urlUsed } = await openPhoneUpiApp({
      appId: selectedUpiApp,
      upiId: currentBill.departmentUpiId,
      payeeName: currentBill.departmentShortName || currentBill.departmentName,
      amount: currentBill.amount,
      transactionNote,
    });

    if (opened) {
      awaitingUpiReturn.current = true;
    } else {
      setPaying(false);
      Alert.alert(
        `Open ${appObj.label}`,
        `Could not detect ${appObj.label} installed on this device.\n\nDirect Department UPI Link:\n• Payee: ${currentBill.departmentName}\n• UPI ID: ${currentBill.departmentUpiId}\n• Consumer No: ${currentBill.consumerNumber}\n• Amount: ₹${Number(currentBill.amount).toLocaleString('en-IN')}\n\nIf you completed payment on your phone or want to record the UPI Reference (UTR), tap "Enter UPI Reference".`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Enter UPI Reference',
            onPress: () => {
              setUtrInput('');
              setShowUtrModal(true);
            },
          },
        ]
      );
    }
  };

  const handleConfirmUtrPayment = async () => {
    const cleanUtr = toAsciiDigits(utrInput).trim();
    if (!cleanUtr || cleanUtr.length < 6) {
      Alert.alert('Invalid UPI Reference', 'Please enter a valid 6 to 12-digit UPI Reference / UTR number from your UPI app.');
      return;
    }

    setSubmittingUtr(true);
    const paidAt = new Date().toISOString();
    const txnId = cleanUtr.toUpperCase().startsWith('UPI-') ? cleanUtr : `UPI-${cleanUtr}`;

    try {
      const { nextState } = await markUtilityBillPaid(
        tenantProfile?.id,
        selectedType,
        {
          txnId,
          method: selectedUpiApp,
          paidAt,
        },
        tenantProfile?.unit_number,
        tenantProfile?.properties?.city
      );
      setUtilityData(nextState);
      setShowUtrModal(false);
      setUtrInput('');

      showPaymentConfirmed({
        amount: currentBill.amount,
        method: `${METHOD_LABELS[selectedUpiApp] || 'UPI'} (${currentBill.departmentShortName})`,
      });

      navigation.navigate('PaymentSuccess', {
        amount: currentBill.amount,
        method: selectedUpiApp,
        txnId,
        paidAt,
        billType: currentBill.title,
        departmentName: currentBill.departmentName,
        departmentUpiId: currentBill.departmentUpiId,
        consumerNumber: currentBill.consumerNumber,
      });
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not record utility bill payment.');
    } finally {
      setSubmittingUtr(false);
    }
  };

  const handleDownloadUtilityReceipt = async (item) => {
    setDownloadingId(item.id);
    try {
      const html = buildReceiptHTML({
        txnId: item.txnId,
        amount: item.amount,
        method: item.paymentMethod,
        paidAt: item.paidAt,
        tenantName: tenantProfile?.full_name ?? 'Tenant',
        propertyName: tenantProfile?.properties?.name ?? 'Property',
        unitNumber: tenantProfile?.unit_number ?? '—',
        paymentTitle: item.title,
        departmentName: item.departmentName,
        departmentUpiId: item.departmentUpiId,
        consumerNumber: item.consumerNumber,
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Save or share ${item.title} receipt`,
          UTI: 'com.adobe.pdf',
        });
      }
    } catch {
      Alert.alert('Error', 'Could not generate PDF receipt.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading || !currentBill) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const elecBill = utilityData?.electricity;
  const waterBill = utilityData?.water;
  const paidHistory = utilityData?.history || [];
  const selectedAppObj = UPI_PHONE_APPS.find(a => a.id === selectedUpiApp) || UPI_PHONE_APPS[0];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Water & Electricity Bills"
        showBack
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Utility Bill Type Tabs: Electricity vs Water */}
        <View style={styles.tabsWrapper}>
          <TouchableOpacity
            style={[
              styles.utilityTab,
              selectedType === 'electricity' && styles.utilityTabActive,
            ]}
            onPress={() => setSelectedType('electricity')}
            activeOpacity={0.85}
          >
            <View style={[
              styles.utilityTabIcon,
              {
                backgroundColor: selectedType === 'electricity'
                  ? (isDark ? 'rgba(250, 204, 21, 0.16)' : 'rgba(245, 158, 11, 0.12)')
                  : colors.surfaceContainerLow,
              }
            ]}>
              <MaterialIcons
                name="bolt"
                size={22}
                color={selectedType === 'electricity' ? (isDark ? '#FACC15' : '#D97706') : colors.onSurfaceVariant}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[
                styles.utilityTabTitle,
                selectedType === 'electricity' && { color: colors.primary }
              ]}>
                Electricity
              </Text>
              <Text style={styles.utilityTabAmount}>
                ₹{Number(elecBill?.amount || 0).toLocaleString('en-IN')} · {elecBill?.status === 'paid' ? 'Paid' : 'Due'}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.utilityTab,
              selectedType === 'water' && styles.utilityTabActive,
            ]}
            onPress={() => setSelectedType('water')}
            activeOpacity={0.85}
          >
            <View style={[
              styles.utilityTabIcon,
              {
                backgroundColor: selectedType === 'water'
                  ? (isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(14, 165, 233, 0.12)')
                  : colors.surfaceContainerLow,
              }
            ]}>
              <MaterialIcons
                name="water-drop"
                size={20}
                color={selectedType === 'water' ? (isDark ? '#38BDF8' : '#0284C7') : colors.onSurfaceVariant}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[
                styles.utilityTabTitle,
                selectedType === 'water' && { color: colors.primary }
              ]}>
                Water Bill
              </Text>
              <Text style={styles.utilityTabAmount}>
                ₹{Number(waterBill?.amount || 0).toLocaleString('en-IN')} · {waterBill?.status === 'paid' ? 'Paid' : 'Due'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Hero Bill Summary Card - Minimal, Mind-Satisfying & Essential Info Only */}
        <View style={styles.heroCard}>
          {/* Top Row: Service & Department Brand + Non-Clipping Status Pill */}
          <View style={styles.heroTopRow}>
            <View style={styles.billerHeaderLeft}>
              <View
                style={[
                  styles.serviceIconContainer,
                  {
                    backgroundColor:
                      selectedType === 'water'
                        ? (isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(14, 165, 233, 0.12)')
                        : (isDark ? 'rgba(250, 204, 21, 0.18)' : 'rgba(245, 158, 11, 0.12)'),
                  },
                ]}
              >
                <MaterialIcons
                  name={selectedType === 'electricity' ? 'bolt' : 'water-drop'}
                  size={22}
                  color={selectedType === 'water' ? (isDark ? '#38BDF8' : '#0284C7') : (isDark ? '#FACC15' : '#D97706')}
                />
              </View>
              <View style={styles.billerHeaderTextGroup}>
                <Text style={styles.billerServiceTitle} numberOfLines={1}>
                  {selectedType === 'electricity' ? 'Electricity Bill' : 'Water Supply Bill'}
                </Text>
                <View style={styles.billerDeptRow}>
                  <Text style={styles.billerDeptName} numberOfLines={1}>
                    {currentBill.departmentShortName || currentBill.departmentName}
                  </Text>
                  <MaterialIcons name="verified" size={13} color={colors.tertiaryFixedDim || '#10B981'} />
                </View>
              </View>
            </View>

            <View style={styles.statusChipWrapper}>
              <StatusChip
                label={
                  currentBill.status === 'paid'
                    ? 'Paid ✓'
                    : currentBill.dueDate
                    ? `Due ${new Date(currentBill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                    : 'Bill Due'
                }
                variant={currentBill.status === 'paid' ? 'active' : 'pending'}
              />
            </View>
          </View>

          {/* Amount Display */}
          <View style={styles.amountSection}>
            <View style={styles.amountRow}>
              <Text style={styles.currencySymbol}>₹</Text>
              <Text style={styles.heroAmount}>
                {Number(currentBill.amount || 0).toLocaleString('en-IN')}
              </Text>
            </View>
            <Text style={styles.billingCycleText}>
              {currentBill.billingMonth ? `Billing Cycle: ${currentBill.billingMonth}` : ''}
              {currentBill.readingInfo ? ` · ${currentBill.readingInfo}` : ''}
            </Text>
          </View>

          {/* Essential Info Only: Consumer ID & Official Department UPI */}
          <View style={styles.heroMetaCard}>
            <View style={styles.heroMetaItem}>
              <Text style={styles.heroMetaLabel}>CONSUMER / RR NO.</Text>
              <Text style={styles.heroMetaValue} numberOfLines={1} selectable>
                {currentBill.consumerNumber}
              </Text>
            </View>
            <View style={styles.heroMetaDivider} />
            <View style={styles.heroMetaItem}>
              <Text style={styles.heroMetaLabel}>OFFICIAL UPI VPA</Text>
              <View style={styles.upiValueRow}>
                <Text style={[styles.heroMetaValue, styles.upiHighlightText]} numberOfLines={1} selectable>
                  {currentBill.departmentUpiId}
                </Text>
              </View>
            </View>
          </View>

          {/* Card Footer: Due Date & Clean Edit Button */}
          <View style={styles.heroFooterRow}>
            <View style={styles.dueDateBadge}>
              <MaterialIcons
                name={currentBill.status === 'paid' ? 'check-circle' : 'schedule'}
                size={14}
                color={currentBill.status === 'paid' ? (colors.tertiaryFixedDim || '#10B981') : colors.outline}
              />
              <Text style={styles.heroDueText} numberOfLines={1}>
                {currentBill.status === 'paid'
                  ? `Paid on ${new Date(currentBill.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : `Due by ${new Date(currentBill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.editBillBtn}
              onPress={openEditBillModal}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="edit" size={13} color={colors.primary} />
              <Text style={styles.editBillBtnText}>Edit Details</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Minimal Trust Indicator - Replaces the redundant 80px banner */}
        <View style={styles.minimalTrustPill}>
          <MaterialIcons name="verified-user" size={13} color={colors.tertiaryFixedDim || '#10B981'} />
          <Text style={styles.minimalTrustText}>
            Official direct settlement to {currentBill.departmentShortName || 'department'} • Zero surcharge
          </Text>
        </View>

        {/* Select Phone UPI App Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select UPI App on Your Phone</Text>
          <Text style={styles.sectionSubtitle}>
            Pre-fills the department UPI ID and exact bill amount directly on your phone.
          </Text>

          {UPI_PHONE_APPS.map((app) => {
            const isSelected = selectedUpiApp === app.id;
            return (
              <TouchableOpacity
                key={app.id}
                style={[styles.upiAppCard, isSelected && styles.upiAppCardActive]}
                onPress={() => setSelectedUpiApp(app.id)}
                activeOpacity={0.8}
              >
                <View style={styles.upiAppIconBg}>
                  <MaterialIcons name={app.icon} size={22} color={colors.primary} />
                </View>
                <View style={styles.upiAppInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.upiAppLabel}>{app.label}</Text>
                    {app.badge ? (
                      <View style={styles.upiBadge}>
                        <Text style={styles.upiBadgeText}>{app.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.upiAppSub}>{app.sub}</Text>
                </View>
                <View style={[styles.radioOuter, isSelected && styles.radioOuterActive]}>
                  {isSelected ? <View style={styles.radioInner} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Pay CTA */}
        <View style={styles.ctaSection}>
          <PrimaryButton
            label={
              currentBill.status === 'paid'
                ? `${currentBill.title} Paid ✓ (Tap to Pay New Bill)`
                : `Open ${selectedAppObj.label.split(' ')[0]} • Pay ₹${Number(currentBill.amount).toLocaleString('en-IN')}`
            }
            onPress={handlePayDirectViaUpi}
            loading={paying}
            icon="open-in-new"
          />
          <Text style={styles.ctaHelperText}>
            Redirects to {selectedAppObj.label} on your phone to pay {currentBill.departmentShortName} ({currentBill.departmentUpiId}).
          </Text>
        </View>

        {/* Utility Bill Payment History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Utility Bill Payment History</Text>
          {paidHistory.length === 0 ? (
            <View style={styles.emptyHistoryCard}>
              <MaterialIcons name="receipt-long" size={30} color={colors.outline} />
              <Text style={styles.emptyHistoryText}>
                No past utility bill payments recorded yet.
              </Text>
            </View>
          ) : (
            paidHistory.map((item) => (
              <View key={item.id} style={styles.historyRow}>
                <View style={styles.historyIconBg}>
                  <MaterialIcons
                    name={item.billType === 'electricity' ? 'bolt' : 'water-drop'}
                    size={20}
                    color={colors.tertiaryFixedDim}
                  />
                </View>
                <View style={styles.historyInfo}>
                  <Text style={styles.historyTitle}>
                    {item.title} · ₹{Number(item.amount).toLocaleString('en-IN')}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {item.departmentShortName} · Consumer: {item.consumerNumber}
                  </Text>
                  <Text style={styles.historyDate}>
                    Paid {new Date(item.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} via {METHOD_LABELS[item.paymentMethod] || item.paymentMethod} · {item.txnId}
                  </Text>
                </View>
                <RateLimitedButton
                  style={styles.receiptIconBtn}
                  onPress={() => handleDownloadUtilityReceipt(item)}
                  disabled={downloadingId === item.id}
                >
                  {downloadingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <MaterialIcons name="download" size={18} color={colors.primary} />
                  )}
                </RateLimitedButton>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Modal 1: Edit Respective Department, Consumer No & Bill Amount */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowEditModal(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalKeyboard}
          >
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    Configure {selectedType === 'electricity' ? 'Electricity' : 'Water'} Bill
                  </Text>
                  <Text style={styles.modalSub}>
                    Select your utility board & enter consumer bill details
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setShowEditModal(false)}>
                  <MaterialIcons name="close" size={24} color={colors.onSurface} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.inputLabel}>SELECT RESPECTIVE DEPARTMENT</Text>
                <View style={styles.deptChipsContainer}>
                  {departmentsList.map((dept) => {
                    const active = editDeptCode === dept.code;
                    return (
                      <TouchableOpacity
                        key={dept.code}
                        style={[styles.deptChip, active && styles.deptChipActive]}
                        onPress={() => handleSelectDepartmentPreset(dept)}
                      >
                        <Text style={[styles.deptChipText, active && styles.deptChipTextActive]}>
                          {dept.code.startsWith('CUSTOM') ? 'Custom Board' : dept.code}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.inputLabel}>DEPARTMENT NAME</Text>
                <TextInput
                  style={styles.textInput}
                  value={editDeptName}
                  onChangeText={setEditDeptName}
                  placeholder="e.g. BESCOM Electricity Board"
                  placeholderTextColor={colors.outline}
                />

                <Text style={styles.inputLabel}>OFFICIAL DEPARTMENT UPI ID (VPA)</Text>
                <TextInput
                  style={styles.textInput}
                  value={editDeptUpi}
                  onChangeText={setEditDeptUpi}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="e.g. bescom.billdesk@upi"
                  placeholderTextColor={colors.outline}
                />

                <Text style={styles.inputLabel}>CONSUMER / RR / CONNECTION NUMBER</Text>
                <TextInput
                  style={styles.textInput}
                  value={editConsumerNo}
                  onChangeText={setEditConsumerNo}
                  autoCapitalize="characters"
                  placeholder="Enter Consumer or RR Number"
                  placeholderTextColor={colors.outline}
                />

                <Text style={styles.inputLabel}>BILL AMOUNT TO PAY (₹)</Text>
                <TextInput
                  style={styles.textInput}
                  value={editAmount}
                  onChangeText={(txt) => setEditAmount(toAsciiDigits(txt))}
                  keyboardType="numeric"
                  placeholder="e.g. 1450"
                  placeholderTextColor={colors.outline}
                />

                <Text style={styles.inputLabel}>METER READING / CONSUMPTION NOTE (OPTIONAL)</Text>
                <TextInput
                  style={styles.textInput}
                  value={editReading}
                  onChangeText={setEditReading}
                  placeholder={selectedType === 'electricity' ? 'e.g. 218 kWh consumed' : 'e.g. 18 KL consumed'}
                  placeholderTextColor={colors.outline}
                />
              </ScrollView>

              <View style={{ marginTop: 16 }}>
                <PrimaryButton
                  label="Save Bill & Department Details"
                  onPress={handleSaveBillDetails}
                  loading={savingEdit}
                  icon="check"
                />
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Modal 2: Confirm Direct UPI Payment & Enter UTR */}
      <Modal
        visible={showUtrModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!submittingUtr) setShowUtrModal(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            if (!submittingUtr) setShowUtrModal(false);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalKeyboard}
          >
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Confirm Department UPI Payment</Text>
                  <Text style={styles.modalSub}>
                    Paid ₹{Number(currentBill.amount).toLocaleString('en-IN')} to {currentBill.departmentShortName} ({currentBill.departmentUpiId})
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    if (!submittingUtr) setShowUtrModal(false);
                  }}
                >
                  <MaterialIcons name="close" size={24} color={colors.onSurface} />
                </TouchableOpacity>
              </View>

              <View style={{ paddingVertical: 12 }}>
                <Text style={styles.inputLabel}>12-DIGIT UPI REFERENCE / UTR NUMBER</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. 429810394812"
                  placeholderTextColor={colors.outline}
                  value={utrInput}
                  onChangeText={(txt) => setUtrInput(toAsciiDigits(txt))}
                  keyboardType="numeric"
                  maxLength={22}
                  autoFocus
                />
                <Text style={styles.utrHelper}>
                  Enter the UPI transaction reference number from {selectedAppObj.label} to generate your official utility payment receipt.
                </Text>
              </View>

              <PrimaryButton
                label={submittingUtr ? 'Generating Receipt…' : 'Confirm & Generate Receipt'}
                onPress={handleConfirmUtrPayment}
                loading={submittingUtr}
                icon="verified"
              />
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      padding: 24,
    },

    tabsWrapper: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
      gap: 12,
    },
    utilityTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1.5,
      borderColor: isDark ? colors.outlineVariant : 'rgba(203, 213, 225, 0.6)',
    },
    utilityTabActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(129, 140, 248, 0.12)' : 'rgba(79, 70, 229, 0.05)',
    },
    utilityTabIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    utilityTabTitle: {
      fontFamily: fonts.manropeBold,
      fontSize: 14,
      color: colors.onSurface,
    },
    utilityTabAmount: {
      fontFamily: fonts.interMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },

    // Hero Bill Card - Elevated, clean, mind-satisfying
    heroCard: {
      marginHorizontal: 20,
      marginTop: 4,
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: isDark ? colors.outlineVariant : 'rgba(203, 213, 225, 0.7)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.05,
      shadowRadius: 10,
      elevation: 3,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    billerHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
      marginRight: 10,
    },
    serviceIconContainer: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    billerHeaderTextGroup: {
      flex: 1,
    },
    billerServiceTitle: {
      fontFamily: fonts.manropeBold,
      fontSize: 16,
      color: colors.onSurface,
      letterSpacing: -0.2,
    },
    billerDeptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 2,
    },
    billerDeptName: {
      fontFamily: fonts.interMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      flexShrink: 1,
    },
    statusChipWrapper: {
      flexShrink: 0,
      alignItems: 'flex-end',
    },

    amountSection: {
      marginBottom: 16,
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    currencySymbol: {
      fontFamily: fonts.manropeBold,
      fontSize: 24,
      color: colors.onSurface,
      marginTop: 4,
      marginRight: 3,
    },
    heroAmount: {
      fontFamily: fonts.manropeBold,
      fontSize: 38,
      color: colors.onSurface,
      letterSpacing: -1,
      lineHeight: 44,
    },
    billingCycleText: {
      fontFamily: fonts.interRegular,
      fontSize: 12,
      color: colors.outline,
      marginTop: 4,
    },

    heroMetaCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : colors.surfaceContainerLow,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : colors.surfaceContainerHigh,
      marginBottom: 14,
    },
    heroMetaItem: {
      flex: 1,
    },
    heroMetaDivider: {
      width: 1,
      height: 28,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : colors.outlineVariant,
      marginHorizontal: 12,
    },
    heroMetaLabel: {
      fontFamily: fonts.interSemiBold,
      fontSize: 9,
      letterSpacing: 0.8,
      color: colors.outline,
      marginBottom: 3,
      textTransform: 'uppercase',
    },
    heroMetaValue: {
      fontFamily: fonts.interSemiBold,
      fontSize: 13,
      color: colors.onSurface,
    },
    upiValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    upiHighlightText: {
      color: colors.primary,
    },

    heroFooterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : colors.surfaceContainerHigh,
    },
    dueDateBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
    },
    heroDueText: {
      fontFamily: fonts.interMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    editBillBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: isDark ? 'rgba(129, 140, 248, 0.15)' : 'rgba(79, 70, 229, 0.08)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    editBillBtnText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 12,
      color: colors.primary,
    },

    minimalTrustPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
      marginBottom: 2,
      paddingHorizontal: 20,
    },
    minimalTrustText: {
      fontFamily: fonts.interRegular,
      fontSize: 11,
      color: colors.outline,
      textAlign: 'center',
    },

    section: {
      paddingHorizontal: 20,
      paddingTop: 22,
    },
    sectionTitle: {
      fontFamily: fonts.manropeSemiBold,
      fontSize: 16,
      color: colors.onSurface,
      marginBottom: 4,
    },
    sectionSubtitle: {
      fontFamily: fonts.interRegular,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      lineHeight: 17,
      marginBottom: 14,
    },

    upiAppCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1.5,
      borderColor: isDark ? colors.outlineVariant : 'rgba(203, 213, 225, 0.6)',
    },
    upiAppCardActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(129, 140, 248, 0.08)' : 'rgba(79, 70, 229, 0.04)',
    },
    upiAppIconBg: {
      width: 42,
      height: 42,
      borderRadius: 10,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
    },
    upiAppInfo: { flex: 1 },
    upiAppLabel: {
      fontFamily: fonts.interSemiBold,
      fontSize: 14,
      color: colors.onSurface,
      marginBottom: 2,
    },
    upiAppSub: {
      fontFamily: fonts.interRegular,
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    upiBadge: {
      backgroundColor: `${colors.tertiaryFixedDim}20`,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    upiBadgeText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 10,
      color: colors.tertiaryFixedDim,
    },
    radioOuter: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.outline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOuterActive: {
      borderColor: colors.primary,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },

    ctaSection: {
      paddingHorizontal: 20,
      paddingTop: 12,
      gap: 8,
    },
    ctaHelperText: {
      fontFamily: fonts.interRegular,
      fontSize: 11,
      color: colors.outline,
      textAlign: 'center',
      lineHeight: 16,
    },

    emptyHistoryCard: {
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 12,
      padding: 24,
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    emptyHistoryText: {
      fontFamily: fonts.interRegular,
      fontSize: 13,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: 12,
      padding: 14,
      marginTop: 8,
    },
    historyIconBg: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: `${colors.tertiaryFixedDim}18`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyInfo: { flex: 1 },
    historyTitle: {
      fontFamily: fonts.manropeSemiBold,
      fontSize: 14,
      color: colors.onSurface,
    },
    historyMeta: {
      fontFamily: fonts.interMedium,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },
    historyDate: {
      fontFamily: fonts.interRegular,
      fontSize: 11,
      color: colors.outline,
      marginTop: 2,
    },
    receiptIconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: `${colors.primary}15`,
      alignItems: 'center',
      justifyContent: 'center',
    },

    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalKeyboard: {
      width: '100%',
    },
    modalSheet: {
      backgroundColor: colors.surfaceContainerLowest,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 14,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    modalTitle: {
      fontFamily: fonts.manropeBold,
      fontSize: 18,
      color: colors.onSurface,
    },
    modalSub: {
      fontFamily: fonts.interRegular,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },
    inputLabel: {
      fontFamily: fonts.interSemiBold,
      fontSize: 10,
      letterSpacing: 1,
      color: colors.onSurfaceVariant,
      marginTop: 12,
      marginBottom: 6,
    },
    textInput: {
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontFamily: fonts.interRegular,
      fontSize: 14,
      color: colors.onSurface,
    },
    deptChipsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 4,
    },
    deptChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 18,
      backgroundColor: colors.surfaceContainerLow,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    deptChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    deptChipText: {
      fontFamily: fonts.interSemiBold,
      fontSize: 12,
      color: colors.onSurface,
    },
    deptChipTextActive: {
      color: colors.onPrimary,
    },
    utrHelper: {
      fontFamily: fonts.interRegular,
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginTop: 8,
      lineHeight: 17,
    },
  });
