// ===============================
// CarVerse Asset Tracker - app.js
// Full CRUD + Media (SAS upload/read) + Paging/Search
// ===============================

"use strict";

// --- REST endpoints (Logic Apps) ---
const RAAURI =
  "https://prod-47.uksouth.logic.azure.com/workflows/fe03cc9f25784c638002509b447a3cb0/triggers/When_an_HTTP_request_is_received/paths/invoke/rest/v1/assets?api-version=2016-10-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=UzlsINngMfi77TwVIQ31tk0zv5IVkwJ8ZzLvg-aV0O8"; // READ ALL (GET) now returns { items,total,page,pageSize,search }

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

// ---- Paging/search state (works even if HTML has no controls) ----
let currentPage = 1;
let pageSize = 10;
let currentSearch = "";

// Cache SAS URLs so we don't call READSAS for the same blob repeatedly
const sasCache = new Map(); // blobName -> { url, expiresUtcMs }

// --- Helpers ---
function logAjaxError(prefix, xhr) {
  const msg = `${prefix} failed: ${xhr.status} ${xhr.statusText || ""}`;
  alert(msg);
  console.log(msg);
  console.log("ResponseText:", xhr.responseText);
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
  if (currentSearch && currentSearch.trim() !== "") {
    params.push("search=" + encodeURIComponent(currentSearch.trim()));
  }
  return RAAURI + "&" + params.join("&");
}

// Optional: show paging info if #pageInfo exists
function renderPagingMeta(meta) {
  const el = document.getElementById("pageInfo");
  if (!el) return;

  const total = meta && meta.total != null ? meta.total : 0;
  const page = meta && meta.page != null ? meta.page : currentPage;
  const size = meta && meta.pageSize != null ? meta.pageSize : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / size));

  el.textContent = `Page ${page} of ${totalPages} (Total: ${total})`;
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

// --- Wire buttons (and optional controls if present) ---
$(document).ready(function () {
  $("#retAssets").click(getAssetList);
  $("#subNewForm").click(submitNewAsset);

  // Optional controls (won’t error if not in HTML)
  $("#searchBox").on("input", function () {
    currentSearch = $(this).val();
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
    currentPage++;
    getAssetList();
  });
});

// --- CREATE (POST) with optional image upload ---
async function submitNewAsset() {
  const subObj = buildAssetFromForm();

  if (!subObj.AssetLabel) {
    alert("Asset Label is required");
    return;
  }

  try {
    const file = getSelectedFile();
    if (file) {
      const sas = await requestUploadSas(file); // { blobName, sasUrl, contentType }
      await uploadFileToBlob(sas.sasUrl, file);
      subObj.MediaBlobName = sas.blobName; // store in SQL
    }

    await $.ajax({
      method: "POST",
      url: CIAURI,
      data: JSON.stringify(subObj),
      contentType: "application/json; charset=utf-8",
      dataType: "text",
    });

    getAssetList();
  } catch (e) {
    alert(String(e));
    console.log(e);
  }
}

// --- READ ALL (GET) + paging/search + display images using READ-SAS ---
function getAssetList() {
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
      // data is { items,total,page,pageSize,search }
      const list = Array.isArray(data) ? data : (data.items || []);
      renderPagingMeta(data);

      const html = [];

      list.forEach((val) => {
        const id = val.AssetID;
        const blobName = val.MediaBlobName;

        html.push(
          `<div style="border:1px solid #ddd; padding:10px; margin-bottom:10px; border-radius:8px;">` +
            `<strong>Asset ID:</strong> ${id}<br/>` +
            `<strong>Asset Label:</strong> ${val.AssetLabel}, <strong>Cost:</strong> ${val.Cost}<br/>` +
            `<strong>Asset Type:</strong> ${val.AssetType}, <strong>Owner:</strong> ${val.NameOfOwner}<br/>` +
            `<strong>Address 1:</strong> ${val.AddressLine1}<br/>` +
            `<strong>Address 2:</strong> ${val.AddressLine2}<br/>` +
            `<strong>Note:</strong> ${val.Note}<br/>`
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
      const jobs = list
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
    });
}

// --- DELETE (DELETE /assets/{id}) ---
function deleteAsset(id) {
  const url = DIAURI0 + encodeURIComponent(id) + DIAURI1;

  $.ajax({
    method: "DELETE",
    url: url,
    dataType: "text",
    cache: false,
  })
    .done(getAssetList)
    .fail(function (xhr) {
      logAjaxError("Delete", xhr);
    });
}

// --- UPDATE (PUT /assets/{id}) with optional new image upload ---
async function updateAsset(id) {
  const updateObj = buildAssetFromForm();

  if (!updateObj.AssetLabel) {
    alert("Asset Label is required before updating.");
    return;
  }

  try {
    const file = getSelectedFile();
    if (file) {
      const sas = await requestUploadSas(file);
      await uploadFileToBlob(sas.sasUrl, file);
      updateObj.MediaBlobName = sas.blobName;
    }

    const url = UIAURI0 + encodeURIComponent(id) + UIAURI1;

    await $.ajax({
      method: "PUT",
      url: url,
      data: JSON.stringify(updateObj),
      contentType: "application/json; charset=utf-8",
      dataType: "text",
    });

    getAssetList();
  } catch (e) {
    alert(String(e));
    console.log(e);
  }
}
