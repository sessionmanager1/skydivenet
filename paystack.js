const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const raw = await getRawBody(req);
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(raw).digest('hex');

  if (hash !== signature) {
    res.status(401).send('Invalid signature');
    return;
  }

  // The website checks payment status by asking Paystack directly (/api/payment-status),
  // so this endpoint doesn't need to store anything to make the site work.
  // It exists so Paystack has a webhook URL to call, and so you can extend it later —
  // e.g. notify yourself by email/SMS whenever a charge.success event comes in.

  res.status(200).send('ok');
};

// Required so we can read the raw request body to verify Paystack's signature.
module.exports.config = { api: { bodyParser: false } };
