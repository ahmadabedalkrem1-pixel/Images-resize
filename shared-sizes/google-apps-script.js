// Shared sizes list for the image resizer, kept in a Google Sheet.
// Setup (once): see "רשימת גדלים משותפת" in README.md.
//
// GET  → [{ name, width, height }, …]  every size in the sheet
// POST ← { name, width, height }       adds a row; replies { ok: true } or { ok: false, error }
//
// To remove or rename a size, edit or delete its row in the sheet.

const SHEET_NAME = "sizes";

function doGet() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const sizes = rows
    .map((r) => ({ name: String(r[0]).trim(), width: Number(r[1]), height: Number(r[2]) }))
    .filter((s) => s.name && s.width > 0 && s.height > 0);
  return json_(sizes);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "bad request" });
  }
  const name = String(data.name || "").trim().slice(0, 40);
  const width = Math.round(Number(data.width));
  const height = Math.round(Number(data.height));
  if (!name || !(width > 0 && width <= 10000) || !(height > 0 && height <= 10000)) {
    return json_({ ok: false, error: "invalid size" });
  }
  // A leading apostrophe stops the sheet from treating a name like "=…" as a formula.
  const safeName = /^[=+\-@]/.test(name) ? "'" + name : name;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow([safeName, width, height, new Date()]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

function sheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(["name", "width", "height", "added"]);
  }
  return sheet;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
