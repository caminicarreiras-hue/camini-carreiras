import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const { path } = req.query;

    if (!path) {
      return res.status(400).json({ ok: false, error: "Arquivo não informado" });
    }

    const { data, error } = await supabase.storage
      .from("documentos")
      .createSignedUrl(path, 60 * 10);

    if (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }

    return res.redirect(data.signedUrl);
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
