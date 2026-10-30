import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // A Vercel envia "Authorization: Bearer <CRON_SECRET>" quando a variável CRON_SECRET existe
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "Não autorizado" });
    }
  }

  try {
    // Consulta leve no banco para contar como atividade
    const { error } = await supabase
      .from("talentos_pcd")
      .select("id", { head: true, count: "exact" });

    if (error) {
      console.error("[keepalive] Erro:", error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    console.error("[keepalive] Erro:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
