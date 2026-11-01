import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') || ''
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') || ''
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') || ''

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface PaymentAttemptRow {
  id: string
  payment_id: string
  tenant_id: string
  user_id: string
  expected_amount_paise: number
  currency: string
  provider: string
  provider_order_id: string
  provider_payment_id: string | null
  provider_signature: string | null
  status: 'created' | 'captured' | 'consumed' | 'failed' | 'expired'
  consumed_at: string | null
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const cleanA = a.trim().toLowerCase()
  const cleanB = b.trim().toLowerCase()
  if (cleanA.length !== cleanB.length || cleanA.length === 0) {
    return false
  }
  let diff = 0
  for (let i = 0; i < cleanA.length; i++) {
    diff |= cleanA.charCodeAt(i) ^ cleanB.charCodeAt(i)
  }
  return diff === 0
}

async function computeHmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  )
  const hashArray = Array.from(new Uint8Array(sigBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifySignature(orderId: string, paymentId: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !orderId || !paymentId || !signature) return false
  const generatedSignature = await computeHmacSha256Hex(`${orderId}|${paymentId}`, secret)
  return timingSafeEqualHex(generatedSignature, signature)
}

function getRazorpayBasicAuthHeader(): string {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay API credentials are not configured on the server')
  }
  return `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`
}

async function fetchRazorpayOrder(orderId: string): Promise<Record<string, any>> {
  const response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: {
      'Authorization': getRazorpayBasicAuthHeader(),
      'Content-Type': 'application/json',
    },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.description || `Failed to fetch Razorpay order ${orderId}`)
  }
  return data
}

async function fetchRazorpayPayment(paymentId: string): Promise<Record<string, any>> {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      'Authorization': getRazorpayBasicAuthHeader(),
      'Content-Type': 'application/json',
    },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.description || `Failed to fetch Razorpay payment ${paymentId}`)
  }
  return data
}

async function captureRazorpayPayment(paymentId: string, amountPaise: number, currency: string): Promise<Record<string, any>> {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': getRazorpayBasicAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency,
    }),
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.description || `Failed to capture Razorpay payment ${paymentId}`)
  }
  return data
}

async function fetchRazorpayOrderPayments(orderId: string): Promise<Record<string, any>[]> {
  const response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`, {
    method: 'GET',
    headers: {
      'Authorization': getRazorpayBasicAuthHeader(),
      'Content-Type': 'application/json',
    },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.description || `Failed to fetch payments for Razorpay order ${orderId}`)
  }
  return Array.isArray(data.items) ? data.items : []
}

async function verifyAndSettleAttempt(params: {
  supabaseAdmin: SupabaseClient
  attempt: PaymentAttemptRow
  rzpPayment: Record<string, any>
  signature?: string | null
  callerUserId?: string | null
  targetPaymentId?: string | null
}): Promise<Record<string, any>> {
  const { supabaseAdmin, attempt, signature, callerUserId, targetPaymentId } = params
  let rzpPayment = params.rzpPayment

  const expectedPaise = Number(attempt.expected_amount_paise)
  const expectedCurrency = String(attempt.currency || 'INR').toUpperCase()

  if (!rzpPayment || !rzpPayment.id) {
    throw new Error('Invalid provider payment record')
  }

  if (rzpPayment.order_id !== attempt.provider_order_id) {
    throw new Error('Provider payment order_id does not match the bound payment attempt')
  }

  const providerAmountPaise = Number(rzpPayment.amount)
  const providerCurrency = String(rzpPayment.currency || '').toUpperCase()

  if (!Number.isFinite(providerAmountPaise) || providerAmountPaise !== expectedPaise) {
    throw new Error(`Provider payment amount (${providerAmountPaise} paise) does not match expected obligation (${expectedPaise} paise)`)
  }

  if (providerCurrency !== expectedCurrency) {
    throw new Error(`Provider payment currency (${providerCurrency}) does not match expected currency (${expectedCurrency})`)
  }

  // If payment is authorized but not yet captured, capture the exact expected amount
  if (rzpPayment.status === 'authorized') {
    rzpPayment = await captureRazorpayPayment(rzpPayment.id, expectedPaise, expectedCurrency)
  }

  if (rzpPayment.status !== 'captured') {
    throw new Error(`Provider payment is not captured (current status: ${rzpPayment.status || 'unknown'})`)
  }

  if (rzpPayment.refund_status || Number(rzpPayment.amount_refunded || 0) > 0) {
    throw new Error('Provider payment has been refunded and cannot settle rent obligation')
  }

  // Verify the provider order state as well
  const rzpOrder = await fetchRazorpayOrder(attempt.provider_order_id)
  if (rzpOrder.id !== attempt.provider_order_id) {
    throw new Error('Provider order ID mismatch')
  }

  if (Number(rzpOrder.amount) !== expectedPaise) {
    throw new Error(`Provider order amount (${rzpOrder.amount} paise) does not match expected obligation (${expectedPaise} paise)`)
  }

  if (String(rzpOrder.currency || '').toUpperCase() !== expectedCurrency) {
    throw new Error(`Provider order currency (${rzpOrder.currency}) does not match expected currency (${expectedCurrency})`)
  }

  if (rzpOrder.receipt && rzpOrder.receipt !== attempt.payment_id) {
    throw new Error('Provider order receipt does not match bound payment obligation')
  }

  if (rzpOrder.notes?.payment_id && rzpOrder.notes.payment_id !== attempt.payment_id) {
    throw new Error('Provider order notes.payment_id does not match bound payment obligation')
  }

  const providerCreatedAt = typeof rzpPayment.created_at === 'number'
    ? new Date(rzpPayment.created_at * 1000).toISOString()
    : new Date().toISOString()

  // Persist capture evidence first so even a transient failure before settlement can be reconciled without re-charging
  await supabaseAdmin.rpc('record_razorpay_attempt_capture', {
    p_provider_order_id: attempt.provider_order_id,
    p_provider_payment_id: rzpPayment.id,
    p_verified_amount_paise: providerAmountPaise,
    p_provider_signature: signature ?? null,
  })

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('consume_razorpay_payment_attempt', {
    p_provider_order_id: attempt.provider_order_id,
    p_provider_payment_id: rzpPayment.id,
    p_provider_signature: signature ?? null,
    p_verified_amount_paise: providerAmountPaise,
    p_verified_currency: providerCurrency,
    p_caller_user_id: callerUserId ?? null,
    p_target_payment_id: targetPaymentId ?? attempt.payment_id,
    p_paid_at: providerCreatedAt,
  })

  if (rpcError) {
    throw new Error(rpcError.message)
  }

  return rpcData as Record<string, any>
}

async function reconcilePendingAttemptsForPayment(params: {
  supabaseAdmin: SupabaseClient
  paymentId: string
  callerUserId?: string | null
  specificOrderId?: string | null
}): Promise<Record<string, any> | null> {
  const { supabaseAdmin, paymentId, callerUserId, specificOrderId } = params

  // 1. First run database-level reconciliation of any already-captured attempt
  const { data: dbReconciled } = await supabaseAdmin.rpc('reconcile_captured_payment_attempts', {
    p_payment_id: paymentId,
    p_caller_user_id: callerUserId ?? null,
  })

  if (dbReconciled && dbReconciled.reconciled && dbReconciled.status === 'paid') {
    return dbReconciled as Record<string, any>
  }

  let query = supabaseAdmin
    .from('payment_attempts')
    .select('*')
    .eq('payment_id', paymentId)
    .in('status', ['created', 'captured', 'consumed', 'expired'])
    .order('created_at', { ascending: false })
    .limit(10)

  if (callerUserId) {
    query = query.eq('user_id', callerUserId)
  }
  if (specificOrderId) {
    query = query.eq('provider_order_id', specificOrderId)
  }

  const { data: attempts, error: attemptsError } = await query
  if (attemptsError || !attempts || attempts.length === 0) {
    return null
  }

  for (const attempt of attempts as PaymentAttemptRow[]) {
    if (attempt.status === 'consumed' && attempt.provider_payment_id) {
      const { data: paidRow } = await supabaseAdmin
        .from('payments')
        .select('id, tenant_id, amount, status, paid_at, razorpay_order_id, razorpay_payment_id')
        .eq('id', attempt.payment_id)
        .maybeSingle()

      if (paidRow && paidRow.status === 'paid') {
        return {
          success: true,
          idempotent_replay: true,
          attempt_id: attempt.id,
          payment_id: paidRow.id,
          tenant_id: paidRow.tenant_id,
          amount: paidRow.amount,
          paid_at: paidRow.paid_at,
          razorpay_order_id: paidRow.razorpay_order_id,
          razorpay_payment_id: paidRow.razorpay_payment_id,
        }
      }
    }

    try {
      const orderPayments = await fetchRazorpayOrderPayments(attempt.provider_order_id)
      const matchingPayment = orderPayments.find((item) =>
        item &&
        item.order_id === attempt.provider_order_id &&
        Number(item.amount) === Number(attempt.expected_amount_paise) &&
        String(item.currency || '').toUpperCase() === String(attempt.currency || 'INR').toUpperCase() &&
        (item.status === 'captured' || item.status === 'authorized') &&
        !item.refund_status &&
        Number(item.amount_refunded || 0) === 0
      )

      if (matchingPayment) {
        const settled = await verifyAndSettleAttempt({
          supabaseAdmin,
          attempt,
          rzpPayment: matchingPayment,
          signature: attempt.provider_signature,
          callerUserId,
          targetPaymentId: paymentId,
        })
        return settled
      }
    } catch (err) {
      console.warn(`Reconciliation check failed for order ${attempt.provider_order_id}:`, (err as Error).message)
    }
  }

  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

  const rawBody = await req.text()

  // Handle Razorpay server-to-server webhook if x-razorpay-signature is present
  const webhookSignature = req.headers.get('x-razorpay-signature')
  if (webhookSignature) {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      return jsonResponse({ error: 'Webhook secret not configured' }, 500)
    }
    const expectedWebhookSig = await computeHmacSha256Hex(rawBody, RAZORPAY_WEBHOOK_SECRET)
    if (!timingSafeEqualHex(expectedWebhookSig, webhookSignature)) {
      return jsonResponse({ error: 'Invalid webhook signature' }, 401)
    }

    try {
      const event = JSON.parse(rawBody)
      const eventName = String(event?.event || '')
      const paymentEntity = event?.payload?.payment?.entity
      const refundEntity = event?.payload?.refund?.entity
      const orderId = paymentEntity?.order_id || event?.payload?.order?.entity?.id
      const paymentId = paymentEntity?.id || refundEntity?.payment_id

      if (eventName === 'refund.failed') {
        return jsonResponse({ received: true, ignored: true, reason: 'refund_failed' })
      }

      // Handle provider-initiated refund webhooks (refund.processed / refund.created / payment.refunded)
      if (eventName === 'refund.processed' || eventName === 'refund.created' || eventName === 'payment.refunded') {
        if (!paymentId) {
          return jsonResponse({ received: true, ignored: true, reason: 'missing_refund_payment_id' })
        }

        const { data: paidPayment } = await supabaseAdmin
          .from('payments')
          .select('id, amount, status')
          .eq('razorpay_payment_id', paymentId)
          .maybeSingle()

        if (!paidPayment) {
          return jsonResponse({ received: true, ignored: true, reason: 'unknown_payment_for_refund' })
        }

        const refundPaise = Number(refundEntity?.amount || paymentEntity?.amount_refunded || 0)
        const refundRupees = refundPaise > 0 ? Number((refundPaise / 100).toFixed(2)) : Number(paidPayment.amount)
        const refundRef = refundEntity?.id || `RZP-RFND-${paymentId}`

        const { data: refundResult, error: refundErr } = await supabaseAdmin.rpc('refund_payment', {
          p_payment_id: paidPayment.id,
          p_refund_amount: refundRupees,
          p_reason: `Razorpay webhook (${eventName})`,
          p_refund_reference: refundRef,
        })

        if (refundErr) {
          throw new Error(refundErr.message)
        }

        return jsonResponse({
          received: true,
          refunded: true,
          paymentId: paidPayment.id,
          status: refundResult?.status,
          netAmount: refundResult?.net_amount,
          idempotentReplay: refundResult?.idempotent_replay,
        })
      }

      if (!orderId) {
        return jsonResponse({ received: true, ignored: true })
      }

      const { data: attempt } = await supabaseAdmin
        .from('payment_attempts')
        .select('*')
        .eq('provider_order_id', orderId)
        .maybeSingle()

      if (!attempt) {
        return jsonResponse({ received: true, ignored: true, reason: 'unknown_order' })
      }

      // Handle failed checkout webhook without settling or issuing receipt
      if (eventName === 'payment.failed') {
        const failureReason = paymentEntity?.error_description || paymentEntity?.error_reason || 'Webhook payment.failed'
        await supabaseAdmin.rpc('mark_razorpay_attempt_failed', {
          p_provider_order_id: orderId,
          p_failure_reason: failureReason,
        })
        return jsonResponse({ received: true, status: 'failed', orderId })
      }

      // Ignore informational events before authorization/capture
      if (eventName && !['payment.captured', 'payment.authorized', 'order.paid'].includes(eventName)) {
        return jsonResponse({ received: true, ignored: true, event: eventName })
      }

      if (!paymentId) {
        return jsonResponse({ received: true, ignored: true })
      }

      const freshPayment = await fetchRazorpayPayment(paymentId)
      const settled = await verifyAndSettleAttempt({
        supabaseAdmin,
        attempt: attempt as PaymentAttemptRow,
        rzpPayment: freshPayment,
      })

      return jsonResponse({
        received: true,
        reconciled: true,
        paymentId: settled.payment_id,
        paidAt: settled.paid_at,
        idempotentReplay: settled.idempotent_replay,
      })
    } catch (err) {
      const msg = (err as Error).message || 'Webhook processing error'
      console.error('Razorpay webhook processing error:', msg)
      const isPermanentValidationError = /mismatch|already settled|already been used|not found|JSON/i.test(msg)
      return jsonResponse({ error: msg }, isPermanentValidationError ? 400 : 500)
    }
  }

  // Authenticate caller via Supabase Auth JWT
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  let authenticatedUser: { id: string; email?: string } | null = null

  if (token) {
    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (!authError && userData?.user) {
      authenticatedUser = { id: userData.user.id, email: userData.user.email }
    }
  }

  const now = new Date()
  const limit = 10
  const windowMs = 60000

  let clientIdentifier = ''
  if (authenticatedUser?.id) {
    clientIdentifier = `usr_${authenticatedUser.id}`
  } else {
    const rawIp = req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || 'anon_client'
    clientIdentifier = `ip_${rawIp}`
  }

  const key = `razorpay:${clientIdentifier}`

  // Asynchronously purge expired rate limits to keep table bounded
  supabaseAdmin
    .from('rate_limits')
    .delete()
    .lt('reset_at', now.toISOString())
    .then(() => {})
    .catch((err: Error) => console.warn('Rate limit cleanup error:', err.message))

  let isLimited = false
  let retryAfter = 60

  try {
    const { data: record, error: recordError } = await supabaseAdmin
      .from('rate_limits')
      .select('count, reset_at')
      .eq('id', key)
      .maybeSingle()

    if (recordError) {
      console.error('Database rate limit check error:', recordError.message)
    }

    const resetAtDate = record ? new Date(record.reset_at) : null
    const isExpired = !resetAtDate || resetAtDate.getTime() <= now.getTime()

    if (record && !isExpired && record.count >= limit) {
      isLimited = true
      retryAfter = Math.ceil((resetAtDate.getTime() - now.getTime()) / 1000)
    } else if (record && !isExpired) {
      const { error: updateError } = await supabaseAdmin
        .from('rate_limits')
        .update({ count: record.count + 1 })
        .eq('id', key)
      if (updateError) {
        console.error('Database rate limit update error:', updateError.message)
      }
    } else {
      const resetAt = new Date(now.getTime() + windowMs).toISOString()
      const { error: upsertError } = await supabaseAdmin
        .from('rate_limits')
        .upsert({ id: key, count: 1, reset_at: resetAt })
      if (upsertError) {
        console.error('Database rate limit upsert error:', upsertError.message)
      }
    }
  } catch (err) {
    console.error('Rate limit logic error:', (err as Error).message)
  }

  if (isLimited) {
    return jsonResponse({
      error: "Too many requests. Please try again later.",
      retryAfter: retryAfter > 0 ? retryAfter : 60,
    }, 429)
  }

  if (!authenticatedUser) {
    return jsonResponse({ error: 'Authentication required' }, 401)
  }

  try {
    const parsedBody = rawBody ? JSON.parse(rawBody) : {}
    const { action, ...payload } = parsedBody

    if (action === 'create-order') {
      const { paymentId } = payload
      if (!paymentId || typeof paymentId !== 'string' || !UUID_REGEX.test(paymentId.trim())) {
        return jsonResponse({ error: 'A valid paymentId UUID is required' }, 400)
      }

      const cleanPaymentId = paymentId.trim()

      // Fetch payment obligation, owning tenant, and active lease
      const { data: paymentRow, error: pError } = await supabaseAdmin
        .from('payments')
        .select('id, tenant_id, lease_id, amount, original_amount, status, paid_at, razorpay_order_id, razorpay_payment_id, transaction_id, tenants!inner(id, user_id), leases(id, monthly_rent, status)')
        .eq('id', cleanPaymentId)
        .maybeSingle()

      if (pError || !paymentRow) {
        return jsonResponse({ error: 'Payment record not found' }, 404)
      }

      const tenantRecord = Array.isArray(paymentRow.tenants) ? paymentRow.tenants[0] : paymentRow.tenants
      if (!tenantRecord || tenantRecord.user_id !== authenticatedUser.id) {
        return jsonResponse({ error: 'Forbidden: you do not own this payment obligation' }, 403)
      }

      const leaseRecord = Array.isArray(paymentRow.leases) ? paymentRow.leases[0] : paymentRow.leases
      if (!leaseRecord || leaseRecord.status !== 'active') {
        return jsonResponse({ error: 'No active lease associated with this payment obligation' }, 400)
      }

      const verifiedAmount = Number(paymentRow.amount)
      const leaseRent = Number(leaseRecord.monthly_rent)
      if (!paymentRow.original_amount && Number.isFinite(leaseRent) && verifiedAmount !== leaseRent) {
        return jsonResponse({
          error: `Obligation amount (₹${verifiedAmount}) does not match active lease monthly rent (₹${leaseRent})`,
        }, 400)
      }

      const amountInPaise = Math.round(verifiedAmount * 100)
      if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0 || amountInPaise <= 0) {
        return jsonResponse({ error: 'Invalid payment amount in database' }, 400)
      }

      // First reconcile any prior interrupted checkout attempts for this payment obligation
      const reconciled = await reconcilePendingAttemptsForPayment({
        supabaseAdmin,
        paymentId: paymentRow.id,
        callerUserId: authenticatedUser.id,
      })

      if (reconciled && reconciled.success) {
        return jsonResponse({
          alreadyPaid: true,
          reconciled: true,
          paymentId: reconciled.payment_id,
          orderId: reconciled.razorpay_order_id,
          razorpayPaymentId: reconciled.razorpay_payment_id,
          transactionId: reconciled.razorpay_payment_id,
          paidAt: reconciled.paid_at,
          verifiedAmount: Number(reconciled.amount),
          amountPaise: amountInPaise,
          currency: 'INR',
        }, 200)
      }

      if (['paid', 'partially_refunded', 'refunded'].includes(paymentRow.status)) {
        return jsonResponse({
          error: 'Payment is already settled',
          alreadyPaid: true,
          paymentId: paymentRow.id,
          paidAt: paymentRow.paid_at,
          transactionId: paymentRow.razorpay_payment_id || paymentRow.transaction_id,
          verifiedAmount,
        }, 409)
      }

      // Reuse an existing open 'created' attempt if its Razorpay order is still payable (prevents duplicate open orders)
      const { data: openAttempt } = await supabaseAdmin
        .from('payment_attempts')
        .select('id, provider_order_id, expected_amount_paise, currency, created_at')
        .eq('payment_id', paymentRow.id)
        .eq('user_id', authenticatedUser.id)
        .eq('status', 'created')
        .eq('expected_amount_paise', amountInPaise)
        .maybeSingle()

      if (openAttempt?.provider_order_id) {
        const ageMs = now.getTime() - new Date(openAttempt.created_at).getTime()
        if (ageMs < 25 * 60 * 1000) {
          try {
            const existingOrder = await fetchRazorpayOrder(openAttempt.provider_order_id)
            if (
              existingOrder &&
              existingOrder.status === 'created' &&
              Number(existingOrder.amount) === amountInPaise &&
              Number(existingOrder.amount_paid || 0) === 0
            ) {
              return jsonResponse({
                attemptId: openAttempt.id,
                orderId: openAttempt.provider_order_id,
                paymentId: paymentRow.id,
                verifiedAmount,
                amountPaise: amountInPaise,
                currency: 'INR',
                reusedAttempt: true,
              }, 200)
            }
          } catch (_err) {
            // Fall through to create a fresh Razorpay order and expire the stale attempt atomically
          }
        }
      }

      // Create Razorpay order bound to this exact obligation and paise amount
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getRazorpayBasicAuthHeader(),
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: paymentRow.id,
          notes: {
            payment_id: paymentRow.id,
            tenant_id: paymentRow.tenant_id,
            user_id: authenticatedUser.id,
            expected_amount_paise: String(amountInPaise),
          },
        }),
      })

      const order = await response.json()
      if (!response.ok || !order?.id) {
        throw new Error(order.error?.description || 'Failed to create Razorpay order')
      }

      if (Number(order.amount) !== amountInPaise || String(order.currency || '').toUpperCase() !== 'INR') {
        throw new Error('Razorpay order response did not match expected amount or currency')
      }

      // Atomically expire any previous open attempt and register the new attempt (locking payment first)
      const { data: attemptRow, error: attemptError } = await supabaseAdmin.rpc('register_razorpay_payment_attempt', {
        p_payment_id: paymentRow.id,
        p_user_id: authenticatedUser.id,
        p_provider_order_id: order.id,
        p_expected_amount_paise: amountInPaise,
        p_currency: 'INR',
      })

      if (attemptError || !attemptRow) {
        throw new Error(attemptError?.message || 'Failed to record server payment attempt')
      }

      return jsonResponse({
        attemptId: attemptRow.id,
        orderId: order.id,
        paymentId: paymentRow.id,
        verifiedAmount,
        amountPaise: amountInPaise,
        currency: 'INR',
      }, 200)
    }

    if (action === 'verify-payment') {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = payload

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return jsonResponse({ error: 'Missing required Razorpay verification parameters' }, 400)
      }

      const cleanOrderId = String(razorpay_order_id).trim()
      const cleanProviderPaymentId = String(razorpay_payment_id).trim()
      const cleanSignature = String(razorpay_signature).trim()
      const cleanTargetPaymentId = paymentId ? String(paymentId).trim() : null

      if (cleanTargetPaymentId && !UUID_REGEX.test(cleanTargetPaymentId)) {
        return jsonResponse({ error: 'Invalid paymentId format' }, 400)
      }

      // 1. Verify HMAC-SHA256 signature of order_id|payment_id
      const isValidSig = await verifySignature(cleanOrderId, cleanProviderPaymentId, cleanSignature, RAZORPAY_KEY_SECRET)
      if (!isValidSig) {
        return jsonResponse({ error: 'Signature verification failed' }, 400)
      }

      // 2. Load the trusted server-owned payment attempt by provider_order_id
      const { data: attempt, error: attemptError } = await supabaseAdmin
        .from('payment_attempts')
        .select('*')
        .eq('provider_order_id', cleanOrderId)
        .maybeSingle()

      if (attemptError || !attempt) {
        return jsonResponse({ error: 'No trusted payment attempt found for this Razorpay order' }, 404)
      }

      const typedAttempt = attempt as PaymentAttemptRow

      // 3. Enforce tenant/user ownership (Tenant A cannot verify or use Tenant B's attempt)
      if (typedAttempt.user_id !== authenticatedUser.id) {
        return jsonResponse({ error: 'Forbidden: payment attempt belongs to another user' }, 403)
      }

      // 4. Enforce obligation binding (Order for Obligation A cannot settle Obligation B)
      if (cleanTargetPaymentId && cleanTargetPaymentId !== typedAttempt.payment_id) {
        return jsonResponse({
          error: 'Obligation mismatch: this checkout order is bound to a different rent payment',
        }, 403)
      }

      // 5. Fast-path idempotent replay check if this exact attempt + provider payment was already consumed
      if (typedAttempt.status === 'consumed' && typedAttempt.provider_payment_id === cleanProviderPaymentId) {
        const { data: replayResult, error: replayErr } = await supabaseAdmin.rpc('consume_razorpay_payment_attempt', {
          p_provider_order_id: cleanOrderId,
          p_provider_payment_id: cleanProviderPaymentId,
          p_provider_signature: cleanSignature,
          p_verified_amount_paise: Number(typedAttempt.expected_amount_paise),
          p_verified_currency: typedAttempt.currency,
          p_caller_user_id: authenticatedUser.id,
          p_target_payment_id: typedAttempt.payment_id,
          p_paid_at: typedAttempt.consumed_at,
        })

        if (replayErr) {
          return jsonResponse({ error: replayErr.message }, 400)
        }

        return jsonResponse({
          success: true,
          idempotentReplay: true,
          paymentId: replayResult.payment_id,
          amount: Number(replayResult.amount),
          paidAt: replayResult.paid_at,
          transactionId: replayResult.razorpay_payment_id,
          orderId: replayResult.razorpay_order_id,
        }, 200)
      }

      // 6. Verify provider payment & order state directly with Razorpay API and consume atomically once
      const rzpPayment = await fetchRazorpayPayment(cleanProviderPaymentId)
      const settled = await verifyAndSettleAttempt({
        supabaseAdmin,
        attempt: typedAttempt,
        rzpPayment,
        signature: cleanSignature,
        callerUserId: authenticatedUser.id,
        targetPaymentId: cleanTargetPaymentId ?? typedAttempt.payment_id,
      })

      return jsonResponse({
        success: true,
        idempotentReplay: Boolean(settled.idempotent_replay),
        paymentId: settled.payment_id,
        amount: Number(settled.amount),
        paidAt: settled.paid_at,
        transactionId: settled.razorpay_payment_id,
        orderId: settled.razorpay_order_id,
      }, 200)
    }

    if (action === 'reconcile-payment') {
      const { paymentId, razorpay_order_id } = payload
      if (!paymentId || typeof paymentId !== 'string' || !UUID_REGEX.test(paymentId.trim())) {
        return jsonResponse({ error: 'A valid paymentId UUID is required for reconciliation' }, 400)
      }

      const cleanPaymentId = paymentId.trim()
      const cleanOrderId = razorpay_order_id ? String(razorpay_order_id).trim() : null

      const { data: paymentRow, error: pError } = await supabaseAdmin
        .from('payments')
        .select('id, tenant_id, amount, status, paid_at, razorpay_order_id, razorpay_payment_id, transaction_id, tenants!inner(id, user_id)')
        .eq('id', cleanPaymentId)
        .maybeSingle()

      if (pError || !paymentRow) {
        return jsonResponse({ error: 'Payment record not found' }, 404)
      }

      const tenantRecord = Array.isArray(paymentRow.tenants) ? paymentRow.tenants[0] : paymentRow.tenants
      if (!tenantRecord || tenantRecord.user_id !== authenticatedUser.id) {
        return jsonResponse({ error: 'Forbidden: you do not own this payment obligation' }, 403)
      }

      if (paymentRow.status === 'paid') {
        return jsonResponse({
          success: true,
          reconciled: true,
          status: 'paid',
          paymentId: paymentRow.id,
          amount: Number(paymentRow.amount),
          paidAt: paymentRow.paid_at,
          transactionId: paymentRow.razorpay_payment_id || paymentRow.transaction_id,
          orderId: paymentRow.razorpay_order_id,
        }, 200)
      }

      const settled = await reconcilePendingAttemptsForPayment({
        supabaseAdmin,
        paymentId: paymentRow.id,
        callerUserId: authenticatedUser.id,
        specificOrderId: cleanOrderId,
      })

      if (settled && settled.success) {
        return jsonResponse({
          success: true,
          reconciled: true,
          status: 'paid',
          paymentId: settled.payment_id,
          amount: Number(settled.amount),
          paidAt: settled.paid_at,
          transactionId: settled.razorpay_payment_id,
          orderId: settled.razorpay_order_id,
          idempotentReplay: Boolean(settled.idempotent_replay),
        }, 200)
      }

      return jsonResponse({
        success: true,
        reconciled: false,
        status: paymentRow.status,
        paymentId: paymentRow.id,
      }, 200)
    }

    if (action === 'fail-attempt') {
      const { razorpay_order_id, reason } = payload
      if (!razorpay_order_id || typeof razorpay_order_id !== 'string') {
        return jsonResponse({ error: 'razorpay_order_id is required' }, 400)
      }

      const cleanOrderId = razorpay_order_id.trim()
      const { data: attempt } = await supabaseAdmin
        .from('payment_attempts')
        .select('*')
        .eq('provider_order_id', cleanOrderId)
        .maybeSingle()

      if (!attempt) {
        return jsonResponse({ error: 'Payment attempt not found' }, 404)
      }

      if (attempt.user_id !== authenticatedUser.id) {
        return jsonResponse({ error: 'Forbidden: payment attempt belongs to another user' }, 403)
      }

      // Check whether the payment was actually captured right before checkout failed/dismissed
      const settled = await reconcilePendingAttemptsForPayment({
        supabaseAdmin,
        paymentId: attempt.payment_id,
        callerUserId: authenticatedUser.id,
        specificOrderId: cleanOrderId,
      })

      if (settled && settled.success) {
        return jsonResponse({
          success: true,
          reconciled: true,
          status: 'paid',
          paymentId: settled.payment_id,
          amount: Number(settled.amount),
          paidAt: settled.paid_at,
          transactionId: settled.razorpay_payment_id,
          orderId: settled.razorpay_order_id,
        }, 200)
      }

      const { data: failedRow, error: failErr } = await supabaseAdmin.rpc('mark_razorpay_attempt_failed', {
        p_provider_order_id: cleanOrderId,
        p_failure_reason: reason ? String(reason).slice(0, 300) : 'Checkout failed or cancelled',
      })

      if (failErr) {
        return jsonResponse({ error: failErr.message }, 400)
      }

      return jsonResponse({
        success: true,
        reconciled: false,
        status: failedRow?.status || 'failed',
        orderId: cleanOrderId,
        paymentId: attempt.payment_id,
      }, 200)
    }

    return jsonResponse({ error: 'Invalid action' }, 400)
  } catch (error) {
    const message = (error as Error)?.message || 'Internal server error'
    const lower = message.toLowerCase()
    const isClientError =
      lower.includes('mismatch') ||
      lower.includes('unauthorized') ||
      lower.includes('already been') ||
      lower.includes('already settled') ||
      lower.includes('not captured') ||
      lower.includes('refunded') ||
      lower.includes('not found')

    return jsonResponse({ error: message }, isClientError ? 400 : 500)
  }
})
