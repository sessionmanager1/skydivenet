// SKYDIVE NET — Payment backend
// Holds the Paystack SECRET key server-side and triggers direct M-Pesa STK push
// via Paystack's Charge API. Never expose this key in frontend code.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // npm i node-fetch@2

const app = express();
app.use(cors());
app.use(express.json());

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY; // set this in your hosting provider's env vars, never in code
const PAYSTACK_BASE = "https://api.paystack.co";

if (!PAYSTACK_SECRET_KEY) {
  console.warn("WARNING: PAYSTACK_SECRET_KEY is not set. Set it as an environment variable before deploying.");
}

// 1) Trigger the STK push
// POST /api/charge  { email, amount, phone, plan }
app.post("/api/charge", async (req, res) => {
  try {
    const { email, amount, phone, plan, name } = req.body;

    if (!email || !amount || !phone) {
      return res.status(400).json({ status: false, message: "email, amount and phone are required" });
    }

    // Kenyan phone numbers should be in local format e.g. 0712345678
    const cleanPhone = phone.replace(/\s+/g, "");

    const response = await fetch(`${PAYSTACK_BASE}/charge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: Math.round(Number(amount) * 100), // convert KES to the lowest currency unit
        currency: "KES",
        mobile_money: {
          phone: cleanPhone,
          provider: "mpesa",
        },
        metadata: {
          plan: plan || "SKYDIVE NET payment",
          name: name || "",
          phone: cleanPhone,
        },
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error initiating payment" });
  }
});

// 2) Poll payment status until the customer approves the STK push on their phone
// GET /api/verify/:reference
app.get("/api/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const response = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: false, message: "Server error verifying payment" });
  }
});

// 3) Optional: Paystack webhook, the most reliable way to confirm payment server-side
app.post("/api/webhook", express.json(), (req, res) => {
  // TODO: verify the x-paystack-signature header against PAYSTACK_SECRET_KEY (see Paystack docs)
  // then mark the matching order/reference as paid in your own records.
  console.log("Webhook received:", req.body.event);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SKYDIVE NET payment backend running on port ${PORT}`));
