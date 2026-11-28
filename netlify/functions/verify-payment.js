const crypto = require("node:crypto");

const PRODUCTS = {
  manual: { title: "Manual del Mentor", price: 25000 },
  consultoria: { title: "Consultoría individual", price: 250000 }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: { Allow: "GET" }, body: "Method not allowed" };
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST;
  if (!token) return json(500, { verified: false, error: "Falta configurar el token de prueba." });

  const paymentId = event.queryStringParameters && event.queryStringParameters.payment_id;
  if (!paymentId || !/^\d+$/.test(paymentId)) {
    return json(400, { verified: false, error: "Falta un identificador de pago válido." });
  }

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return json(502, { verified: false, error: "No se pudo consultar el pago en Mercado Pago." });

    const payment = await response.json();
    const reference = String(payment.external_reference || "");
    const match = reference.match(/^mdmpx_test\|(manual|consultoria)\|([0-9a-f-]{36})\|([0-9a-f]{64})$/i);
    if (!match) return json(200, { verified: false, status: safeStatus(payment.status) });

    const productId = match[1];
    const nonce = match[2];
    const signature = match[3];
    const payload = `mdmpx_test|${productId}|${nonce}`;
    const expected = crypto.createHmac("sha256", token).update(payload).digest("hex");
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return json(200, { verified: false, status: safeStatus(payment.status) });
    }

    const product = PRODUCTS[productId];
    const correctAmount = Number(payment.transaction_amount) === product.price;
    const correctCurrency = payment.currency_id === "ARS";
    const testPayment = payment.live_mode === false;
    const approved = payment.status === "approved";

    if (!correctAmount || !correctCurrency || !testPayment) {
      return json(200, { verified: false, status: safeStatus(payment.status) });
    }

    return json(200, {
      verified: approved,
      status: safeStatus(payment.status),
      amount: Number(payment.transaction_amount),
      currency: payment.currency_id,
      product: productId,
      payment_id: String(payment.id)
    });
  } catch {
    return json(502, { verified: false, error: "Error al verificar el pago." });
  }
};

function safeStatus(status) {
  return ["approved", "pending", "rejected", "in_process", "cancelled"].includes(status) ? status : "unknown";
}

function json(statusCode, value) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(value)
  };
}
