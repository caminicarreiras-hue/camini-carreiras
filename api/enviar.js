import formidable from "formidable";
import fs from "fs";
import PDFDocument from "pdfkit";
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

// Validadores
function validarEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function validarTelefone(telefone) {
  // Remove caracteres não numéricos
  const apenasNumeros = telefone.replace(/\D/g, "");
  // Aceita números de telefone com 10 a 15 dígitos
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

function gerarPdfBuffer(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Briefing de Atendimento", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Nome: ${dados.nome}`);
    doc.text(`E-mail: ${dados.email}`);
    doc.text(`Telefone: ${dados.telefone}`);
    doc.text(`LinkedIn: ${dados.linkedin}`);
    doc.text(`Usuário LinkedIn: ${dados.linkedin_user}`);
    doc.moveDown();

    doc.fontSize(14).text("Objetivo profissional:");
    doc.fontSize(12).text(dados.objetivo || "Não informado");

    doc.moveDown();
    doc.fontSize(10).text(
      `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      { align: "right" }
    );

    doc.end();
  });
}

async function uploadPdf(buffer, nome) {
  const fileName = `pdfs/${Date.now()}-briefing-${safeFileName(nome || "cliente")}.pdf`;

  const { error } = await supabase.storage
    .from("documentos")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) throw error;

  return fileName;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { fields, files } = await parseForm(req);

    const dados = {
      nome: getValue(fields, "nome"),
      email: getValue(fields, "email"),
      telefone: getValue(fields, "telefone"),
      linkedin: getValue(fields, "linkedin"),
      linkedin_user: getValue(fields, "linkedinUser"),
      objetivo: getValue(fields, "objetivo"),
    };

    // Validações
    if (!dados.nome || !dados.email || !dados.telefone || !dados.linkedin) {
      return res.status(400).json({ 
        ok: false, 
        error: "Nome, email, telefone e LinkedIn são obrigatórios" 
      });
    }

    if (!validarEmail(dados.email)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Email inválido. Por favor, verifique o formato." 
      });
    }

    if (!validarTelefone(dados.telefone)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Telefone inválido. Use um formato válido (ex: 11 99999-9999)" 
      });
    }

    const curriculo_path = await uploadFile(files.curriculo, "curriculos");
    const carta_path = await uploadFile(files.carta, "cartas");

    const pdfBuffer = await gerarPdfBuffer(dados);
    const pdf_path = await uploadPdf(pdfBuffer, dados.nome);

    const { data, error } = await supabase
      .from("briefings")
      .insert([
        {
          ...dados,
          curriculo_path,
          carta_path,
          pdf_path,
        },
      ])
      .select();

    if (error) {
      return res.status(400).json({ ok: false, error });
    }

    // ENVIO DE EMAIL
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject: "Novo briefing recebido",
        html: `
          <h2>Novo briefing recebido</h2>

          <p><strong>Nome:</strong> ${dados.nome}</p>
          <p><strong>Email:</strong> ${dados.email}</p>
          <p><strong>Telefone:</strong> ${dados.telefone}</p>
          <p><strong>LinkedIn:</strong> ${dados.linkedin}</p>

          <p><strong>Objetivo:</strong><br>${dados.objetivo}</p>

          ${curriculo_path ? `
          <p><strong>Currículo:</strong><br>
          <a href="${process.env.ALLOWED_ORIGIN}/api/arquivo?path=${encodeURIComponent(curriculo_path)}">Abrir</a></p>
          ` : ""}

          ${carta_path ? `
          <p><strong>Carta:</strong><br>
          <a href="${process.env.ALLOWED_ORIGIN}/api/arquivo?path=${encodeURIComponent(carta_path)}">Abrir</a></p>
          ` : ""}

          ${pdf_path ? `
          <p><strong>PDF do briefing:</strong><br>
          <a href="${process.env.ALLOWED_ORIGIN}/api/arquivo?path=${encodeURIComponent(pdf_path)}">Abrir</a></p>
          ` : ""}
        `,
      }),
    });

    return res.status(200).json({ ok: true, data });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
