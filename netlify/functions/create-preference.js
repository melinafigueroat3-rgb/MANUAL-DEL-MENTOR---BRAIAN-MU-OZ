const crypto = require("node:crypto");

const PRODUCTS = {
  manual: { title: "Manual del Mentor", price: 25000 },
  consultoria: { title: "Consultoría individual", price: 250000 }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { Allow: "POST" }, body: "Method not allowed" };
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST;
  if (!token) return json(500, { error: "Falta configurar MERCADOPAGO_ACCESS_TOKEN_TEST en Netlify." });

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Solicitud inválida." }); }

  const product = PRODUCTS[input.product_id];
  if (!product) return json(400, { error: "Producto inválido." });

  const baseUrl = process.env.DEPLOY_PRIME_URL || process.env.URL;
  if (!baseUrl) return json(500, { error: "No se pudo determinar la URL del sitio de prueba." });

  const nonce = crypto.randomUUID();
  const payload = `mdmpx_test|${input.product_id}|${nonce}`;
  const signature = crypto.createHmac("sha256", token).update(payload).digest("hex");
  const externalReference = `${payload}|${signature}`;

  try {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [{
          id: input.product_id,
          title: product.title,
          quantity: 1,
          currency_id: "ARS",
          unit_price: product.price
        }],
        external_reference: externalReference,
        back_urls: {
          success: `${baseUrl}/gracias.html`,
          pending: `${baseUrl}/gracias.html`,
          failure: `${baseUrl}/gracias.html`
        },
        auto_return: "approved"
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return json(502, { error: "Mercado Pago no pudo crear el checkout.", detail: data.message || data.error || "Error de API" });
    }

    // Fail closed: never fall back to init_point, which may be a live checkout URL.
    const checkoutUrl = data.sandbox_init_point;
    if (!checkoutUrl) {
      return json(502, { error: "Mercado Pago no devolvió un enlace de prueba. No se abrió ningún checkout." });
    }

    let parsedUrl;
    try { parsedUrl = new URL(checkoutUrl); } catch {}
    if (!parsedUrl || parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "sandbox.mercadopago.com") {
      return json(502, { error: "El enlace recibido no corresponde al entorno seguro de prueba. No se abrió ningún checkout." });
    }

    return json(200, { checkout_url: checkoutUrl });
  } catch {
    return json(502, { error: "No se pudo conectar con Mercado Pago." });
  }
};

function json(statusCode, value) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(value)
  };
}
