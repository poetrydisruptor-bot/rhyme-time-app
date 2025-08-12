require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Supabase client (Service Role key)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Stripe webhook route (raw body) ---
app.post(
  '/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      console.log(`📩 Received webhook: ${event.type}`);

      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object);
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionChanged(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;

        default:
          console.log(`📋 Unhandled event type: ${event.type}`);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error('❌ Webhook error:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// Handle successful checkout
async function handleCheckoutCompleted(session) {
  console.log(`🛒 Processing checkout completion for session: ${session.id}`);

  try {
    // Get full session details
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items.data.price']
    });

    const email = fullSession.customer_details?.email || null;
    const customerId = fullSession.customer || null;
    const subscriptionId = fullSession.subscription || null;

    if (!email) {
      throw new Error('No email found in session');
    }

    let plan = 'one_time';
    let status = 'active';
    let current_period_start = new Date().toISOString();
    let current_period_end = null;

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price']
      });

      plan = subscription.items.data[0]?.price?.recurring?.interval || 'unknown';
      status = subscription.status;
      current_period_start = new Date(subscription.current_period_start * 1000).toISOString();
      current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
    }

    await updateSubscription(email, {
      plan,
      status,
      current_period_start,
      current_period_end,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId
    });

  } catch (error) {
    console.error('❌ Error handling checkout completion:', error);
    throw error;
  }
}

// Handle subscription changes (renewals, upgrades, etc.)
async function handleSubscriptionChanged(subscription) {
  console.log(`🔄 Processing subscription change: ${subscription.id}`);

  try {
    const customer = await stripe.customers.retrieve(subscription.customer);
    const email = customer.email;

    if (!email) {
      throw new Error('No email found for customer');
    }

    const plan = subscription.items.data[0]?.price?.recurring?.interval || 'unknown';
    const status = subscription.status;
    const current_period_start = new Date(subscription.current_period_start * 1000).toISOString();
    const current_period_end = new Date(subscription.current_period_end * 1000).toISOString();

    await updateSubscription(email, {
      plan,
      status,
      current_period_start,
      current_period_end,
      stripe_subscription_id: subscription.id
    });

  } catch (error) {
    console.error('❌ Error handling subscription change:', error);
    throw error;
  }
}

// Handle subscription cancellation
async function handleSubscriptionDeleted(subscription) {
  console.log(`❌ Processing subscription deletion: ${subscription.id}`);

  try {
    const customer = await stripe.customers.retrieve(subscription.customer);
    const email = customer.email;

    if (!email) {
      throw new Error('No email found for customer');
    }

    await updateSubscription(email, {
      status: 'canceled',
      canceled_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error handling subscription deletion:', error);
    throw error;
  }
}

// Handle successful payment (renewals)
async function handlePaymentSucceeded(invoice) {
  console.log(`💳 Processing successful payment: ${invoice.id}`);

  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    await handleSubscriptionChanged(subscription);
  }
}

// Handle failed payment
async function handlePaymentFailed(invoice) {
  console.log(`💥 Processing failed payment: ${invoice.id}`);

  try {
    const customer = await stripe.customers.retrieve(invoice.customer);
    const email = customer.email;

    if (email) {
      await updateSubscription(email, {
        status: 'past_due'
      });
    }
  } catch (error) {
    console.error('❌ Error handling payment failure:', error);
  }
}

// Utility function to update subscription in Supabase
async function updateSubscription(email, subscriptionData) {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .upsert({
        email,
        ...subscriptionData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'email' });

    if (error) {
      console.error('Supabase upsert error:', error);
      throw error;
    }

    console.log(`✅ Subscription updated for ${email}:`, subscriptionData);
    return data;
  } catch (error) {
    console.error(`❌ Failed to update subscription for ${email}:`, error);
    throw error;
  }
}

// --- Regular middleware AFTER webhook route ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API routes ---
app.get('/api/hello', (_req, res) => {
  res.json({ ok: true, message: 'Hello from Rhyme Time API!' });
});

app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Test endpoint to check Supabase connection
app.get('/api/test-db', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('count')
      .limit(1);

    if (error) {
      throw error;
    }

    res.json({ ok: true, message: 'Database connection successful' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// --- Static files ---
app.use(express.static(path.join(__dirname)));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 RhymeTime server listening on port ${PORT}`);
  console.log(`📡 Webhook endpoint: /stripe-webhook`);
  console.log(`🏥 Health check: /health`);
});
