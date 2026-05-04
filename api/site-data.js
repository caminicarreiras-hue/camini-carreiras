import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function validateToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  return token === process.env.ADMIN_TOKEN;
}

const DEFAULT_DATA = {
  vagas: [],
  posts: [],
  config: {},
  photo: null,
};

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("site_data")
        .select("key, value")
        .in("key", ["vagas", "posts", "config", "photo"]);

      if (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      const payload = { ...DEFAULT_DATA };
      for (const row of data || []) {
        payload[row.key] = row.value;
      }

      return res.status(200).json({ ok: true, data: payload });
    }

    if (req.method === "POST") {
      if (!validateToken(req)) {
        return res.status(401).json({ ok: false, error: "Token inválido ou não fornecido" });
      }

      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const rows = [
        { key: "vagas", value: Array.isArray(body.vagas) ? body.vagas : [] },
        { key: "posts", value: Array.isArray(body.posts) ? body.posts : [] },
        { key: "config", value: body.config && typeof body.config === "object" ? body.config : {} },
        { key: "photo", value: body.photo || null },
      ];

      const { error } = await supabase
        .from("site_data")
        .upsert(rows, { onConflict: "key" });

      if (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.status(200).json({ ok: true, message: "Dados do site salvos com sucesso" });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
