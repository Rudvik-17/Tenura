import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
  Modal,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../theme/typography';
import { buildLeaseAgreementHTML } from '../../lib/leaseAgreementHTML';
import { getTenantDeposit } from '../../lib/securityDeposit';
import { getTenantUtilityBills } from '../../lib/utilityBills';
import ScreenHeader from '../../components/ScreenHeader';
import SectionHeader from '../../components/SectionHeader';
import StatusChip from '../../components/StatusChip';
import { RateLimitedButton } from '../../components/RateLimitedButton';
import { RateLimitedIconButton } from '../../components/RateLimitedIconButton';
import { fetchCurrentRentObligation } from '../../services/razorpayService';

// DocuSign status → display config
const DOCUSIGN_STATUS_CONFIG = {
  not_sent: { label: 'Not Sent', variant: 'pending', icon: 'schedule' },
  sent: { label: 'Awaiting Signature', variant: 'pending', icon: 'send' },
  delivered: { label: 'Ready to Sign', variant: 'pending', icon: 'mark-email-unread' },
  completed: { label: 'Signed', variant: 'active', icon: 'verified' },
  declined: { label: 'Declined', variant: 'urgent', icon: 'cancel' },
  voided: { label: 'Voided', variant: 'urgent', icon: 'block' },
};

export default function TenantDashboard({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tenantProfile, setTenantProfile] = useState(null);
  const [lease, setLease] = useState(null);
  const [ownerName, setOwnerName] = useState(null);
  const [ownerInfo, setOwnerInfo] = useState(null);
  const [pendingPayment, setPendingPayment] = useState(null);
  const [activeIssues, setActiveIssues] = useState([]);
  const [securityDeposit, setSecurityDeposit] = useState(null);
  const [utilityBills, setUtilityBills] = useState(null);
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setError(null);
    setLoading(true);

    // Ensure server-owned rent obligation for current billing month exists
    await fetchCurrentRentObligation().catch(() => {});

    // Use limit(1) + array access instead of .single() to handle both
    // zero-row and multi-row cases without throwing a Supabase error.
    const { data: tenantRows, error: tErr } = await supabase
      .from('tenants')
      .select('*, properties(name, city, address)')
      .eq('user_id', user.id)
      .limit(1);

    if (tErr) {
      setError(tErr.message);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const tenantData = tenantRows?.[0] ?? null;

    if (!tenantData) {
      // No linked tenant row yet — not a network error, just not set up
      setTenantProfile(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setTenantProfile(tenantData);

    if (tenantData.owner_id) {
      supabase
        .from('users')
        .select('full_name, email, phone')
        .eq('id', tenantData.owner_id)
        .limit(1)
        .then(({ data: ownerRows }) => {
          const owner = ownerRows?.[0] ?? null;
          setOwnerName(owner?.full_name ?? null);
          setOwnerInfo(owner);
        });
    }

    const [leaseRes, paymentRes, issuesRes] = await Promise.all([
      // Most recent active lease — limit(1) avoids the multi-row crash
      supabase
        .from('leases')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .eq('status', 'active')
        .order('end_date', { ascending: false })
        .limit(1),
      // Earliest outstanding payment (including unverified UPI under_review and reversed)
      supabase
        .from('payments')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .in('status', ['pending', 'overdue', 'under_review', 'reversed'])
        .order('due_date', { ascending: true })
        .limit(1),
      supabase
        .from('maintenance_requests')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .neq('status', 'resolved')
        .order('created_at', { ascending: false }),
    ]);

    const activeLease = leaseRes.data?.[0] ?? null;
    setLease(activeLease);
    setPendingPayment(paymentRes.data?.[0] ?? null);
    setActiveIssues(issuesRes.data ?? []);

    // Load tenant security deposit & utility bills
    try {
      const [depInfo, utilInfo] = await Promise.all([
        getTenantDeposit(
          tenantData.id,
          tenantData.full_name,
          activeLease?.monthly_rent ?? 0,
          tenantData.security_deposit
        ),
        getTenantUtilityBills(
          tenantData.id,
          tenantData.unit_number || '101',
          tenantData.properties?.city || 'Bangalore'
        ),
      ]);
      setSecurityDeposit(depInfo);
      setUtilityBills(utilInfo);
    } catch (depErr) {
      console.warn('Error fetching tenant deposit/utilities:', depErr);
    }

    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  if (!user) return null;

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const handleLeaseDownload = async () => {
    if (!lease || !tenantProfile) return;
    setDownloading(true);
    try {
      const property = tenantProfile.properties;
      const html = buildLeaseAgreementHTML({
        landlordName: ownerName ?? 'Landlord',
        tenantName: tenantProfile.full_name,
        propertyName: property?.name ?? 'Property',
        propertyAddress: property ? `${property.address}, ${property.city}` : '—',
        unitNumber: tenantProfile.unit_number,
        monthlyRent: lease.monthly_rent,
        startDate: lease.start_date,
        endDate: lease.end_date,
        securityDeposit: securityDeposit?.amount ?? null,
        agreementDate: lease.signed_at ?? lease.start_date,
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save or share your lease agreement',
          UTI: 'com.adobe.pdf',
        });
      }
    } catch {
      Alert.alert('Error', 'Could not generate PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const handleBalanceInfoPress = () => {
    Alert.alert(
      'Rent Balance',
      pendingPayment
        ? pendingPayment.status === 'under_review'
          ? `Your submitted UPI reference (${pendingPayment.utr_number || 'UTR'}) for ₹${Number(pendingPayment.amount).toLocaleString('en-IN')} is under owner review. Your rent obligation remains outstanding until settlement is confirmed.`
          : `Your current rent payment of ₹${Number(pendingPayment.amount).toLocaleString('en-IN')} is due on ${formatDate(pendingPayment.due_date)}.`
        : 'You have no outstanding rent payments. All payments are up to date!'
    );
  };

  const handleViewDocumentsPress = () => {
    if (lease) {
      navigation.navigate('RentalAgreement', { leaseId: lease.id });
    } else {
      Alert.alert('Documents', 'No active lease or documents found.');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="error-outline" size={40} color={colors.error} />
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <RateLimitedButton style={styles.retryBtn} onPress={fetchData}>
          <Text style={styles.retryText}>Retry</Text>
        </RateLimitedButton>
      </View>
    );
  }

  if (!tenantProfile) {
    return (
      <View style={styles.centered}>
        <MaterialIcons name="home" size={48} color={colors.outline} />
        <Text style={styles.errorTitle}>No active lease</Text>
        <Text style={styles.errorMsg}>
          Contact your property manager to get set up.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={`Hello ${tenantProfile?.full_name || ''}`}
        hideLogo
        showBell
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Unified Balance Hero Section */}
        <View style={styles.balanceHero}>
          <View style={styles.balanceInfo}>
            <View style={styles.balanceLabelRow}>
              <Text style={styles.balanceLabel}>
                {pendingPayment
                  ? pendingPayment.status === 'overdue'
                    ? 'BALANCE OVERDUE'
                    : pendingPayment.status === 'under_review'
                      ? 'UNDER OWNER REVIEW (OUTSTANDING)'
                      : pendingPayment.status === 'reversed'
                        ? 'PAYMENT REVERSED — DUE'
                        : 'BALANCE DUE'
                  : 'NO BALANCE DUE'}
              </Text>
              <TouchableOpacity onPress={handleBalanceInfoPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="info-outline" size={14} color={colors.onPrimaryContainer} style={{ opacity: 0.6 }} />
              </TouchableOpacity>
            </View>
            <Text style={styles.balanceAmount}>
              ₹{pendingPayment ? Number(pendingPayment.amount).toLocaleString('en-IN') : '0.00'}
            </Text>
            {pendingPayment?.due_date ? (
              <Text style={styles.balanceDueText}>
                {pendingPayment.status === 'under_review'
                  ? `Due ${formatDate(pendingPayment.due_date)} · Awaiting UTR verification`
                  : `Due ${formatDate(pendingPayment.due_date)}`}
              </Text>
            ) : (
              <Text style={styles.balanceDueText}>All systems optimal</Text>
            )}
          </View>
          
          <RateLimitedButton
            style={styles.makePaymentBtn}
            onPress={() => navigation.getParent().navigate('Payments', { screen: 'RentPayment' })}
            activeOpacity={0.8}
          >
            <Text style={styles.makePaymentBtnText}>
              {pendingPayment?.status === 'under_review' ? 'View Status' : 'Make Payment'}
            </Text>
          </RateLimitedButton>
        </View>

        {/* Quick Links Section */}
        <View style={styles.quickLinksSection}>
          <Text style={styles.quickLinksTitle}>Quick Links</Text>
          <View style={styles.quickLinksRow}>
            {/* Link 1: View Documents */}
            <View style={styles.quickLinkItem}>
              <RateLimitedButton
                style={styles.quickLinkCircle}
                onPress={handleViewDocumentsPress}
                activeOpacity={0.7}
              >
                <MaterialIcons name="description" size={26} color={colors.onPrimary} />
              </RateLimitedButton>
              <Text style={styles.quickLinkLabel} numberOfLines={2}>
                View{'\n'}Documents
              </Text>
            </View>

            {/* Link 2: Utility Bills (Water & Electricity) */}
            <View style={styles.quickLinkItem}>
              <RateLimitedButton
                style={styles.quickLinkCircle}
                onPress={() => navigation.getParent()?.navigate('Payments', { screen: 'UtilityBills', params: { initialBillType: 'electricity' } })}
                activeOpacity={0.7}
              >
                <MaterialIcons name="bolt" size={26} color={colors.onPrimary} />
              </RateLimitedButton>
              <Text style={styles.quickLinkLabel} numberOfLines={2}>
                Water &{'\n'}Electricity
              </Text>
            </View>

            {/* Link 3: Security Deposit */}
            <View style={styles.quickLinkItem}>
              <RateLimitedButton
                style={styles.quickLinkCircle}
                onPress={() => setDepositModalVisible(true)}
                activeOpacity={0.7}
              >
                <MaterialIcons name="shield" size={26} color={colors.onPrimary} />
              </RateLimitedButton>
              <Text style={styles.quickLinkLabel} numberOfLines={2}>
                Security{'\n'}Deposit
              </Text>
            </View>
          </View>
        </View>

        {/* Water & Electricity Bills Card Section */}
        {utilityBills && (
          <View style={styles.section}>
            <SectionHeader
              title="Water & Electricity Bills"
              actionLabel="Pay via UPI"
              onAction={() => navigation.getParent()?.navigate('Payments', { screen: 'UtilityBills', params: { initialBillType: 'electricity' } })}
            />
            <View style={styles.utilityDashboardRow}>
              <TouchableOpacity
                style={styles.utilityDashCard}
                activeOpacity={0.8}
                onPress={() => navigation.getParent()?.navigate('Payments', { screen: 'UtilityBills', params: { initialBillType: 'electricity' } })}
              >
                <View style={styles.utilityDashTop}>
                  <View style={[styles.depositIconCircle, { width: 36, height: 36, backgroundColor: `${colors.primary}15` }]}>
                    <MaterialIcons name="bolt" size={20} color={colors.primary} />
                  </View>
                  <StatusChip
                    label={utilityBills.electricity?.status === 'paid' ? 'Paid' : 'Due'}
                    variant={utilityBills.electricity?.status === 'paid' ? 'active' : 'pending'}
                  />
                </View>
                <Text style={styles.utilityDashTitle}>Electricity Bill</Text>
                <Text style={styles.utilityDashDept} numberOfLines={1}>
                  {utilityBills.electricity?.departmentShortName}
                </Text>
                <Text style={styles.utilityDashAmount}>
                  ₹{Number(utilityBills.electricity?.amount || 0).toLocaleString('en-IN')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.utilityDashCard}
                activeOpacity={0.8}
                onPress={() => navigation.getParent()?.navigate('Payments', { screen: 'UtilityBills', params: { initialBillType: 'water' } })}
              >
                <View style={styles.utilityDashTop}>
                  <View style={[styles.depositIconCircle, { width: 36, height: 36, backgroundColor: `${colors.tertiaryFixedDim}18` }]}>
                    <MaterialIcons name="water-drop" size={18} color={colors.tertiaryFixedDim} />
                  </View>
                  <StatusChip
                    label={utilityBills.water?.status === 'paid' ? 'Paid' : 'Due'}
                    variant={utilityBills.water?.status === 'paid' ? 'active' : 'pending'}
                  />
                </View>
                <Text style={styles.utilityDashTitle}>Water Bill</Text>
                <Text style={styles.utilityDashDept} numberOfLines={1}>
                  {utilityBills.water?.departmentShortName}
                </Text>
                <Text style={styles.utilityDashAmount}>
                  ₹{Number(utilityBills.water?.amount || 0).toLocaleString('en-IN')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Security Deposit Card Section */}
        {securityDeposit && (
          <View style={styles.section}>
            <SectionHeader
              title="Security Deposit"
              actionLabel="View Details"
              onAction={() => setDepositModalVisible(true)}
            />
            <TouchableOpacity
              style={styles.depositCard}
              activeOpacity={0.8}
              onPress={() => setDepositModalVisible(true)}
            >
              <View style={styles.depositCardHeader}>
                <View style={styles.depositCardLeft}>
                  <View style={[styles.depositIconCircle, { backgroundColor: `${colors.primary}15` }]}>
                    <MaterialIcons name="shield" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.depositTitleRow}>
                      <Text style={styles.depositCardTitle}>Deposit Set by Landlord</Text>
                      <View style={[styles.depositTag, {
                        backgroundColor: securityDeposit.status === 'collected' ? `${colors.tertiaryFixedDim}18` : `${colors.secondary}18`
                      }]}>
                        <Text style={[styles.depositTagText, {
                          color: securityDeposit.status === 'collected' ? colors.tertiaryFixedDim : colors.secondary
                        }]}>
                          {securityDeposit.status === 'collected' ? 'Advance Paid' : 'Pending Payment'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.depositCardDesc}>
                      {securityDeposit.status === 'collected'
                        ? 'Paid in advance before handover · Refundable upon vacating'
                        : 'Awaiting advance payment before move-in'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.depositCardValue}>
                  ₹{Number(securityDeposit.amount).toLocaleString('en-IN')}
                </Text>
              </View>

              {/* Deductions if any */}
              {securityDeposit.deductions?.length > 0 && (
                <View style={styles.depositDeductionBox}>
                  <View style={styles.depositDeductionHeader}>
                    <Text style={styles.depositDeductionTitle}>Move-Out Deductions (Paint, Repairs):</Text>
                    <Text style={styles.depositDeductionTotal}>
                      -₹{Number(securityDeposit.totalDeductions).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  {securityDeposit.deductions.map((d) => (
                    <View key={d.id} style={styles.depositDeductionItem}>
                      <Text style={styles.depositDeductionItemName}>• {d.title}</Text>
                      <Text style={styles.depositDeductionItemVal}>-₹{Number(d.amount).toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                  <View style={styles.depositDeductionDivider} />
                  <View style={styles.depositDeductionHeader}>
                    <Text style={styles.depositNetRefundLabel}>Refund Payable to You:</Text>
                    <Text style={styles.depositNetRefundVal}>
                      ₹{Number(securityDeposit.netRefund).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.depositCardFooter}>
                <MaterialIcons name="info-outline" size={13} color={colors.outline} />
                <Text style={styles.depositCardFooterText}>
                  Tap to view full security deposit terms, paint and maintenance policies.
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Home Status */}
        <View style={styles.section}>
          <SectionHeader title="Home Status" />
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <MaterialIcons
                name={activeIssues.length === 0 ? 'check-circle' : 'pending-actions'}
                size={20}
                color={activeIssues.length === 0 ? colors.tertiaryFixedDim : colors.secondary}
              />
              <Text style={styles.statusText}>
                {activeIssues.length === 0
                  ? 'All systems optimal.'
                  : `${activeIssues.length} active ticket${activeIssues.length > 1 ? 's' : ''}`}
              </Text>
            </View>
            {activeIssues.length > 0 ? (
              <StatusChip label={`${activeIssues.length} Active`} variant="pending" />
            ) : null}
          </View>
        </View>

        {/* Documents */}
        <View style={styles.section}>
          <SectionHeader title="Documents" />
          {lease ? (
            <View style={styles.docCard}>
              <View style={styles.docRow}>
                <MaterialIcons name="picture-as-pdf" size={24} color={colors.error} />
                <View style={styles.docInfo}>
                  <Text style={styles.docName}>Lease_Agreement.pdf</Text>
                  <Text style={styles.docMeta}>
                    Signed {lease.signed_at ? formatDate(lease.signed_at) : 'Pending signature'}
                  </Text>
                </View>
                <RateLimitedIconButton
                  onPress={handleLeaseDownload}
                  disabled={downloading}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  icon={downloading
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <MaterialIcons name="download" size={20} color={colors.primary} />}
                />
              </View>

              {/* DocuSign Status Badge */}
              {lease.docusign_status && lease.docusign_status !== 'not_sent' ? (
                <View style={styles.docusignRow}>
                  <MaterialIcons
                    name={DOCUSIGN_STATUS_CONFIG[lease.docusign_status]?.icon || 'info'}
                    size={16}
                    color={lease.docusign_status === 'completed' ? colors.tertiaryFixedDim : colors.secondary}
                  />
                  <StatusChip
                    label={DOCUSIGN_STATUS_CONFIG[lease.docusign_status]?.label || lease.docusign_status}
                    variant={DOCUSIGN_STATUS_CONFIG[lease.docusign_status]?.variant || 'pending'}
                  />
                </View>
              ) : null}

              {/* Sign Now Button — visible when DocuSign envelope is sent or delivered */}
              {lease.docusign_status === 'sent' || lease.docusign_status === 'delivered' ? (
                <RateLimitedButton
                  style={styles.signNowBtn}
                  onPress={() => {
                    Alert.alert(
                      'Sign Your Lease',
                      'Check your email for a message from DocuSign to sign your lease agreement. Look for the subject line "Please sign your lease agreement - Tenura".',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Open Email',
                          onPress: () => {
                            const email = tenantProfile?.email || '';
                            Linking.openURL(`mailto:${email}`).catch(() => {
                              Alert.alert('Error', 'Could not open email app.');
                            });
                          },
                        },
                      ]
                    );
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="draw" size={18} color={colors.onPrimary} />
                  <Text style={styles.signNowBtnText}>Sign Now</Text>
                </RateLimitedButton>
              ) : null}
            </View>
          ) : (
            <Text style={styles.noDocText}>No documents on file</Text>
          )}
        </View>
      </ScrollView>

      {/* ── Security Deposit Statement Modal ── */}
      <Modal
        visible={depositModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDepositModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.depositIconCircle, { backgroundColor: `${colors.primary}15` }]}>
                  <MaterialIcons name="shield" size={24} color={colors.primary} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Security Deposit Details</Text>
                  <Text style={styles.modalSubtitle}>Unit {tenantProfile?.unit_number} · {tenantProfile?.properties?.name}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setDepositModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={24} color={colors.onSurface} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              <View style={styles.modalSummaryBox}>
                <Text style={styles.modalDepositLabel}>TOTAL SECURITY DEPOSIT</Text>
                <Text style={styles.modalDepositVal}>
                  ₹{Number(securityDeposit?.amount || 0).toLocaleString('en-IN')}
                </Text>
                <View style={styles.modalBadgeRow}>
                  <View style={[styles.depositStatusBadge, {
                    backgroundColor: securityDeposit?.status === 'collected' ? `${colors.tertiaryFixedDim}20` : `${colors.secondary}20`,
                  }]}>
                    <MaterialIcons
                      name={securityDeposit?.status === 'collected' ? 'check-circle' : 'schedule'}
                      size={14}
                      color={securityDeposit?.status === 'collected' ? colors.tertiaryFixedDim : colors.secondary}
                    />
                    <Text style={[styles.depositStatusText, {
                      color: securityDeposit?.status === 'collected' ? colors.tertiaryFixedDim : colors.secondary,
                    }]}>
                      {securityDeposit?.status === 'collected' ? 'Collected Upfront (Before Handover)' : 'Pending Advance Payment'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Deductions section */}
              {securityDeposit?.deductions?.length > 0 ? (
                <View style={styles.modalSectionBox}>
                  <Text style={styles.modalSectionTitle}>MOVE-OUT INSPECTION DEDUCTIONS</Text>
                  <Text style={styles.modalSectionSub}>
                    Deductions made by the landlord for paint, damages, or unpaid bills:
                  </Text>
                  {securityDeposit.deductions.map(d => (
                    <View key={d.id} style={styles.modalDeductionRow}>
                      <Text style={styles.modalDeductionName}>• {d.title}</Text>
                      <Text style={styles.modalDeductionCost}>-₹{Number(d.amount).toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                  <View style={styles.modalDivider} />
                  <View style={styles.modalDeductionRow}>
                    <Text style={styles.modalNetLabel}>Net Refund to Tenant:</Text>
                    <Text style={styles.modalNetVal}>₹{Number(securityDeposit.netRefund).toLocaleString('en-IN')}</Text>
                  </View>
                </View>
              ) : null}

              {/* Terms & Guidance */}
              <View style={styles.modalTermsBox}>
                <Text style={styles.modalTermsTitle}>Deposit Rules & Handover Terms</Text>
                <Text style={styles.modalTermsItem}>
                  1. <Text style={{ fontFamily: fonts.interSemiBold }}>Advance Payment:</Text> The security deposit is set by your landlord and collected in advance prior to handing over the keys.
                </Text>
                <Text style={styles.modalTermsItem}>
                  2. <Text style={{ fontFamily: fonts.interSemiBold }}>Move-Out Inspection:</Text> When you vacate, the landlord conducts a walkthrough inspection for paint condition, deep cleaning, and any damage beyond normal wear and tear.
                </Text>
                <Text style={styles.modalTermsItem}>
                  3. <Text style={{ fontFamily: fonts.interSemiBold }}>Refund Timeline:</Text> The remaining deposit after agreed deductions is refunded within 30 days of vacating.
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setDepositModalVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalDoneBtnText}>Got It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, padding: 24,
  },

  balanceHero: {
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 20,
    paddingVertical: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceInfo: {
    flex: 1,
  },
  balanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  balanceLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.onPrimaryContainer,
    opacity: 0.6,
    textTransform: 'uppercase',
  },
  balanceAmount: {
    fontFamily: fonts.manropeBold,
    fontSize: 34,
    color: colors.onPrimaryContainer,
    marginBottom: 2,
  },
  balanceDueText: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onPrimaryContainer,
    opacity: 0.7,
  },
  makePaymentBtn: {
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  makePaymentBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 13,
    color: colors.primary,
  },

  quickLinksSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  quickLinksTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 16,
    color: colors.onSurface,
    marginBottom: 16,
  },
  quickLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
  },
  quickLinkItem: {
    alignItems: 'center',
    width: 80,
  },
  quickLinkCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  quickLinkLabel: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 15,
  },
  utilityDashboardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  utilityDashCard: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: `${colors.primary}18`,
  },
  utilityDashTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  utilityDashTitle: {
    fontFamily: fonts.manropeBold,
    fontSize: 14,
    color: colors.onSurface,
  },
  utilityDashDept: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    marginBottom: 6,
  },
  utilityDashAmount: {
    fontFamily: fonts.manropeBold,
    fontSize: 18,
    color: colors.primary,
  },

  section: { padding: 20 },

  statusCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statusText: { fontFamily: fonts.interRegular, fontSize: 14, color: colors.onSurface, flex: 1 },

  quickAccessBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  quickIconBg: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center',
  },
  quickAccessLabel: {
    fontFamily: fonts.interMedium, fontSize: 14,
    color: colors.onSurface, flex: 1,
  },

  docRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12, padding: 14,
  },
  docCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  docusignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  signNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
  },
  signNowBtnText: {
    fontFamily: fonts.interSemiBold,
    fontSize: 14,
    color: colors.onPrimary,
  },
  docInfo: { flex: 1 },
  docName: { fontFamily: fonts.interSemiBold, fontSize: 14, color: colors.onSurface, marginBottom: 2 },
  docMeta: { fontFamily: fonts.interRegular, fontSize: 12, color: colors.onSurfaceVariant },
  noDocText: { fontFamily: fonts.interRegular, fontSize: 14, color: colors.onSurfaceVariant },

  errorTitle: { fontFamily: fonts.manropeSemiBold, fontSize: 18, color: colors.onSurface, marginTop: 12, marginBottom: 6 },
  errorMsg: { fontFamily: fonts.interRegular, fontSize: 13, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20 },
  retryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 28 },
  retryText: { fontFamily: fonts.interSemiBold, fontSize: 14, color: colors.onPrimary },

  /* Deposit Card Styles */
  depositCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: `${colors.primary}18`,
  },
  depositCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  depositCardLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
  },
  depositIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  depositTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  depositCardTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 14,
    color: colors.onSurface,
  },
  depositTag: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  depositTagText: {
    fontFamily: fonts.interMedium,
    fontSize: 10,
  },
  depositCardDesc: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.onSurfaceVariant,
    lineHeight: 16,
  },
  depositCardValue: {
    fontFamily: fonts.manropeBold,
    fontSize: 17,
    color: colors.primary,
  },
  depositDeductionBox: {
    backgroundColor: `${colors.error}08`,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: `${colors.error}20`,
  },
  depositDeductionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  depositDeductionTitle: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11.5,
    color: colors.error,
  },
  depositDeductionTotal: {
    fontFamily: fonts.manropeBold,
    fontSize: 12,
    color: colors.error,
  },
  depositDeductionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  depositDeductionItemName: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
  depositDeductionItemVal: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
    color: colors.error,
  },
  depositDeductionDivider: {
    height: 1,
    backgroundColor: `${colors.error}25`,
    marginVertical: 6,
  },
  depositNetRefundLabel: {
    fontFamily: fonts.interBold,
    fontSize: 12,
    color: colors.onSurface,
  },
  depositNetRefundVal: {
    fontFamily: fonts.manropeBold,
    fontSize: 13,
    color: colors.tertiaryFixedDim,
  },
  depositCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: `${colors.outlineVariant}50`,
  },
  depositCardFooterText: {
    fontFamily: fonts.interRegular,
    fontSize: 11,
    color: colors.outline,
    flex: 1,
  },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
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
    fontSize: 18,
    color: colors.onSurface,
  },
  modalSubtitle: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  modalSummaryBox: {
    backgroundColor: colors.primaryContainer,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  modalDepositLabel: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.onPrimaryContainer,
    opacity: 0.7,
  },
  modalDepositVal: {
    fontFamily: fonts.manropeBold,
    fontSize: 28,
    color: colors.onPrimaryContainer,
    marginVertical: 4,
  },
  modalBadgeRow: {
    marginTop: 4,
  },
  depositStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  depositStatusText: {
    fontFamily: fonts.interMedium,
    fontSize: 11,
  },
  modalSectionBox: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  modalSectionTitle: {
    fontFamily: fonts.interSemiBold,
    fontSize: 11.5,
    color: colors.error,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  modalSectionSub: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.onSurfaceVariant,
    marginBottom: 8,
  },
  modalDeductionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  modalDeductionName: {
    fontFamily: fonts.interRegular,
    fontSize: 12,
    color: colors.onSurface,
  },
  modalDeductionCost: {
    fontFamily: fonts.interSemiBold,
    fontSize: 12,
    color: colors.error,
  },
  modalDivider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 6,
    opacity: 0.4,
  },
  modalNetLabel: {
    fontFamily: fonts.interBold,
    fontSize: 12.5,
    color: colors.onSurface,
  },
  modalNetVal: {
    fontFamily: fonts.manropeBold,
    fontSize: 14,
    color: colors.tertiaryFixedDim,
  },
  modalTermsBox: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  modalTermsTitle: {
    fontFamily: fonts.manropeSemiBold,
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
  },
  modalTermsItem: {
    fontFamily: fonts.interRegular,
    fontSize: 11.5,
    color: colors.onSurfaceVariant,
    lineHeight: 16,
  },
  modalDoneBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalDoneBtnText: {
    fontFamily: fonts.interBold,
    fontSize: 14,
    color: colors.onPrimary,
  },
});
