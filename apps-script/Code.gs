const SHEET_HEADERS = {
  Products: ["designCode", "variantCode", "name", "category", "description", "color", "price", "stock", "imageUrl", "active"],
  Categories: ["name"],
  Users: ["email", "passwordHash", "role", "name", "cartJson", "wishlistJson", "addressJson", "createdAt"],
  Orders: ["orderId", "email", "itemsJson", "total", "addressJson", "status", "carrier", "trackingNumber", "createdAt"],
};

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Open this Apps Script project from your store spreadsheet before running setup.");

  const secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: spreadsheet.getId(),
    APP_SHARED_SECRET: secret,
  });
  initializeTabs_(spreadsheet);
  SpreadsheetApp.getUi().alert(
    "Loom & Aura setup is complete.\n\nCopy this private key into GOOGLE_APPS_SCRIPT_SECRET in your local .env file. Keep it secret.",
    secret,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

function doPost(event) {
  try {
    if (!event || !event.postData || !event.postData.contents) {
      throw new Error("A JSON request body is required.");
    }

    const request = JSON.parse(event.postData.contents);
    if (!isValidSecret_(request.secret)) throw new Error("Unauthorized Apps Script request.");

    let data;
    switch (request.action) {
      case "initialize":
        data = withWriteLock_(function () {
          initializeTabs_(getSpreadsheet_());
          return true;
        });
        break;
      case "readRows":
        data = readRows_(request.tab);
        break;
      case "appendRow":
        data = withWriteLock_(function () {
          return appendRow_(request.tab, request.row);
        });
        break;
      case "createProduct":
        data = withWriteLock_(function () {
          return createProduct_(request.product, request.prefix);
        });
        break;
      case "createVariant":
        data = withWriteLock_(function () {
          return createVariant_(request.designCode, request.variant);
        });
        break;
      case "updateRow":
        data = withWriteLock_(function () {
          return updateRow_(request.tab, request.sheetRow, request.row);
        });
        break;
      case "createOrderAndDecrementStock":
        data = withWriteLock_(function () {
          return createOrderAndDecrementStock_(request.products, request.orderRow, request.userUpdate);
        });
        break;
      default:
        throw new Error("Unknown Apps Script action.");
    }
    return jsonOutput_({ ok: true, data: data });
  } catch (error) {
    console.error("Loom & Aura Apps Script request failed: " + error.message);
    return jsonOutput_({ ok: false, error: error.message || "Apps Script request failed." });
  }
}

function isValidSecret_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty("APP_SHARED_SECRET");
  if (!expected || typeof provided !== "string" || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Run setup() from the spreadsheet's Apps Script editor first.");
  return SpreadsheetApp.openById(id);
}

function initializeTabs_(spreadsheet) {
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);

    const headers = SHEET_HEADERS[name];
    const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    const isEmpty = current.every(function (value) { return value === ""; });
    if (isEmpty) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      return;
    }
    if (headers.some(function (header, index) { return current[index] !== header; })) {
      throw new Error("The header row in the " + name + " tab does not match the app's required columns.");
    }
  });
}

function readRows_(tab) {
  const sheet = getTab_(tab);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS[tab].length).getValues()
    .map(function (row) {
      return row.map(function (value) {
        return value === null || value === undefined ? "" : String(value);
      });
    });
}

function appendRow_(tab, row) {
  const sheet = getTab_(tab);
  const normalized = normalizeRow_(tab, row);
  if (tab === "Users") {
    const email = String(normalized[0]).toLowerCase();
    if (readRows_("Users").some(function (existing) { return String(existing[0]).toLowerCase() === email; })) {
      throw new Error("An account with that email already exists.");
    }
  }
  sheet.appendRow(normalized);
  return true;
}

function createProduct_(product, prefix) {
  if (!product || typeof product !== "object") throw new Error("Invalid product data.");
  const cleanPrefix = String(prefix || "LAN").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!cleanPrefix) throw new Error("Invalid saree code prefix.");
  const rows = readRows_("Products");
  const pattern = new RegExp("^" + cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)$", "i");
  const highest = rows.reduce(function (max, row) {
    const match = pattern.exec(String(row[0]));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 108);
  const designCode = cleanPrefix + String(highest + 1).padStart(3, "0");
  const created = {
    designCode: designCode,
    variantCode: designCode + "-1",
    name: String(product.name),
    category: String(product.category),
    description: String(product.description),
    color: String(product.color),
    price: Number(product.price),
    stock: Number(product.stock),
    imageUrl: String(product.imageUrl || ""),
    active: true,
  };
  appendRow_("Products", [
    created.designCode, created.variantCode, created.name, created.category, created.description,
    created.color, String(created.price), String(created.stock), created.imageUrl, "true",
  ]);
  return created;
}

function createVariant_(designCode, variant) {
  if (typeof designCode !== "string" || !variant || typeof variant !== "object") {
    throw new Error("Invalid colourway data.");
  }
  const rows = readRows_("Products");
  const design = rows.find(function (row) { return row[0] === designCode; });
  if (!design) throw new Error("Saree design was not found.");
  const pattern = new RegExp("^" + designCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)$");
  const highest = rows.reduce(function (max, row) {
    if (row[0] !== designCode) return max;
    const match = pattern.exec(String(row[1]));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const created = {
    designCode: designCode,
    variantCode: designCode + "-" + (highest + 1),
    name: design[2],
    category: design[3],
    description: design[4],
    color: String(variant.color),
    price: Number(variant.price),
    stock: Number(variant.stock),
    imageUrl: String(variant.imageUrl || ""),
    active: true,
  };
  appendRow_("Products", [
    created.designCode, created.variantCode, created.name, created.category, created.description,
    created.color, String(created.price), String(created.stock), created.imageUrl, "true",
  ]);
  return created;
}

function updateRow_(tab, sheetRow, row) {
  const sheet = getTab_(tab);
  const rowNumber = Number(sheetRow);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error("The requested spreadsheet row does not exist.");
  }
  sheet.getRange(rowNumber, 1, 1, SHEET_HEADERS[tab].length).setValues([normalizeRow_(tab, row)]);
  return true;
}

function createOrderAndDecrementStock_(products, orderRow, userUpdate) {
  if (!Array.isArray(products) || products.length === 0) throw new Error("The order has no sarees.");
  const normalizedOrder = normalizeRow_("Orders", orderRow);
  const normalizedUser = normalizeRow_("Users", userUpdate && userUpdate.row);
  const userRowNumber = Number(userUpdate && userUpdate.sheetRow);
  const productsSheet = getTab_("Products");
  const usersSheet = getTab_("Users");
  const ordersSheet = getTab_("Orders");
  if (!Number.isInteger(userRowNumber) || userRowNumber < 2 || userRowNumber > usersSheet.getLastRow()) {
    throw new Error("The customer account row could not be found.");
  }

  const productRows = productsSheet.getLastRow() < 2
    ? []
    : productsSheet.getRange(2, 1, productsSheet.getLastRow() - 1, SHEET_HEADERS.Products.length).getValues();
  const updates = products.map(function (item) {
    const quantity = Number(item && item.quantity);
    const variantCode = item && item.variantCode;
    if (typeof variantCode !== "string" || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Invalid saree quantity in order.");
    }
    const index = productRows.findIndex(function (row) { return String(row[1]) === variantCode; });
    if (index < 0 || String(productRows[index][9]).toLowerCase() === "false") {
      throw new Error("Saree " + variantCode + " is no longer available.");
    }
    const stock = Number(productRows[index][7]);
    if (!Number.isInteger(stock) || stock < quantity) {
      throw new Error(stock > 0 ? "Only " + stock + " piece(s) remain for " + variantCode + "." : variantCode + " is out of stock.");
    }
    return { rowNumber: index + 2, oldStock: stock, newStock: stock - quantity };
  });

  const oldUserRow = usersSheet.getRange(userRowNumber, 1, 1, SHEET_HEADERS.Users.length).getValues()[0];
  try {
    updates.forEach(function (update) {
      productsSheet.getRange(update.rowNumber, 8).setValue(update.newStock);
    });
    usersSheet.getRange(userRowNumber, 1, 1, SHEET_HEADERS.Users.length).setValues([normalizedUser]);
    ordersSheet.appendRow(normalizedOrder);
    SpreadsheetApp.flush();
  } catch (error) {
    updates.forEach(function (update) {
      productsSheet.getRange(update.rowNumber, 8).setValue(update.oldStock);
    });
    usersSheet.getRange(userRowNumber, 1, 1, SHEET_HEADERS.Users.length).setValues([oldUserRow]);
    SpreadsheetApp.flush();
    throw error;
  }
  return true;
}

function normalizeRow_(tab, row) {
  if (!Object.prototype.hasOwnProperty.call(SHEET_HEADERS, tab)) throw new Error("Unknown spreadsheet tab.");
  if (!Array.isArray(row) || row.length !== SHEET_HEADERS[tab].length) {
    throw new Error("Invalid row data for the " + tab + " tab.");
  }
  return row.map(function (value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  });
}

function getTab_(name) {
  if (!Object.prototype.hasOwnProperty.call(SHEET_HEADERS, name)) throw new Error("Unknown spreadsheet tab.");
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error("The " + name + " spreadsheet tab is missing. Run setup() in Apps Script.");
  return sheet;
}

function withWriteLock_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
