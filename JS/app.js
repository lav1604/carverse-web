// ===============================
// CarVerse Asset Tracker - app.js
// CRUD + Media (SAS upload/read) + Paging/Search + Theme + Download
// ===============================

"use strict";

// --- REST endpoints (Logic Apps) ---
const RAAURI =
  "https://prod-47.uksouth.logic.azure.com/workflows/fe03cc9f25784c638002509b447a3cb0/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=UzlsINngMfi77TwVIQ31tk0zv5IVkwJ8ZzLvg-aV0O8";

const CIAURI =
  "https://prod-10.uksouth.logic.azure.com/workflows/b613fa264a0c4abc8f2adb7d8447f9c5/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=b3LvQmYN7UoKrVeprTz9ZBvXFHhHipCEebMn5gPXP18";

const DIAURI0 =
  "https://prod-37.uksouth.logic.azure.com/workflows/167c19445f634fd68ec0c3532223365e/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets/";
const DIAURI1 =
  "?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=-UydFuCmYnQQo1NrfoTC_zGIu5YOajzsquLW3Th4n0Y";

const UIAURI0 =
  "https://prod-49.uksouth.logic.azure.com/workflows/9f0185c1cf2c4000bb315b5afc0df824/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets/";
const UIAURI1 =
  "?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=cps-GmRdO7gBIkrSQ_Wp_kbiyojLNMxjQITx2yqy-ZI";

const UPLOADSAS =
  "https://prod-25.uksouth.logic.azure.com/workflows/f9b690f3816f449a923bbbc5da09fe4b/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/media/sas?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=Mvrn9it3Yg1H-Xd_hj19vphGM42sdyFdKJWGcMl6uvc";

const READSAS =
  "https://prod-34.uksouth.logic.azure.com/workflows/0968b01895ea44a78e97950797209edf/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/media/read?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=sHmEpgqyFZVhNYJj0_Pfmv6zNU2wlC2TPNwoPxQSfVU";

// ---- Paging/search state ----
let currentPage = 1;
let pageSize = 10;
let currentSearch = "";
let lastTotal = 0;
let lastTotalPages = 1;

// Selected asset for update
let selectedAssetId = null;

// Store last loaded page items so Select can fill the form
let lastItems = [];

// Cache SAS URLs so we don't call READSAS repeatedly
const sasCache = new Map(); // blobName -> { url, expiresUtcMs }

// --- Helpers ---
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showStatus(msg, kind = "info", ms = 2500) {
  const el = document.getElementById("statusBar");
  if (!el) return;
  el.className = `alert alert-${kind} py-2 mb-2`;
  el.textContent = msg;
  el.style.display = "block";
  if (ms > 0) setTimeout(() => (el.style.display = "none"), ms);
}

function setButtonEnabled(id, enabled) {
  const el = document.getElementById(id);
  if (el) el.disabled = !enabled;
}

function setBusy(isBusy) {
  ["retAssets", "subNewForm", "searchBtn", "prevPage", "nextPage", "updateSelectedBtn"].forEach((id) =>
    setButtonEnabled(id, !isBusy)
  );
}

function fileNameFromBlobName(blobName) {
  if (!blobName) return "download";
  const parts = blobName.split("/");
  return parts[parts.length - 1] || "download";
}

async function downloadViaFetch(sasUrl, suggestedName) {
  const res = await fetch(sasUrl, { method: "GET" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

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

function fillFormFromAsset(a) {
  $("#AssetLabel").val(a.AssetLabel || "");
  $("#Cost").val(a.Cost || "");
  $("#AssetType").val(a.AssetType || "");
  $("#NameOfOwner").val(a.NameOfOwner || "");
  $("#AddressLine1").val(a.AddressLine1 || "");
  $("#AddressLine2").val(a.AddressLine2 || "");
  $("#Note").val(a.Note || "");
}

function setSelectedId(id) {
  selectedAssetId = id;
  const el = document.getElementById("selectedId");
  if (el) el.textContent = id ? String(id) : "none";
}

function getSelectedFile() {
  const el = document.getElementById("MediaFile");
  if (!el || !el.files || el.files.length === 0) return null;
  return el.files[0];
}

function buildRAAUrl() {
  const params = [];
  params.push("page=" + encodeURIComponent(currentPage));
  params.push("pageSize=" + encodeURIComponent(pageSize));
  params.push("search=" + encodeURIComponent((currentSearch || "").trim()));
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
    cache: false,
  });
}

async function uploadFileToBlob(sasUrl, file) {
  const maxMb = 8;
  if (file.size > maxMb * 1024 * 1024) throw new Error(`File too large. Max ${maxMb}MB.`);

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

function getReadSasUrl(blobName) {
  return $.ajax({
    url: READSAS + "&blobName=" + encodeURIComponent(blobName),
    type: "GET",
    dataType: "json",
    cache: false,
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

// ---- Debounce search ----
let searchDebounceTimer = null;
function triggerSearchDebounced() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentPage = 1;
    getAssetList();
  }, 350);
}

// ---- Theme ----
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-bs-theme", isDark ? "dark" : "light");
  localStorage.setItem("carverse_theme", isDark ? "dark" : "light");

  const topBar = document.getElementById("topBar");
  if (topBar) topBar.className =
    "d-flex flex-wrap align-items-center justify-content-between gap-2 p-2 rounded " +
    (isDark ? "bg-dark" : "bg-light");
}

function initTheme() {
  const saved = localStorage.getItem("carverse_theme") || "light";
  applyTheme(saved);
}

// --- Wire UI ---
$(document).ready(function () {
  initTheme();

  const ps = parseInt($("#pageSize").val(), 10);
  if (!Number.isNaN(ps)) pageSize = ps;

  $("#themeToggle").click(function () {
    const current = localStorage.getItem("carverse_theme") || "light";
    applyTheme(current === "light" ? "dark" : "light");
  });

  $("#retAssets").click(function () {
    currentSearch = ($("#searchBox").val() || "").trim();
    pageSize = parseInt($("#pageSize").val(), 10) || 10;
    currentPage = 1;
    getAssetList();
  });

  $("#subNewForm").click(submitNewAsset);

  $("#updateSelectedBtn").click(function () {
    if (!selectedAssetId) return alert("No asset selected. Click Select first.");
    updateAsset(selectedAssetId);
  });

  $("#clearFormBtn").click(function () {
    document.getElementById("newAssetForm")?.reset();
    setSelectedId(null);
    showStatus("Form cleared.", "secondary", 1200);
  });

  $("#searchBox").on("input", function () {
    currentSearch = ($(this).val() || "").trim();
    triggerSearchDebounced();
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
    if (currentPage < lastTotalPages) currentPage++;
    getAssetList();
  });
});

// --- CREATE ---
async function submitNewAsset() {
  const subObj = buildAssetFromForm();
  if (!subObj.AssetLabel || String(subObj.AssetLabel).trim() === "") return alert("Asset Label is required");

  setBusy(true);

  try {
    const file = getSelectedFile();
    if (file) {
      showStatus("Requesting upload token (SAS)…", "info", 0);
      const sas = await requestUploadSas(file);
      showStatus("Uploading image to Blob Storage…", "info", 0);
      await uploadFileToBlob(sas.sasUrl, file);
      subObj.MediaBlobName = sas.blobName;
      sasCache.delete(sas.blobName);
    }

    showStatus("Creating asset…", "info", 0);
    await $.ajax({
      method: "POST",
      url: CIAURI,
      data: JSON.stringify(subObj),
      contentType: "application/json; charset=utf-8",
      dataType: "text",
      cache: false,
    });

    showStatus("Created ✅", "success", 1500);
    currentPage = 1;
    getAssetList();
  } catch (e) {
    alert(String(e));
    console.log(e);
    showStatus("Create failed ❌", "danger", 3000);
  } finally {
    setBusy(false);
  }
}

// --- READ ALL ---
function getAssetList() {
  setBusy(true);

  $("#AssetList").html(
    '<div class="text-muted">Loading assets…</div>' +
    '<div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div>'
  );

  $.ajax({
    method: "GET",
    url: buildRAAUrl(),
    dataType: "json",
    cache: false,
  })
    .done(function (data) {
      const items = data && Array.isArray(data.items) ? data.items : [];
      lastItems = items;
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
          `<div class="card shadow-sm mb-3 asset-card">` +
            `<div class="card-body">` +
              `<div class="d-flex flex-wrap justify-content-between gap-2">` +
                `<div>` +
                  `<div class="text-muted muted-sm">Asset ID</div>` +
                  `<div class="mono">${escapeHtml(id)}</div>` +
                `</div>` +
                `<div class="d-flex gap-2">` +
                  `<button class="btn btn-outline-primary btn-xs" onclick="selectAsset(${id})">Select</button>` +
                  `<button class="btn btn-warning btn-xs" onclick="updateAsset(${id})">Update</button>` +
                  `<button class="btn btn-danger btn-xs" onclick="deleteAsset(${id})">Delete</button>` +
                `</div>` +
              `</div>` +

              `<hr class="my-2" />` +

              `<div><strong>${escapeHtml(val.AssetLabel)}</strong></div>` +
              `<div class="text-muted muted-sm">Type: ${escapeHtml(val.AssetType)} | Owner: ${escapeHtml(val.NameOfOwner)}</div>` +
              `<div class="mt-2">Cost: <strong>£${escapeHtml(val.Cost)}</strong></div>` +
              `<div class="text-muted muted-sm mt-1">${escapeHtml(val.AddressLine1)} ${escapeHtml(val.AddressLine2)}</div>` +
              `<div class="mt-2">${escapeHtml(val.Note)}</div>`
        );

        if (blobName) {
          html.push(
            `<div class="mt-3">` +
              `<div id="imgloading-${id}" class="text-muted muted-sm">Loading image…</div>` +
              `<img id="img-${id}" class="asset-img mt-2" alt="asset image" style="display:none;" />` +
              `<div class="d-flex gap-2 mt-2">` +
                `<button class="btn btn-outline-secondary btn-xs" onclick="downloadAssetImage('${escapeHtml(blobName)}')">Download photo</button>` +
              `</div>` +
            `</div>`
          );
        } else {
          html.push(`<div class="mt-3 text-muted muted-sm">No image uploaded for this asset.</div>`);
        }

        html.push(`</div></div>`);
      });

      $("#AssetList").empty().append(html.join(""));

      // Load images after render
      const jobs = items
        .filter((x) => x.MediaBlobName)
        .map((x) =>
          getReadSasUrlCached(x.MediaBlobName)
            .then((sasUrl) => {
              const img = document.getElementById(`img-${x.AssetID}`);
              const loading = document.getElementById(`imgloading-${x.AssetID}`);
              if (img) { img.src = sasUrl; img.style.display = "block"; }
              if (loading) loading.remove();
            })
            .catch(() => {
              const loading = document.getElementById(`imgloading-${x.AssetID}`);
              if (loading) loading.textContent = "Image failed to load";
            })
        );

      Promise.all(jobs).catch(() => {});
      showStatus("Loaded ✅", "success", 900);
    })
    .fail(function (xhr) {
      alert(`Read failed: ${xhr.status}`);
      console.log(xhr.responseText);
      showStatus("Read failed ❌", "danger", 3000);
    })
    .always(function () {
      setBusy(false);
    });
}

// Select fills the form from lastItems
function selectAsset(id) {
  const found = lastItems.find((x) => x.AssetID === id);
  if (found) fillFormFromAsset(found);
  setSelectedId(id);
  showStatus(`Selected ${id} for update`, "info", 1500);
}

// --- DELETE ---
function deleteAsset(id) {
  if (!confirm("Delete asset " + id + "?")) return;

  const url = DIAURI0 + encodeURIComponent(id) + DIAURI1;

  setBusy(true);
  showStatus("Deleting…", "info", 0);

  $.ajax({
    method: "DELETE",
    url: url,
    dataType: "text",
    cache: false,
  })
    .done(function () {
      showStatus("Deleted ✅", "success", 1200);
      if (selectedAssetId === id) setSelectedId(null);

      if (currentPage > 1 && lastTotal > 0 && (lastTotal - 1) <= (currentPage - 1) * pageSize) {
        currentPage--;
      }
      getAssetList();
    })
    .fail(function (xhr) {
      alert(`Delete failed: ${xhr.status}`);
      console.log(xhr.responseText);
      showStatus("Delete failed ❌", "danger", 3000);
    })
    .always(function () {
      setBusy(false);
    });
}

// --- UPDATE ---
async function updateAsset(id) {
  const updateObj = buildAssetFromForm();
  if (!updateObj.AssetLabel || String(updateObj.AssetLabel).trim() === "") return alert("Asset Label is required before updating.");

  setBusy(true);

  try {
    const file = getSelectedFile();
    if (file) {
      showStatus("Requesting upload token (SAS)…", "info", 0);
      const sas = await requestUploadSas(file);
      showStatus("Uploading image…", "info", 0);
      await uploadFileToBlob(sas.sasUrl, file);
      updateObj.MediaBlobName = sas.blobName;
      sasCache.delete(sas.blobName);
    }

    const url = UIAURI0 + encodeURIComponent(id) + UIAURI1;

    showStatus("Updating…", "info", 0);
    await $.ajax({
      method: "PUT",
      url: url,
      data: JSON.stringify(updateObj),
      contentType: "application/json; charset=utf-8",
      dataType: "text",
      cache: false,
    });

    showStatus("Updated ✅", "success", 1200);
    getAssetList();
  } catch (e) {
    alert(String(e));
    console.log(e);
    showStatus("Update failed ❌", "danger", 3000);
  } finally {
    setBusy(false);
  }
}

// --- Download photo ---
async function downloadAssetImage(blobName) {
  try {
    showStatus("Generating download link…", "info", 0);
    const sasUrl = await getReadSasUrlCached(blobName);
    showStatus("Downloading…", "info", 0);
    await downloadViaFetch(sasUrl, fileNameFromBlobName(blobName));
    showStatus("Download started ✅", "success", 1200);
  } catch (e) {
    alert(String(e));
    console.log(e);
    showStatus("Download failed ❌", "danger", 3000);
  }
}
