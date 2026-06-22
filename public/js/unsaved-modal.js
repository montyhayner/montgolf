// ------------------------------------------------------------
//  UNSAVED CHANGES MODAL — Shared Across All Pages
// ------------------------------------------------------------

// Global unsaved flag (each page should set this when needed)
window.unsavedChanges = window.unsavedChanges || false;

// Callback storage
let unsavedModalCallbacks = {
  onSave: null,
  onContinue: null,
  onCancel: null
};

// ------------------------------------------------------------
//  Inject Modal HTML Into Page
// ------------------------------------------------------------
// ------------------------------------------------------------
//  Inject Modal HTML Into Page (namespaced to avoid CSS conflicts)
// ------------------------------------------------------------
(function injectUnsavedModal() {
  const html = `
    <div id="unsavedModal" class="unsaved-overlay" style="display:none;">
      <div class="unsaved-content">
        <h2>Unsaved Changes</h2>
        <p>You have unsaved changes. What would you like to do?</p>

        <div class="unsaved-buttons">
          <button id="unsavedSave" class="primary">Save & Continue</button>
          <button id="unsavedContinue" class="warning">Continue Without Saving</button>
          <button id="unsavedCancel" class="secondary">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);
})();

function attachUnsavedNavigationGuards() {
  document.querySelectorAll(".nav-link, .back-link").forEach(link => {
    if (link.dataset.unsavedGuardAttached) return;
    link.dataset.unsavedGuardAttached = "true";

    link.addEventListener("click", (e) => {
      if (!window.unsavedChanges) return;

      e.preventDefault();

      requireNoUnsavedChanges({
        onSave: async () => {
          window.onbeforeunload = null;
          if (window.savePageChanges) await window.savePageChanges();
          window.location = link.href;
        },
        onContinue: () => {
          window.onbeforeunload = null;
          window.location = link.href;
        },
        onCancel: () => {}
      });
    });
  });
}

// ------------------------------------------------------------
//  Modal Controller
// ------------------------------------------------------------
function showUnsavedChangesModal(callbacks) {
  unsavedModalCallbacks = callbacks;
  document.getElementById("unsavedModal").style.display = "flex";
}

function hideUnsavedChangesModal() {
  document.getElementById("unsavedModal").style.display = "none";
}


// ------------------------------------------------------------
//  Button Wiring (after DOM is ready)
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("unsavedSave").addEventListener("click", async () => {
    hideUnsavedChangesModal();
    if (unsavedModalCallbacks.onSave) await unsavedModalCallbacks.onSave();
  });

  document.getElementById("unsavedContinue").addEventListener("click", () => {
    hideUnsavedChangesModal();
    if (unsavedModalCallbacks.onContinue) unsavedModalCallbacks.onContinue();
  });

  document.getElementById("unsavedCancel").addEventListener("click", () => {
    hideUnsavedChangesModal();
    if (unsavedModalCallbacks.onCancel) unsavedModalCallbacks.onCancel();
  });
});


// ------------------------------------------------------------
//  Helper: Require No Unsaved Changes
// ------------------------------------------------------------
window.requireNoUnsavedChanges = function(callbacks) {
  if (!window.unsavedChanges) {
    callbacks.onContinue();
    return;
  }
  showUnsavedChangesModal(callbacks);
};

// Run once when DOM is ready
document.addEventListener("DOMContentLoaded", attachUnsavedNavigationGuards);

// Run again after nav-loader injects navbar
document.addEventListener("navLoaded", attachUnsavedNavigationGuards);


// ------------------------------------------------------------
//  Browser Leave Warning
// ------------------------------------------------------------
window.onbeforeunload = (e) => {
  if (!window.unsavedChanges) return;
  e.preventDefault();
  e.returnValue = "";
};
