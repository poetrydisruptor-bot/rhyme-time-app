require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// --- Stripe webhook route (raw body) ---
app.post(
  '/stripe-webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === 'checkout.session.completed') {
        console.log('✅ Payment succeeded');
        // Your logic here
      }

      res.json({ received: true });
    } catch (err) {
      console.error('Stripe webhook error:', err.message);
      res.status(400).send('Webhook error');
    }
  }
);

// --- Middleware for normal routes ---
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
