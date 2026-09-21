'use strict';

/*
 * Quando o SOC não tem o médico do ASO cadastrado corretamente
 * (usa um registro genérico tipo "Nome do Médico - RS"), o único
 * lugar onde o nome real e o CRM do médico que assinou existem é
 * no carimbo de assinatura digital no rodapé do PDF, no formato:
 *
 *   Assinado digitalmente por: FULANO DE TAL:***12345***, Data: ...
 */

const REGEX_ASSINATURA =
    /assinado\s+digitalmente\s+por\s*:?\s*([^:*\n\r]+?)\s*:\s*\*{2,}\s*(\d{3,10})\s*\*{2,}/i;

function extrairAssinaturaDigitalDoTexto(texto) {
    const textoNormalizado = String(texto || '').replace(/\s+/g, ' ').trim();

    if (!textoNormalizado) return null;

    const match = REGEX_ASSINATURA.exec(textoNormalizado);

    if (!match) return null;

    const nome = match[1].trim();
    const crm = match[2].trim();

    if (!nome || !crm) return null;

    return { nome, crm };
}

async function extrairAssinaturaDigitalDoPdf(bufferPdf) {
    if (!bufferPdf || !bufferPdf.length) return null;

    const pdfParse = require('pdf-parse');

    const resultado = await pdfParse(bufferPdf);

    return extrairAssinaturaDigitalDoTexto(resultado.text);
}

module.exports = {
    extrairAssinaturaDigitalDoTexto,
    extrairAssinaturaDigitalDoPdf
};
