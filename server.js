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

      if (event.type === 'checkout.session.completed') {
        const sessionId = event.data.object.id;

       // Get full session for email + plan details
const session = await stripe.checkout.sessions.retrieve(sessionId, {
  expand: ['line_items.data.price']
});

const email = session.customer_details?.email || null;
const customerId = session.customer || null;
const subscriptionId = session.subscription || null;

let plan = null;
let status = 'active';
let current_period_start = null;
let current_period_end = null;
let canceled_at = null;

if (subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price']
  });

  plan = sub.items.data[0]?.price?.recurring?.interval || null; // 'month' | 'year'
  status = sub.status; // 'active', 'canceled', etc.
  current_period_start = new Date(sub.current_period_start * 1000).toISOString();
  current_period_end   = new Date(sub.current_period_end   * 1000).toISOString();
  canceled_at = sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null;
}

// Upsert into Supabase `subscriptions` by email
const { error } = await supabase
  .from('subscriptions')
  .upsert({
    email,
    plan,
    status,
    current_period_start,
    current_period_end,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    canceled_at,
    updated_at: new Date().toISOString()
  }, { onConflict: 'email' });

if (error) {
  console.error('Supabase upsert error:', error);
  return res.status(500).send('DB error');
}

console.log(`✅ Subscription recorded for ${email} — Plan: ${plan}, Status: ${status}`);

);

// --- Regular middleware AFTER webhook route ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API routes ---
app.get('/api/hello', (_req, res) => {
  res.json({ ok: true, message: 'Hello from Rhyme Time API!' });
});

app.get('/health', (_req, res) => res.send('ok'));

// --- Static files ---
app.use(express.static(path.join(__dirname)));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on ${PORT}`);
});
