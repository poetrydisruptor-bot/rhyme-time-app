const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();

app.use(express.static('.'));
app.use('/stripe-webhook', express.raw({type: 'application/json'}));

app.post('/stripe-webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    
    if (event.type === 'checkout.session.completed') {
      console.log('Payment succeeded!');
    }
    
    res.json({received: true});
  } catch (err) {
    res.status(400).send('Error');
  }
});

app.listen(process.env.PORT || 3000);
