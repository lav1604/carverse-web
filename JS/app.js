// ===============================
// CarVerse Asset Tracker - app.js
// Full CRUD + Media (SAS upload/read) + Paging/Search
// ===============================

"use strict";

// --- REST endpoints (Logic Apps) ---
const RAAURI =
  "https://prod-47.uksouth.logic.azure.com/workflows/fe03cc9f25784c638002509b447a3cb0/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=UzlsINngMfi77TwVIQ31tk0zv5IVkwJ8ZzLvg-aV0O8"; // READ ALL (GET): returns { items,total,page,pageSize,search }

const CIAURI =
  "https://prod-10.uksouth.logic.azure.com/workflows/b613fa264a0c4abc8f2adb7d8447f9c5/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=b3LvQmYN7UoKrVeprTz9ZBvXFHhHipCEebMn5gPXP18"; // CREATE (POST)

// --- DELETE (DIA) split URL ---
const DIAURI0 =
  "https://prod-37.uksouth.logic.azure.com/workflows/167c19445f634fd68ec0c3532223365e/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets/";
const DIAURI1 =
  "?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=-UydFuCmYnQQo1NrfoTC_zGIu5YOajzsquLW3Th4n0Y";

// --- UPDATE (UIA) split URL ---
const UIAURI0 =
  "https://prod-49.uksouth.logic.azure.com/workflows/9f0185c1cf2c4000bb315b5afc0df824/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets/";
const UIAURI1 =
  "?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=cps-GmRdO7gBIkrSQ_Wp_kbiyojLNMxjQITx2yqy-ZI";

// --- UPLOAD SAS (returns { blobName, contentType, sasUrl } for PUT upload) ---
const UPLOADSAS =
  "https://prod-25.uksouth.logic.azure.com/workflows/f9b690f3816f449a923bbbc5da09fe4b/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/media/sas?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=Mvrn9it3Yg1H-Xd_hj19vphGM42sdyFdKJWGcMl6uvc";

// --- READ SAS (returns { sasUrl } for viewing) ---
const READSAS =
  "https://prod-34.uksouth.logic.azure.com/workflows/0968b01895ea44a78e97950797209edf/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/media/read?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=sHmEpgqyFZVhNYJj0_Pfmv6zNU2wlC2TPNwoPxQSfVU";

// ---- Paging/search state ----
let currentPage = 1;
let pageSize = 10;
let currentSearch = "";

// Keep meta from last read
let lastTotal = 0;
let lastTotalPages = 1;

// Cache SAS URLs so we don't call READSAS repeatedly for the same blob
const sasCache = new Map(); // blobName -> { url, expiresUtcMs }

// --- Small helpers ---
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setButtonEnabled(id, enabled) {
  const el = document.getElementById(id);
  if (el) el.disabled = !enabled;
}

function setBusy(isBusy) {
  setButtonEnabled("retAssets", !isBusy);
  setButtonEnabled("subNewForm", !isBusy);
  setButtonEnabled("searchBtn", !isBusy);
  setButtonEnabled("prevPage", !isBusy);
  setButtonEnabled("nextPage", !isBusy);
}

function logAjaxError(prefix, xhr) {
  const msg = `${prefix} failed: ${xhr.status} ${xhr.statusText || ""}`;
  alert(msg);
  console.log(msg);
  console.log("ResponseText:", xhr.responseText);
}

// Build asset object from form
function buildAssetFromForm() {
  return {
    AssetLabel: $("#AssetLabel").val(),
    Cost: $("#Cost").val(),
    AssetType: $("#AssetType").val(),
    NameOfOwner: $("#NameOfOwner").val(),
    AddressLine1: $("#AddressLine1").val(),
    AddressLine2: $("#AddressLine2").val(),
    Note: $("#Note").val(),
  };
}

function getSelectedFile() {
  const el = document.getElementById("MediaFile");
  if (!el || !el.files || el.files.length === 0) return null;
  return el.files[0];
}

// Build the RAA URL with paging/search
function buildRAAUrl() {
  const params = [];
  params.push("page=" + encodeURIComponent(currentPage));
  params.push("pageSize=" + encodeURIComponent(pageSize));
  params.push("search=" + encodeURIComponent(currentSearch.trim()));
  return RAAURI + "&" + params.join("&");
}

function renderPagingMeta(meta) {
  const el = document.getElementById("pageInfo");
  if (!el) return;

  const total = meta && meta.total != null ? meta.total : 0;
  const page = meta && meta.page != null ? meta.page : currentPage;
  const size = meta && meta.pageSize != null ? meta.pageSize : pageSize;

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, size)));
  lastTotal = total;
  lastTotalPages = totalPages;

  el.textContent = `Page ${page} / ${totalPages} (Total: ${total})`;

  // Disable prev/next appropriately
  setButtonEnabled("prevPage", page > 1);
  setButtonEnabled("nextPage", page < totalPages);
}

function parseSasExpiryMs(sasUrl) {
  try {
    const u = new URL(sasUrl);
    const se = u.searchParams.get("se");
    if (!se) return 0;
    return Date.parse(se);
  } catch {
    return 0;
  }
}

// 1) Ask Logic App for an upload SAS URL
function requestUploadSas(file) {
  const payload = JSON.stringify({
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
  });

  return $.ajax({
    method: "POST",
    url: UPLOADSAS,
    data: payload,
    contentType: "application/json; charset=utf-8",
    dataType: "json",
  });
}

// 2) Upload the bytes to blob using PUT to sasUrl
async function uploadFileToBlob(sasUrl, file) {
  // Light client-side validation for marks / stability
  const maxMb = 8;
  if (file.size > maxMb * 1024 * 1024) {
    throw new Error(`File too large. Max ${maxMb}MB.`);
  }

  const res = await fetch(sasUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Blob upload failed: ${res.status} ${text}`);
  }
}

// 3) Get a read SAS for displaying images
function getReadSasUrl(blobName) {
  return $.ajax({
    url: READSAS + "&blobName=" + encodeURIComponent(blobName),
    type: "GET",
    dataType: "json",
  }).then((res) => res.sasUrl);
}

function getReadSasUrlCached(blobName) {
  if (!blobName) return Promise.resolve(null);

  const cached = sasCache.get(blobName);
  if (cached && cached.expiresUtcMs && Date.now() < cached.expiresUtcMs - 60_000) {
    return Promise.resolve(cached.url);
  }

  return getReadSasUrl(blobName).then((sasUrl) => {
    const exp = parseSasExpiryMs(sasUrl);
    sasCache.set(blobName, { url: sasUrl, expiresUtcMs: exp || (Date.now() + 30 * 60_000) });
    return sasUrl;
  });
}

// --- Debounce so search doesn't spam requests ---
let searchDebounceTimer = null;
function triggerSearchDebounced() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentPage = 1;
    getAssetList();
  }, 350);
}

// --- Wire buttons ---
$(document).ready(function () {
  // Initial page size from dropdown (if present)
  const ps = parseInt($("#pageSize").val(), 10);
  if (!Number.isNaN(ps)) pageSize = ps;

  $("#retAssets").click(function () {
    // Pull latest control values
    currentSearch = ($("#searchBox").val() || "").trim();
    const newPs = parseInt($("#pageSize").val(), 10);
    if (!Number.isNaN(newPs)) pageSize = newPs;
    currentPage = 1;
    getAssetList();
  });

  $("#subNewForm").click(submitNewAsset);

  $("#clearFormBtn").click(function () {
    document.getElementById("newAssetForm")?.reset();
    // keep search/paging
  });

  // Search box (debounced)
  $("#searchBox").on("input", function () {
    currentSearch = ($(this).val() || "").trim();
    triggerSearchDebounced();
  });

  // Enter key triggers immediate refresh
  $("#searchBox").on("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      currentSearch = ($(this).val() || "").trim();
      currentPage = 1;
      getAssetList();
    }
  });

  $("#searchBtn").click(function () {
    currentSearch = ($("#searchBox").val() || "").trim();
    currentPage = 1;
    getAssetList();
  });

  $("#pageSize").on("change", function () {
    pageSize = parseInt($(this).val(), 10) || 10;
    currentPage = 1;
    getAssetList();
  });

  $("#prevPage").click(function () {
    if (currentPage > 1) currentPage--;
    getAssetList();
  });

  $("#nextPage").click(function () {
    // prevent paging beyond last page if we know it
    if (currentPage < lastTotalPages) {
      currentPage++;
      getAssetList();
    }
  });
});

// --- CREATE (POST) with optional image upload ---
async function submitNewAsset() {
  const subObj = buildAssetFromForm();

  if (!subObj.AssetLabel || String(subObj.AssetLabel).trim() === "") {
    alert("Asset Label is required");
    return;
  }

  setBusy(true);

  try {
    const file = getSelectedFile();

    if (file) {
      const sas = await requestUploadSas(file); // { blobName, sasUrl, contentType }
      await uploadFileToBlob(sas.sasUrl, file);
      subObj.MediaBlobName = sas.blobName; // store in SQL
      // Optional: warm cache so image shows instantly
      sasCache.delete(sas.blobName);
    }

    await $.ajax({
      method: "POST",
      url: CIAURI,
      data: JSON.stringify(subObj),
      contentType: "application/json; charset=utf-8",
      dataType: "text",
      cache: false,
    });

    // After create: reload first page with current filters
    currentPage = 1;
    getAssetList();
  } catch (e) {
    alert(String(e));
    console.log(e);
  } finally {
    setBusy(false);
  }
}

// --- READ ALL (GET) + paging/search + display images using READ-SAS ---
function getAssetList() {
  setBusy(true);

  $("#AssetList").html(
    '<div class="spinner-border" role="status"><span class="sr-only">&nbsp;</span></div>'
  );

  $.ajax({
    method: "GET",
    url: buildRAAUrl(),
    dataType: "json",
    cache: false,
  })
    .done(function (data) {
      // Expecting: { items,total,page,pageSize,search }
      const items = data && Array.isArray(data.items) ? data.items : [];
      renderPagingMeta(data);

      if (items.length === 0) {
        $("#AssetList").html("<div class='alert alert-warning'>No assets found.</div>");
        return;
      }

      const html = [];

      items.forEach((val) => {
        const id = val.AssetID;
        const blobName = val.MediaBlobName;

        html.push(
          `<div style="border:1px solid #ddd; padding:10px; margin-bottom:10px; border-radius:8px;">` +
            `<strong>Asset ID:</strong> ${escapeHtml(id)}<br/>` +
            `<strong>Asset Label:</strong> ${escapeHtml(val.AssetLabel)}, <strong>Cost:</strong> ${escapeHtml(val.Cost)}<br/>` +
            `<strong>Asset Type:</strong> ${escapeHtml(val.AssetType)}, <strong>Owner:</strong> ${escapeHtml(val.NameOfOwner)}<br/>` +
            `<strong>Address 1:</strong> ${escapeHtml(val.AddressLine1)}<br/>` +
            `<strong>Address 2:</strong> ${escapeHtml(val.AddressLine2)}<br/>` +
            `<strong>Note:</strong> ${escapeHtml(val.Note)}<br/>`
        );

        if (blobName) {
          html.push(
            `<div style="margin-top:8px;">` +
              `<img id="img-${id}" alt="asset image" style="max-width:220px; border-radius:10px; display:none;" />` +
              `<div id="imgloading-${id}" style="font-size:12px; opacity:.7;">Loading image…</div>` +
            `</div>`
          );
        }

        html.push(
          `<div style="margin-top:10px;">` +
            `<button type="button" class="btn btn-danger" onclick="deleteAsset(${id})">Delete</button> ` +
            `<button type="button" class="btn btn-warning" onclick="updateAsset(${id})">Update</button>` +
          `</div>` +
          `</div>`
        );
      });

      $("#AssetList").empty().append(html.join(""));

      // After rendering: fetch SAS URLs and inject <img>
      const jobs = items
        .filter((x) => x.MediaBlobName)
        .map((x) =>
          getReadSasUrlCached(x.MediaBlobName)
            .then((sasUrl) => {
              if (!sasUrl) return;
              const img = document.getElementById(`img-${x.AssetID}`);
              const loading = document.getElementById(`imgloading-${x.AssetID}`);
              if (img) {
                img.src = sasUrl;
                img.style.display = "block";
              }
              if (loading) loading.remove();
            })
            .catch(() => {
              const loading = document.getElementById(`imgloading-${x.AssetID}`);
              if (loading) loading.textContent = "Image failed to load";
            })
        );

      Promise.all(jobs).catch(() => {});
    })
    .fail(function (xhr) {
      logAjaxError("Read", xhr);
    })
    .always(function () {
      setBusy(false);
    });
}

// --- DELETE (DELETE /assets/{id}) ---
function deleteAsset(id) {
  if (!confirm("Delete asset " + id + "?")) return;

  const url = DIAURI0 + encodeURIComponent(id) + DIAURI1;

  setBusy(true);

  $.ajax({
    method: "DELETE",
    url: url,
    dataType: "text",
    cache: false,
  })
    .done(function () {
      // If deleting last item on page, try to step back
      if (currentPage > 1 && lastTotal > 0 && (lastTotal - 1) <= (currentPage - 1) * pageSize) {
        currentPage--;
      }
      getAssetList();
    })
    .fail(function (xhr) {
      logAjaxError("Delete", xhr);
    })
    .always(function () {
      setBusy(false);
    });
}

// --- UPDATE (PUT /assets/{id}) with optional new image upload ---
async function updateAsset(id) {
  const updateObj = buildAssetFromForm();

  if (!updateObj.AssetLabel || String(updateObj.AssetLabel).trim() === "") {
    alert("Asset Label is required before updating.");
    return;
  }

  setBusy(true);

  try {
    const file = getSelectedFile();
    if (file) {
      const sas = await requestUploadSas(file);
      await uploadFileToBlob(sas.sasUrl, file);
      updateObj.MediaBlobName = sas.blobName;
      sasCache.delete(sas.blobName);
    }

    const url = UIAURI0 + encodeURIComponent(id) + UIAURI1;

    await $.ajax({
      method: "PUT",
      url: url,
      data: JSON.stringify(updateObj),
      contentType: "application/json; charset=utf-8",
      dataType: "text",
      cache: false,
    });

    getAssetList();
  } catch (e) {
    alert(String(e));
    console.log(e);
  } finally {
    setBusy(false);
  }
}
