const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

module.exports = async (req, res) => {
  const { reference } = req.query;

  if (!PAYSTACK_SECRET_KEY) {
    res.status(500).json({ status: 'error', message: 'Payments are not configured yet.' });
    return;
  }

  try {
    const verify = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });

    const data = verify.data.data;
    let status = 'pending';
    if (data.status === 'success') status = 'success';
    else if (['failed', 'abandoned', 'reversed'].includes(data.status)) status = 'failed';

    res.status(200).json({
      status,
      plan: data.metadata?.plan || '',
      amount: data.amount / 100,
      phone: data.metadata?.phone || '',
      reference: data.reference,
      date: data.paid_at || data.created_at
    });
  } catch (err) {
    // Transaction may not be verifiable yet right after the STK push was sent — keep polling.
    res.status(200).json({ status: 'pending' });
  }
};
