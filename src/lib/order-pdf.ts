import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { WorkOrder } from "@/lib/types";

const A4 = { width: 595.28, height: 841.89 };
const margin = 42;
const colors = {
  ink: rgb(0.08, 0.11, 0.16),
  muted: rgb(0.38, 0.42, 0.48),
  line: rgb(0.87, 0.88, 0.9),
  soft: rgb(0.97, 0.97, 0.96),
  accent: rgb(0.92, 0.34, 0.08),
  white: rgb(1, 1, 1),
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const statusLabels: Record<WorkOrder["status"], string> = {
  ORCAMENTO: "Orçamento",
  PEDIDO: "Pedido aprovado",
  VENDA_REALIZADA: "Venda concluída",
  CANCELADO: "Cancelado",
};

function safeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

function formatDate(value?: string) {
  if (!value) return "Não informada";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? safeText(value)
    : new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = safeText(text).split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        line = word;
        continue;
      }
      let fragment = "";
      for (const character of word) {
        const next = `${fragment}${character}`;
        if (font.widthOfTextAtSize(next, size) > maxWidth && fragment) {
          lines.push(fragment);
          fragment = character;
        } else fragment = next;
      }
      line = fragment;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawRight(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = colors.ink) {
  const value = safeText(text);
  page.drawText(value, { x: x - font.widthOfTextAtSize(value, size), y, font, size, color });
}

export type OrderPdfInput = {
  order: WorkOrder;
  companyName?: string;
  generatedAt?: Date;
};

export async function createOrderPdf({ order, companyName = "Maurício Motos", generatedAt = new Date() }: OrderPdfInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Orçamento ${order.number} - ${order.customer}`);
  pdf.setAuthor(companyName);
  pdf.setSubject("Orçamento de produtos e serviços");
  pdf.setCreator("Maurício Motos");
  pdf.setCreationDate(generatedAt);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - margin;

  const drawHeader = () => {
    page.drawCircle({ x: margin + 18, y: y - 18, size: 18, color: colors.accent });
    page.drawText("MM", { x: margin + 7.5, y: y - 22.5, font: bold, size: 11, color: colors.white });
    page.drawText(safeText(companyName), { x: margin + 48, y: y - 11, font: bold, size: 17, color: colors.ink });
    page.drawText("OFICINA E SERVIÇOS", { x: margin + 48, y: y - 29, font: bold, size: 7.5, color: colors.accent });
    drawRight(page, "ORÇAMENTO", A4.width - margin, y - 9, bold, 16);
    drawRight(page, `Nº ${order.number}`, A4.width - margin, y - 28, regular, 9, colors.muted);
    y -= 58;
    page.drawLine({ start: { x: margin, y }, end: { x: A4.width - margin, y }, thickness: 1.2, color: colors.accent });
    y -= 20;
  };

  const addPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - margin;
    drawHeader();
  };

  const ensureSpace = (height: number) => {
    if (y - height < 58) addPage();
  };

  const drawLabelValue = (label: string, value: string, x: number, width: number, top: number) => {
    page.drawText(safeText(label.toUpperCase()), { x, y: top, font: bold, size: 7, color: colors.muted });
    const lines = wrapText(value || "Não informado", regular, 9.5, width);
    lines.slice(0, 2).forEach((line, index) => page.drawText(line || "-", { x, y: top - 15 - index * 12, font: regular, size: 9.5, color: colors.ink }));
  };

  drawHeader();

  const infoTop = y;
  page.drawRectangle({ x: margin, y: infoTop - 78, width: A4.width - margin * 2, height: 78, color: colors.soft, borderColor: colors.line, borderWidth: 0.7 });
  drawLabelValue("Cliente", order.customer, margin + 12, 226, infoTop - 16);
  drawLabelValue("Telefone", order.phone || "Não informado", margin + 257, 110, infoTop - 16);
  drawLabelValue("Emissão / validade", `${formatDate(order.budgetDate)} / ${formatDate(order.validUntil)}`, margin + 385, 103, infoTop - 16);
  drawLabelValue("Veículo", order.model || "Não informado", margin + 12, 175, infoTop - 50);
  drawLabelValue("Placa", order.plate || "Não informada", margin + 205, 75, infoTop - 50);
  drawLabelValue("Quilometragem", order.mileage ? `${number.format(order.mileage)} km` : "Não informada", margin + 300, 85, infoTop - 50);
  drawLabelValue("Mecânico", order.mechanic || "Não definido", margin + 405, 94, infoTop - 50);
  y = infoTop - 103;

  page.drawText("PRODUTOS E SERVIÇOS", { x: margin, y, font: bold, size: 10.5, color: colors.ink });
  y -= 18;

  const tableX = margin;
  const widths = { description: 258, quantity: 50, unit: 92, total: 92 };
  const tableWidth = Object.values(widths).reduce((sum, value) => sum + value, 0);
  const drawTableHeader = () => {
    page.drawRectangle({ x: tableX, y: y - 23, width: tableWidth, height: 23, color: colors.ink });
    page.drawText("DESCRIÇÃO", { x: tableX + 9, y: y - 15, font: bold, size: 7.5, color: colors.white });
    drawRight(page, "QTD.", tableX + widths.description + widths.quantity - 8, y - 15, bold, 7.5, colors.white);
    drawRight(page, "UNITÁRIO", tableX + widths.description + widths.quantity + widths.unit - 8, y - 15, bold, 7.5, colors.white);
    drawRight(page, "TOTAL", tableX + tableWidth - 8, y - 15, bold, 7.5, colors.white);
    y -= 23;
  };
  drawTableHeader();

  for (const item of order.items) {
    const nameLines = wrapText(item.name, bold, 9, widths.description - 18);
    const typeLines = wrapText(item.type || "Item", regular, 7.5, widths.description - 18);
    const rowHeight = Math.max(37, 14 + nameLines.length * 11 + Math.min(typeLines.length, 1) * 9);
    if (y - rowHeight < 100) {
      addPage();
      page.drawText("PRODUTOS E SERVIÇOS - CONTINUAÇÃO", { x: margin, y, font: bold, size: 10.5, color: colors.ink });
      y -= 18;
      drawTableHeader();
    }
    page.drawRectangle({ x: tableX, y: y - rowHeight, width: tableWidth, height: rowHeight, color: colors.white, borderColor: colors.line, borderWidth: 0.5 });
    nameLines.forEach((line, index) => page.drawText(line, { x: tableX + 9, y: y - 15 - index * 11, font: bold, size: 9, color: colors.ink }));
    const typeY = y - 15 - nameLines.length * 11;
    if (typeLines[0]) page.drawText(typeLines[0], { x: tableX + 9, y: typeY, font: regular, size: 7.5, color: colors.muted });
    drawRight(page, number.format(item.quantity), tableX + widths.description + widths.quantity - 8, y - 21, regular, 9);
    drawRight(page, currency.format(item.unitPrice), tableX + widths.description + widths.quantity + widths.unit - 8, y - 21, regular, 9);
    drawRight(page, currency.format(item.total), tableX + tableWidth - 8, y - 21, bold, 9);
    y -= rowHeight;
  }

  const subtotal = order.items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const discount = Number(order.discount || 0);
  ensureSpace(105);
  y -= 16;
  const totalsX = A4.width - margin - 218;
  const totalsRight = A4.width - margin;
  page.drawText("Subtotal", { x: totalsX, y, font: regular, size: 9, color: colors.muted });
  drawRight(page, currency.format(subtotal), totalsRight, y, regular, 9);
  y -= 18;
  page.drawText("Desconto", { x: totalsX, y, font: regular, size: 9, color: colors.muted });
  drawRight(page, discount ? `- ${currency.format(discount)}` : currency.format(0), totalsRight, y, regular, 9);
  y -= 12;
  page.drawLine({ start: { x: totalsX, y }, end: { x: totalsRight, y }, thickness: 0.7, color: colors.line });
  y -= 22;
  page.drawText("TOTAL DO ORÇAMENTO", { x: totalsX, y, font: bold, size: 10, color: colors.ink });
  drawRight(page, currency.format(order.total), totalsRight, y - 2, bold, 15, colors.accent);
  y -= 32;

  if (order.notes) {
    const noteLines = wrapText(order.notes, regular, 9, A4.width - margin * 2 - 20);
    ensureSpace(36 + noteLines.length * 12);
    page.drawRectangle({ x: margin, y: y - 24 - noteLines.length * 12, width: A4.width - margin * 2, height: 24 + noteLines.length * 12, color: colors.soft, borderColor: colors.line, borderWidth: 0.5 });
    page.drawText("OBSERVAÇÕES", { x: margin + 10, y: y - 15, font: bold, size: 7.5, color: colors.muted });
    noteLines.forEach((line, index) => page.drawText(line || "-", { x: margin + 10, y: y - 31 - index * 12, font: regular, size: 9, color: colors.ink }));
  }

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: margin, y: 43 }, end: { x: A4.width - margin, y: 43 }, thickness: 0.5, color: colors.line });
    current.drawText(`Documento gerado em ${generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, { x: margin, y: 27, font: regular, size: 7.5, color: colors.muted });
    drawRight(current, `${statusLabels[order.status]}  |  Página ${index + 1} de ${pages.length}`, A4.width - margin, 27, regular, 7.5, colors.muted);
  });

  return pdf.save();
}
