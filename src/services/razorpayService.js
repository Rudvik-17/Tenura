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

  try {
    const { data, error } = await supabase.functions.invoke('razorpay', {
      body: {
        action: 'reconcile-payment',
        paymentId: paymentId.trim(),
        ...(orderId ? { razorpay_order_id: String(orderId).trim() } : {}),
      },
    });

    if (error || !data || data.error) {
      return {
        data: null,
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
