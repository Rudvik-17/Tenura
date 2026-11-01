import { supabase } from '../lib/supabase';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPaymentUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export async function createRazorpayOrder(paymentId) {
  if (!isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('A valid rent payment obligation is required to start Razorpay checkout.'),
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('razorpay', {
      body: {
        action: 'create-order',
        paymentId: paymentId.trim(),
      },
    });

    if (error || !data || data.error) {
      return {
        data: null,
        error: new Error(error?.message || data?.error || 'Failed to generate Razorpay order.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Network error while creating payment order.'),
    };
  }
}

export async function verifyRazorpayCheckout({
  orderId,
  razorpayPaymentId,
  signature,
  paymentId,
}) {
  if (!orderId || !razorpayPaymentId || !signature || !isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('Missing or invalid payment verification details.'),
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('razorpay', {
      body: {
        action: 'verify-payment',
        razorpay_order_id: String(orderId).trim(),
        razorpay_payment_id: String(razorpayPaymentId).trim(),
        razorpay_signature: String(signature).trim(),
        paymentId: paymentId.trim(),
      },
    });

    if (error || !data || data.error) {
      return {
        data: null,
        error: new Error(error?.message || data?.error || 'Payment verification failed.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Network error while verifying payment.'),
    };
  }
}

export async function reconcileRazorpayPayment({ paymentId, orderId = null }) {
  if (!isValidPaymentUuid(paymentId)) {
    return { data: { reconciled: false }, error: null };
  }

  const cleanPaymentId = paymentId.trim();

  try {
    // First run database-level reconciliation of any already-captured attempt
    const { data: dbReconciled } = await supabase.rpc('reconcile_captured_payment_attempts', {
      p_payment_id: cleanPaymentId,
    });

    if (dbReconciled?.reconciled && dbReconciled?.status === 'paid') {
      return {
        data: {
          success: true,
          reconciled: true,
          status: 'paid',
          paymentId: dbReconciled.payment_id || cleanPaymentId,
          amount: Number(dbReconciled.amount),
          paidAt: dbReconciled.paid_at,
          transactionId: dbReconciled.razorpay_payment_id,
          orderId: dbReconciled.razorpay_order_id,
        },
        error: null,
      };
    }

    const { data, error } = await supabase.functions.invoke('razorpay', {
      body: {
        action: 'reconcile-payment',
        paymentId: cleanPaymentId,
        ...(orderId ? { razorpay_order_id: String(orderId).trim() } : {}),
      },
    });

    if (error || !data || data.error) {
      return {
        data: dbReconciled || null,
        error: new Error(error?.message || data?.error || 'Could not reconcile payment status.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Network error during payment reconciliation.'),
    };
  }
}

export async function reportRazorpayAttemptFailed({ orderId, reason = null }) {
  if (!orderId || typeof orderId !== 'string') {
    return { data: null, error: null };
  }

  try {
    const { data, error } = await supabase.functions.invoke('razorpay', {
      body: {
        action: 'fail-attempt',
        razorpay_order_id: orderId.trim(),
        reason: reason || 'Checkout cancelled or failed on client',
      },
    });

    if (error || data?.error) {
      return {
        data: null,
        error: new Error(error?.message || data?.error || 'Could not report failed attempt.'),
      };
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function fetchCurrentRentObligation(targetDueDate = null) {
  try {
    const { data, error } = await supabase.rpc('ensure_current_rent_obligation', {
      p_target_due_date: targetDueDate,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Could not load current rent obligation.'),
    };
  }
}

export async function submitUpiReference({ paymentId, utrNumber, paymentMethod }) {
  if (!isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('A valid rent payment obligation is required to submit a UPI reference.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('submit_upi_payment', {
      p_payment_id: paymentId.trim(),
      p_utr_number: String(utrNumber || '').trim(),
      p_payment_method: String(paymentMethod || 'gpay').trim().toLowerCase(),
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Failed to submit UPI reference.'),
    };
  }
}

export async function reviewUpiPayment({ paymentId, decision, reason = null, notes = null }) {
  if (!isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('A valid payment ID is required to review a UPI reference.'),
    };
  }

  const effectiveReason = reason ?? notes;

  try {
    const { data, error } = await supabase.rpc('review_upi_payment', {
      p_payment_id: paymentId.trim(),
      p_decision: String(decision || '').trim().toLowerCase(),
      p_reason: effectiveReason ? String(effectiveReason).trim() : null,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Failed to review UPI reference.'),
    };
  }
}

export async function configurePropertyUpiDestination({
  propertyId,
  upiId,
  payeeName,
  verified = true,
}) {
  if (!isValidPaymentUuid(propertyId)) {
    return {
      data: null,
      error: new Error('A valid property ID is required.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('configure_property_upi_destination', {
      p_property_id: propertyId.trim(),
      p_upi_id: upiId ? String(upiId).trim() : null,
      p_payee_name: payeeName ? String(payeeName).trim() : null,
      p_verified: Boolean(verified),
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Failed to configure UPI destination.'),
    };
  }
}

export async function refundPayment({
  paymentId,
  refundAmount = null,
  reason = null,
  refundReference = null,
  externalRefundId = null,
}) {
  if (!isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('A valid payment ID is required to issue a refund.'),
    };
  }

  const effectiveRef = refundReference ?? externalRefundId;

  try {
    const { data, error } = await supabase.rpc('refund_payment', {
      p_payment_id: paymentId.trim(),
      p_refund_amount: refundAmount != null ? Number(refundAmount) : null,
      p_reason: reason ? String(reason).trim() : null,
      p_refund_reference: effectiveRef ? String(effectiveRef).trim() : null,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Failed to refund payment.'),
    };
  }
}

export async function reversePayment({
  paymentId,
  reason = null,
  reversalReference = null,
}) {
  if (!isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('A valid payment ID is required to reverse a payment.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('reverse_payment', {
      p_payment_id: paymentId.trim(),
      p_reason: reason ? String(reason).trim() : null,
      p_reversal_reference: reversalReference ? String(reversalReference).trim() : null,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Failed to reverse payment.'),
    };
  }
}

export async function correctPaymentRecord({ paymentId, newAmount, reason }) {
  if (!isValidPaymentUuid(paymentId)) {
    return {
      data: null,
      error: new Error('A valid payment ID is required to correct a payment record.'),
    };
  }

  try {
    const { data, error } = await supabase.rpc('correct_payment_record', {
      p_payment_id: paymentId.trim(),
      p_new_amount: Number(newAmount),
      p_reason: String(reason || '').trim(),
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: new Error(err?.message || 'Failed to correct payment record.'),
    };
  }
}

export async function verifyPaymentReceiptEligibility(paymentId) {
  if (!isValidPaymentUuid(paymentId)) {
    const invalidPayload = {
      eligible: false,
      reason: 'Valid payment obligation ID is required.',
      payment: null,
    };
    return {
      data: invalidPayload,
      error: null,
      ...invalidPayload,
    };
  }

  try {
    const { data, error } = await supabase.rpc('verify_payment_receipt_eligibility', {
      p_payment_id: paymentId.trim(),
    });

    if (error) {
      const errPayload = { eligible: false, reason: error.message, payment: null };
      return {
        data: errPayload,
        error: new Error(error.message),
        ...errPayload,
      };
    }

    const normalizedPayment = data?.eligible
      ? (data.payment || {
          id: data.payment_id || data.id,
          payment_id: data.payment_id || data.id,
          amount: data.amount ?? data.gross_amount,
          gross_amount: data.gross_amount ?? data.amount,
          refunded_amount: data.refunded_amount ?? 0,
          net_amount: data.net_amount ?? data.amount ?? data.gross_amount,
          status: data.status,
          verification_status: data.verification_status,
          paid_at: data.paid_at,
          due_date: data.due_date,
          payment_method: data.payment_method,
          transaction_id: data.transaction_id,
          utr_number: data.utr_number,
          tenant_name: data.tenant_name,
          unit_number: data.unit_number,
          property_name: data.property_name,
        })
      : null;

    const normalized = {
      ...(data || {}),
      eligible: Boolean(data?.eligible),
      payment: normalizedPayment,
    };

    return {
      data: normalized,
      error: null,
      ...normalized,
    };
  } catch (err) {
    const fallback = {
      eligible: false,
      reason: err?.message || 'Receipt verification failed.',
      payment: null,
    };
    return {
      data: fallback,
      error: err,
      ...fallback,
    };
  }
}


