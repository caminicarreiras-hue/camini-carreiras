import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function validateToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  return Boolean(process.env.ADMIN_TOKEN) && token === process.env.ADMIN_TOKEN;
}

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export default async function handler(req, res) {
  noCache(res);

  try {
    if (!validateToken(req)) {
      return res.status(401).json({ ok: false, error: "Token inválido ou não fornecido" });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      return res.status(200).json({ ok: true, briefings: data || [] });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ ok: false, error: "ID do briefing não fornecido" });
      }

      const { data: briefing, error: fetchError } = await supabase
        .from("briefings")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (fetchError) {
        return res.status(400).json({ ok: false, error: fetchError.message });
      }

      if (!briefing) {
        return res.status(404).json({ ok: false, error: "Briefing não encontrado" });
      }

      const filesToDelete = [
        briefing.curriculo_path,
        briefing.carta_path,
        briefing.pdf_path,
      ].filter(Boolean);

      if (filesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("documentos")
          .remove(filesToDelete);

        if (storageError) {
          return res.status(400).json({ ok: false, error: storageError.message });
        }
      }

      const { data: deletedRows, error: deleteError } = await supabase
        .from("briefings")
        .delete()
        .eq("id", id)
        .select("id");

      if (deleteError) {
        return res.status(400).json({ ok: false, error: deleteError.message });
      }

      if (!deletedRows || deletedRows.length === 0) {
        return res.status(404).json({ ok: false, error: "Nenhum registro foi deletado" });
      }

      return res.status(200).json({
        ok: true,
        deletedId: id,
        message: "Briefing deletado com sucesso",
      });
    }

    return res.status(405).json({ ok: false, error: "Método não permitido" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
