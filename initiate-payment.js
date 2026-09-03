const axios = require('axios');

// Paystack secret key — set this in Vercel Project Settings > Environment Variables.
// It is NEVER hardcoded here and never sent to the browser.
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

function normalizeKenyanPhone(phone) {
  let p = String(phone).replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (!p.startsWith('254')) p = '254' + p;
  return p;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  if (!PAYSTACK_SECRET_KEY) {
    console.error('Missing PAYSTACK_SECRET_KEY environment variable in Vercel project settings.');
    res.status(500).json({ message: 'Payments are not configured yet. Please try again later.' });
    return;
  }

  try {
    const { phone, amount, plan } = req.body || {};
    if (!phone || !amount || !plan) {
      res.status(400).json({ message: 'phone, amount and plan are required.' });
      return;
    }

    const normalizedPhone = normalizeKenyanPhone(phone);
    const reference = `SKYDIVE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Paystack expects amount in the smallest currency unit (KES cents).
    const response = await axios.post(
      'https://api.paystack.co/charge',
      {
        email: `${normalizedPhone}@skydivenet.customer`, // Paystack requires an email; placeholder is fine
        amount: Math.round(Number(amount) * 100),
        currency: 'KES',
        reference,
        mobile_money: { phone: normalizedPhone, provider: 'mpesa' },
        metadata: { plan, phone: normalizedPhone }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({ reference, message: 'STK push sent. Check your phone.' });
  } catch (err) {
    console.error('initiate-payment error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Could not initiate payment. Please try again.' });
  }
};
