const STAGING_URL = "https://qijahxokldkaqmjinfvy.supabase.co";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestGet({ env }) {
  const url = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";

  if (url !== STAGING_URL) {
    return json({ ok: false, error: "Staging Supabase URL is not configured." }, 503);
  }
  if (!key) {
    return json({ ok: false, error: "Staging publishable key is not configured." }, 503);
  }

  const query = new URLSearchParams({
    select: "id,title,product_type,weight,weight_unit,purity,province,city,description,pricing_method,pricing_value,price,image_url,status,created_at,updated_at",
    status: "in.(published,sold)",
    deleted_at: "is.null",
    order: "created_at.desc",
    limit: "100",
  });

  try {
    const response = await fetch(`${url}/rest/v1/listings?${query.toString()}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return json({
        ok: false,
        error: "Staging listings query failed.",
        status: response.status,
        details: body?.message || body?.hint || body?.details || null,
      }, 502);
    }

    const listings = (Array.isArray(body) ? body : []).map((item) => {
      const method = item.pricing_method;
      const value = item.pricing_value;
      let price = "قیمت اعلام نشده";
      if (method === "fixed" && item.price != null) {
        price = `${Number(item.price).toLocaleString("en-US")} تومان`;
      } else if (method === "percent" && value != null) {
        price = `${Number(value)}٪ بالاتر از تابلو`;
      } else if (method === "amount" && value != null) {
        price = `${Number(value).toLocaleString("en-US")} تومان بالاتر از تابلو`;
      } else if (method === "negotiable") {
        price = "توافقی";
      }
      return {
        id: item.id,
        title: item.title,
        product_type: item.product_type,
        item_type: item.product_type,
        weight: item.weight,
        weight_unit: item.weight_unit === "soot" ? "سوت" : "گرم",
        karat: item.purity,
        purity: item.purity,
        province: item.province,
        city: item.city,
        description: item.description,
        pricing_method: method,
        pricing_value: value,
        price,
        photo_url: item.image_url,
        image_url: item.image_url,
        created_at: item.created_at,
        status: item.status,
      };
    });

    return json({ ok: true, listings, source: "supabase-staging" });
  } catch {
    return json({ ok: false, error: "Could not reach Staging Supabase." }, 502);
  }
}
