import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseForm(req) {
  const form = formidable({ multiples: false });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function getValue(fields, name) {
  const value = fields[name];
  return Array.isArray(value) ? value[0] : value || "";
}

function safeFileName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function validarEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function validarTelefone(telefone) {
  const apenasNumeros = telefone.replace(/\D/g, "");
  return apenasNumeros.length >= 10 && apenasNumeros.length <= 15;
}

async function uploadFile(file, folder) {
  if (!file) return null;
  const realFile = Array.isArray(file) ? file[0] : file;
  const fileBuffer = fs.readFileSync(realFile.filepath);
  const fileName = `${folder}/${Date.now()}-${safeFileName(realFile.originalFilename)}`;
  const { error } = await supabase.storage
    .from("documentos")
    .upload(fileName, fileBuffer, {
      contentType: realFile.mimetype,
      upsert: false,
    });
  if (error) throw error;
  return fileName;
}

export default async function handler(req, res) {
  try {
    const baseUrl = (process.env.ALLOWED_ORIGIN || `https://${req.headers.host}`).replace(/\/$/, "");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { fields, files } = await parseForm(req);

    const dados = {
      nome:       getValue(fields, "nome"),
      email:      getValue(fields, "email"),
      telefone:   getValue(fields, "telefone"),
      deficiencia: getValue(fields, "deficiencia"),
      area:       getValue(fields, "area"),
      cidade:     getValue(fields, "cidade"),
      resumo:     getValue(fields, "resumo"),
    };

    // Validações obrigatórias
    if (!dados.nome || !dados.email || !dados.telefone || !dados.deficiencia || !dados.area || !dados.cidade) {
      return res.status(400).json({ ok: false, error: "Preencha todos os campos obrigatórios." });
    }

    if (!validarEmail(dados.email)) {
      return res.status(400).json({ ok: false, error: "Email inválido. Verifique o formato." });
    }

    if (!validarTelefone(dados.telefone)) {
      return res.status(400).json({ ok: false, error: "Telefone inválido. Use um formato válido (ex: 11 99999-9999)." });
    }

    if (!files.curriculo) {
      return res.status(400).json({ ok: false, error: "O currículo é obrigatório." });
    }

    const curriculo_path = await uploadFile(files.curriculo, "pcd-curriculos");
    const carta_path     = await uploadFile(files.carta,     "pcd-cartas");

    const { data, error } = await supabase
      .from("talentos_pcd")
      .insert([{ ...dados, curriculo_path, carta_path }])
      .select();

    if (error) {
      return res.status(400).json({ ok: false, error });
    }

    // Notificação por e-mail
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to:   process.env.EMAIL_TO,
        subject: "Novo cadastro no Banco de Talentos PCD",
        html: `
          <h2>Novo candidato PCD cadastrado</h2>

          <p><strong>Nome:</strong> ${dados.nome}</p>
          <p><strong>Email:</strong> ${dados.email}</p>
          <p><strong>Telefone:</strong> ${dados.telefone}</p>
          <p><strong>Tipo de deficiência:</strong> ${dados.deficiencia}</p>
          <p><strong>Área desejada:</strong> ${dados.area}</p>
          <p><strong>Cidade/Estado:</strong> ${dados.cidade}</p>

          ${dados.resumo ? `<p><strong>Resumo profissional:</strong><br>${dados.resumo}</p>` : ""}

          ${curriculo_path ? `<p><strong>Currículo:</strong><br>
            <a href="${baseUrl}/api/arquivo?path=${encodeURIComponent(curriculo_path)}">Abrir currículo</a></p>` : ""}

          ${carta_path ? `<p><strong>Carta de apresentação:</strong><br>
            <a href="${baseUrl}/api/arquivo?path=${encodeURIComponent(carta_path)}">Abrir carta</a></p>` : ""}
        `,
      }),
    });

    return res.status(200).json({ ok: true, data });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
