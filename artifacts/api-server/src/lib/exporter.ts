import ExcelJS from "exceljs";
import type { Response } from "express";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } } as const;
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" } as const;
const ALT_ROW_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } } as const;
const CURRENCY_FORMAT = '₹ #,##,##0.00';
const DATE_FORMAT = 'dd-mmm-yyyy';
const DATETIME_FORMAT = 'dd-mmm-yyyy hh:mm AM/PM';

export interface SheetDef {
  name: string;
  headers: string[];
  rows: any[][];
  columnWidths?: number[];
}

export function buildWorkbook(sheets: SheetDef[], title: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Elham Multiplast CRM";
  wb.created = new Date();

  sheets.forEach((sheet, idx) => {
    const ws = wb.addWorksheet(sheet.name.substring(0, 31), {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    // Title row
    if (idx === 0) {
      ws.mergeCells(1, 1, 1, sheet.headers.length);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = title;
      titleCell.font = { bold: true, size: 14, name: "Calibri", color: { argb: "FF1A237E" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 30;
    }

    // Header row (row 2 for first sheet, row 1 for others)
    const headerRowNum = idx === 0 ? 2 : 1;
    const headerRow = ws.getRow(headerRowNum);
    sheet.headers.forEach((h, ci) => {
      const cell = headerRow.getCell(ci + 1);
      cell.value = h;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
    headerRow.height = 22;

    // Data rows
    sheet.rows.forEach((row, ri) => {
      const rowNum = headerRowNum + 1 + ri;
      const excelRow = ws.getRow(rowNum);
      row.forEach((val, ci) => {
        const cell = excelRow.getCell(ci + 1);
        cell.value = val ?? "";
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        if (ri % 2 === 1) {
          cell.fill = ALT_ROW_FILL;
        }
        // Auto-detect currency columns (headers containing Value, Amount, Total, Rate, Freight)
        const hdr = sheet.headers[ci]?.toLowerCase() || "";
        if (hdr.includes("value") || hdr.includes("amount") || hdr.includes("total") || hdr.includes("rate") || hdr.includes("freight") || hdr.includes("won") || hdr.includes("grand")) {
          if (typeof val === "number") {
            cell.numFmt = CURRENCY_FORMAT;
          }
        }
        // Date columns
        if (hdr.includes("date") || hdr === "created" || hdr === "updated" || hdr.includes("follow-up")) {
          if (val instanceof Date) {
            cell.numFmt = DATE_FORMAT;
          }
        }
      });
      excelRow.height = 20;
    });

    // Auto column width
    const colCount = sheet.headers.length;
    const allRows = [sheet.headers, ...sheet.rows];
    for (let ci = 0; ci < colCount; ci++) {
      let maxLen = 10;
      allRows.forEach(row => {
        const val = row[ci];
        const str = val == null ? "" : String(val);
        const len = Math.min(str.length, 60);
        if (len > maxLen) maxLen = len;
      });
      ws.getColumn(ci + 1).width = Math.max(maxLen + 3, 12);
    }
  });

  return wb;
}

export async function sendWorkbook(res: Response, wb: ExcelJS.Workbook, filename: string, format: string = "xlsx") {
  if (format === "csv") {
    // CSV export: flatten first sheet to CSV
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow((row, rowNum) => {
      const vals: string[] = [];
      row.eachCell((cell) => {
        let val = cell.value;
        if (val instanceof Date) val = val.toLocaleDateString("en-IN");
        const str = val == null ? "" : String(val);
        vals.push(str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str);
      });
      rows.push(vals);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const bom = "\uFEFF";
    res.setHeader("Content-Type", "text/csv;charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(bom + csv);
  } else {
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(Buffer.from(buf));
  }
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function safeStr(val: any): string {
  return val == null ? "" : String(val);
}

export function safeNum(val: any): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}
