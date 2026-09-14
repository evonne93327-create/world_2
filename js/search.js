/* ==========================================================
   搜尋功能
   ========================================================== */

function handleSearchInput(inputEl) {
  const clearBtn = document.getElementById("searchClearBtn");
  if (inputEl.value.trim().length > 0) {
    clearBtn.style.display = "inline-flex";
  } else {
    clearBtn.style.display = "none";
  }
  renderSidebarTree();
}

function clearSearchInput() {
  const inputEl = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  inputEl.value = "";
  clearBtn.style.display = "none";
  renderSidebarTree();
  inputEl.focus();
}

function docMatchesSearch(doc, search) {
  if (!search) return true;
  return (doc.title || "").toLowerCase().includes(search) || (doc.content || "").toLowerCase().includes(search);
}

function renderActiveDocSearchPin(container, search) {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc || doc.worldId !== activeWorldId) return;
  if (!docMatchesSearch(doc, search)) return;

  const pinWrap = document.createElement("div");
  pinWrap.className = "search-pin-wrap";

  const label = document.createElement("div");
  label.className = "search-pin-label";
  label.textContent = "📌 目前開啟的文檔";
  pinWrap.appendChild(label);

  pinWrap.appendChild(createDocRowElement(doc));
  container.appendChild(pinWrap);
}
