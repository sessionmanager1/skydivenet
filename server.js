/**
 * SKYDIVE NET — Backend
 * Handles M-Pesa STK Push payments via Paystack's Charge API (mobile_money channel, Kenya).
 *
 * SECURITY:
 * - PAYSTACK_SECRET_KEY is read from an environment variable only. It is never sent
 *   to the browser, never logged, and never hardcoded in this file.
 * - The frontend only ever talks to THIS server, never directly to Paystack.
 * - Paystack webhook requests are verified using an HMAC signature before being trusted.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!PAYSTACK_SECRET_KEY) {
  console.error('Missing PAYSTACK_SECRET_KEY environment variable. Set it in your .env file (see .env.example). Refusing to start.');
  process.exit(1);
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// --- Very simple JSON-file transaction store -------------------------------------------
// Good enough to get you running. For production, swap this for a real database
// (Postgres, MySQL, MongoDB, etc.) — a flat file will not scale or handle concurrent writes safely.
const DB_FILE = path.join(__dirname, 'transactions.json');
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
}
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// --- Helpers -----------------------------------------------------------------------------
function normalizeKenyanPhone(phone) {
  let p = String(phone).replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (!p.startsWith('254')) p = '254' + p;
  return p;
}

// --- Routes ------------------------------------------------------------------------------

/**
 * Start a payment. Triggers an M-Pesa STK push to the customer's phone via Paystack.
 * body: { phone, amount, plan }
 */
app.post('/api/initiate-payment', async (req, res) => {
  try {
    const { phone, amount, plan } = req.body;

    if (!phone || !amount || !plan) {
      return res.status(400).json({ message: 'phone, amount and plan are required.' });
    }

    const normalizedPhone = normalizeKenyanPhone(phone);
    const reference = `SKYDIVE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Paystack expects amount in the smallest currency unit (KES cents), so multiply by 100.
    const response = await axios.post(
      'https://api.paystack.co/charge',
      {
        email: `${normalizedPhone}@skydivenet.customer`, // Paystack requires an email; a placeholder is fine here
        amount: Math.round(Number(amount) * 100),
        currency: 'KES',
        reference,
        mobile_money: {
          phone: normalizedPhone,
          provider: 'mpesa'
        },
        metadata: { plan, phone: normalizedPhone }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const db = readDb();
    db[reference] = {
      reference,
      phone: normalizedPhone,
      plan,
      amount,
      status: 'pending',
      date: new Date().toISOString(),
      paystackData: response.data.data
    };
    writeDb(db);

    return res.json({ reference, message: 'STK push sent. Check your phone.' });
  } catch (err) {
    console.error('initiate-payment error:', err.response?.data || err.message);
    return res.status(500).json({ message: 'Could not initiate payment. Please try again.' });
  }
});

/**
 * Poll payment status. The frontend calls this every few seconds until it gets
 * "success" or "failed". Status is updated by the webhook below (source of truth),
 * with a direct verify-call fallback in case the webhook hasn't arrived yet.
 */
app.get('/api/payment-status/:reference', async (req, res) => {
  const { reference } = req.params;
  const db = readDb();
  const record = db[reference];

  if (!record) return res.status(404).json({ status: 'not_found' });

  if (record.status === 'pending') {
    try {
      const verify = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
      });
      const paystackStatus = verify.data.data.status; // e.g. success, failed, abandoned, pay_offline
      if (paystackStatus === 'success') {
        record.status = 'success';
        writeDb(db);
      } else if (['failed', 'abandoned', 'reversed'].includes(paystackStatus)) {
        record.status = 'failed';
        writeDb(db);
      }
    } catch (err) {
      // Ignore verify errors here; the webhook will still update status when it arrives.
    }
  }

  return res.json({
    status: record.status,
    plan: record.plan,
    amount: record.amount,
    phone: record.phone,
    reference: record.reference,
    date: record.date
  });
});

/**
 * Paystack webhook — the authoritative source for payment confirmation.
 * Configure this URL (e.g. https://yourdomain.com/api/webhook/paystack) in your
 * Paystack Dashboard under Settings > API Keys & Webhooks.
 */
app.post('/api/webhook/paystack', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.body).digest('hex');

  if (hash !== signature) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString('utf8'));
  const db = readDb();

  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    if (db[reference]) {
      db[reference].status = 'success';
      writeDb(db);
    }
  } else if (event.event === 'charge.failed') {
    const reference = event.data.reference;
    if (db[reference]) {
      db[reference].status = 'failed';
      writeDb(db);
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('SKYDIVE NET backend is running.'));

app.listen(PORT, () => console.log(`SKYDIVE NET backend listening on port ${PORT}`));
