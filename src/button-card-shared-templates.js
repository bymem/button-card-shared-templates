import { LitElement, html, nothing } from "lit";
import jsyaml from "js-yaml";

// Shared loading-spinner styles, injected into document.head once rather
// than duplicated per instance - same technique NativePop uses for its own
// panel/dialog loading states. Hand-rolled CSS spinner rather than an HA
// internal component (e.g. ha-circular-progress): zero dependency on
// undocumented internals, themes via var(--primary-color).
(function injectSharedStyles() {
  if (document.getElementById("bcst-shared-styles")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "bcst-shared-styles";
  style.textContent = `
    .bcst-loading {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 48px 24px; min-height: 200px;
      color: var(--secondary-text-color);
    }
    .bcst-spinner {
      width: 32px; height: 32px; border-radius: 50%;
      border: 3px solid var(--divider-color);
      border-top-color: var(--primary-color);
      animation: bcst-spin 0.8s linear infinite;
    }
    @keyframes bcst-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
})();

const WS_GET = "button_card_shared_templates/get";
const WS_LIST = "button_card_shared_templates/list";
const WS_SAVE = "button_card_shared_templates/save";
const WS_DELETE = "button_card_shared_templates/delete";
const WS_SYNC = "button_card_shared_templates/sync";

// Real MDI SVG path data - ha-icon-button needs raw path data via `.path`,
// not an "mdi:name" string.
const mdiPencil =
  "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z";
const mdiDelete =
  "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z";

// Create/edit dialog - built with plain DOM calls: ha-adaptive-dialog
// (renders as a real ha-dialog on desktop, a swipeable ha-bottom-sheet on
// mobile) + a plain content div + ha-dialog-footer with ha-button
// primary/secondary actions. Resolves true if the template was saved,
// false if cancelled.
//
// Appended under `mountEl` (the panel element itself) rather than
// document.body. HA's own dialog manager (make-dialog-manager.ts) mounts
// dialogs inside the app's root element's own shadow root specifically so
// Lit's @lit/context providers (ContextProvider instances attached to
// <home-assistant> in state/context-mixin.ts, e.g. internationalization)
// can reach them - a context-request event only reaches a provider via
// genuine DOM ancestry, and document.body is a *sibling* of
// <home-assistant>, not a descendant. Appending to document.body silently
// broke ha-yaml-editor, which reads that context on every YAML change to
// build the "invalid YAML" error message and throws if it's missing. The
// panel element is already a real descendant of <home-assistant> (that's
// how it gets `.hass` at all), so mounting there fixes context propagation
// without needing a global document.querySelector for the app root.
//
// Name field is `ha-input`, not `ha-textfield` - HA replaced ha-textfield
// (mwc-textfield) with ha-input (wa-input-backed) some time ago, and
// ha-textfield no longer exists as a registered element at all. Creating
// one silently produces an inert, unstyled, invisible element - that's why
// the name field looked "missing" rather than erroring loudly.
function openTemplateFormDialog(hass, mountEl, { heading, name, originalName, isNew, yamlObj }) {
  return new Promise((resolve) => {
    let currentName = name;
    let currentYamlObj = yamlObj;
    let currentYamlValid = true;
    let resolved = false;

    const dialog = document.createElement("ha-adaptive-dialog");
    dialog.headerTitle = heading;
    dialog.width = "medium";
    dialog.allowModeChange = true;
    // Makes ha-dialog's/ha-bottom-sheet's own content area a flex column
    // (see ha-dialog.ts `:host([flexcontent]) .body`), so our content div
    // below can flex-grow to fill it instead of shrink-wrapping to the
    // yaml editor's own intrinsic height.
    dialog.flexContent = true;
    // ha-dialog reads this custom property for the dialog surface's
    // min-height (ha-dialog.ts: `min-height: var(--ha-dialog-min-height)`)
    // - same mechanism NativePop uses for --ha-dialog-width-md, just the
    // height counterpart. Makes the dialog fill most of the viewport
    // instead of shrink-wrapping to the name field + a small editor.
    dialog.style.setProperty("--ha-dialog-min-height", "95vh");
    dialog.open = true;

    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "16px";
    content.style.flex = "1";
    content.style.minHeight = "0";

    const nameField = document.createElement("ha-input");
    nameField.label = "Name";
    nameField.value = currentName;
    nameField.autofocus = true;
    nameField.toggleAttribute("autofocus", true);
    content.appendChild(nameField);

    const yamlEditor = document.createElement("ha-yaml-editor");
    yamlEditor.defaultValue = currentYamlObj;
    yamlEditor.inDialog = true;
    // ha-yaml-editor's own ha-code-editor is `flex-grow: 1` internally
    // (ha-yaml-editor.ts), but that only does anything once ha-yaml-editor
    // itself is a flex column - it isn't one by default, so force it here.
    yamlEditor.style.flex = "1";
    yamlEditor.style.minHeight = "0";
    yamlEditor.style.display = "flex";
    yamlEditor.style.flexDirection = "column";
    content.appendChild(yamlEditor);

    // Convenience for pasting a whole template straight from the old
    // per-dashboard copy/paste era, e.g.:
    //   base:
    //       state:
    //         - value: unavailable
    //       styles:
    //         card:
    //           - padding: 12px
    // Paste that whole block into the editor as-is, then click this to
    // extract the top-level key into Name and re-dump just its value into
    // the editor. Re-dumping through js-yaml also normalizes whatever
    // indentation the paste came in with (4-space here) to this editor's
    // own 2-space convention - not just a name split.
    //
    // Always visible with an explicit failure message on click, rather
    // than reactively shown/hidden based on ha-yaml-editor's live parsed
    // value - that first version depended on `value-changed` firing with a
    // valid parse right after a large paste, which isn't guaranteed (a
    // CodeMirror paste doesn't necessarily fire the same way a typed edit
    // does), and failed silently with zero feedback when it didn't.
    const unwrapBtn = document.createElement("ha-button");
    unwrapBtn.setAttribute("appearance", "plain");
    unwrapBtn.style.alignSelf = "flex-start";
    unwrapBtn.textContent = "Extract name from pasted YAML";
    content.appendChild(unwrapBtn);

    unwrapBtn.addEventListener("click", () => {
      if (currentYamlValid === false) {
        showError("Fix the YAML syntax errors before extracting a name from it.");
        return;
      }
      const keys = Object.keys(currentYamlObj || {});
      const soleValue = keys.length === 1 ? currentYamlObj[keys[0]] : undefined;
      if (keys.length !== 1 || !soleValue || typeof soleValue !== "object") {
        showError(
          `Expected exactly one top-level key with a nested config (like "name:" followed by an indented block) - found ${keys.length} top-level key(s) instead.`
        );
        return;
      }
      const [key] = keys;
      currentName = key;
      nameField.value = key;
      saveBtn.disabled = !currentName.trim();
      currentYamlObj = soleValue;
      yamlEditor.setValue(soleValue);
      errorEl.hidden = true;
    });

    const errorEl = document.createElement("div");
    errorEl.style.color = "var(--error-color)";
    errorEl.hidden = true;
    content.appendChild(errorEl);

    const showError = (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
    };

    const cancelBtn = document.createElement("ha-button");
    cancelBtn.slot = "secondaryAction";
    cancelBtn.setAttribute("appearance", "plain");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      dialog.open = false;
    });

    const saveBtn = document.createElement("ha-button");
    saveBtn.slot = "primaryAction";
    saveBtn.textContent = "Save";
    saveBtn.disabled = !currentName.trim();

    nameField.addEventListener("input", (ev) => {
      currentName = ev.target.value;
      saveBtn.disabled = !currentName.trim();
    });

    yamlEditor.addEventListener("value-changed", (ev) => {
      currentYamlObj = ev.detail.value;
      currentYamlValid = ev.detail.isValid;
    });

    saveBtn.addEventListener("click", async () => {
      const trimmedName = currentName.trim();
      if (!trimmedName) {
        return;
      }
      if (currentYamlValid === false) {
        showError("Fix the YAML syntax errors before saving.");
        return;
      }

      saveBtn.disabled = true;
      try {
        const payload = {
          type: WS_SAVE,
          name: trimmedName,
          // jsyaml.dump() is inside the try too - a dump failure (e.g. an
          // unsupported value type sneaking into currentYamlObj) used to
          // throw outside any catch here, producing a bare unhandled
          // promise rejection instead of the inline dialog error.
          yaml: jsyaml.dump(currentYamlObj ?? {}),
        };
        if (!isNew && originalName !== trimmedName) {
          payload.old_name = originalName;
        }
        await hass.callWS(payload);
        resolved = true;
        dialog.open = false;
        resolve(true);
      } catch (err) {
        showError(err?.message || "Failed to save template.");
        saveBtn.disabled = !currentName.trim();
      }
    });

    const footer = document.createElement("ha-dialog-footer");
    footer.slot = "footer";
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    dialog.appendChild(content);
    dialog.appendChild(footer);

    // ha-adaptive-dialog fires "closed" on any close path (Cancel, Save,
    // ESC, outside click, swipe-down, or us setting .open = false) - clean
    // up there rather than in each individual handler.
    dialog.addEventListener("closed", () => {
      dialog.remove();
      if (!resolved) {
        resolve(false);
      }
    });

    mountEl.appendChild(dialog);
  });
}

class ButtonCardSharedTemplatesPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
    _templates: { state: true },
    _filter: { state: true },
    _loading: { state: true },
    _syncing: { state: true },
  };

  constructor() {
    super();
    this._templates = [];
    this._filter = "";
    this._loading = false;
    this._syncing = false;
  }

  // Render into light DOM instead of the LitElement default shadow root -
  // matches NativePop's approach (plain HTMLElement + innerHTML) and avoids
  // the same class of shadow-DOM containment issue that broke the dialog:
  // .fab-button below is `position: fixed`, which can end up positioned
  // relative to some transformed ancestor instead of the viewport if it's
  // trapped behind a shadow boundary inside HA's app shell. Also means
  // `static styles` (shadow-only) doesn't apply - styles are a plain
  // <style> tag in the template instead, same as the injected block above.
  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this._fetchList();
  }

  _toggleMenu() {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  get _columns() {
    return {
      name: {
        title: "Name",
        main: true,
        sortable: true,
        filterable: true,
        direction: "asc",
        grows: true,
      },
      last_modified: {
        title: "Last modified",
        sortable: true,
        filterable: false,
        width: "220px",
        template: (row) =>
          row.last_modified ? new Date(row.last_modified).toLocaleString() : "—",
      },
      actions: {
        title: "",
        sortable: false,
        filterable: false,
        width: "96px",
        template: (row) => html`
          <div style="display: flex; width: 100%; justify-content: flex-end;">
            <ha-icon-button
              .path=${mdiPencil}
              label="Edit"
              @click=${(ev) => {
                ev.stopPropagation();
                this._openDialog(row.name);
              }}
            ></ha-icon-button>
            <ha-icon-button
              .path=${mdiDelete}
              label="Delete"
              @click=${(ev) => {
                ev.stopPropagation();
                this._deleteTemplate(row.name);
              }}
            ></ha-icon-button>
          </div>
        `,
      },
    };
  }

  get _rows() {
    return this._templates.map((template) => ({ ...template, id: template.name }));
  }

  render() {
    if (!this.hass) {
      return nothing;
    }

    // Toolbar (sticky, app-header styled) + full-bleed content + a FAB-
    // style "+ New template" button - the same layout NativePop's own
    // panel uses (Settings > Dashboards' own layout, in turn), rather than
    // a padded header row with inline buttons. The menu button only shows
    // narrow/mobile, toggling HA's real sidebar via the same event
    // ha-menu-button itself dispatches.
    return html`
      <style>
        button-card-shared-templates-panel {
          display: block;
          height: 100%;
          box-sizing: border-box;
          overflow: auto;
          background: var(--primary-background-color);
        }
        .bcst-toolbar {
          display: flex;
          align-items: center;
          gap: 16px;
          height: 56px;
          padding: 0 16px;
          box-sizing: border-box;
          background: var(--app-header-background-color, var(--primary-background-color));
          color: var(--app-header-text-color, var(--primary-text-color));
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .bcst-toolbar .bcst-title {
          font-size: 20px;
          font-weight: 400;
          flex: 1;
        }
        .bcst-content {
          padding: 16px;
          padding-bottom: 88px;
        }
        search-input {
          display: block;
          margin-bottom: 8px;
        }
        .bcst-fab-button {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 2;
        }
      </style>

      <div class="bcst-toolbar">
        ${this.narrow
          ? html`
              <ha-icon-button label="Menu" @click=${this._toggleMenu}>
                <ha-icon icon="mdi:menu"></ha-icon>
              </ha-icon-button>
            `
          : nothing}
        <span class="bcst-title">Button Card Templates</span>
        <ha-icon-button
          label="Sync now"
          .disabled=${this._syncing}
          @click=${this._syncNow}
        >
          <ha-icon icon="mdi:sync"></ha-icon>
        </ha-icon-button>
      </div>

      <div class="bcst-content">
        ${this._loading
          ? html`<div class="bcst-loading"><div class="bcst-spinner"></div></div>`
          : html`
              <search-input
                .hass=${this.hass}
                .filter=${this._filter}
                @value-changed=${this._handleSearchInput}
                .label=${"Search templates"}
              ></search-input>

              <ha-data-table
                .hass=${this.hass}
                .columns=${this._columns}
                .data=${this._rows}
                .filter=${this._filter}
                .noDataText=${"No templates yet — create one to get started."}
                clickable
                auto-height
                @row-click=${this._handleRowClick}
              ></ha-data-table>
            `}
      </div>

      <ha-button size="l" class="bcst-fab-button" @click=${() => this._openDialog()}>
        <ha-icon slot="start" icon="mdi:plus"></ha-icon>
        New template
      </ha-button>
    `;
  }

  // Called fire-and-forget from several places (firstUpdated, after
  // save/delete, etc.) without anyone awaiting or catching the returned
  // promise - it must never reject itself, or a failed refresh turns into
  // a bare "Unhandled Promise Rejection" instead of a visible error.
  async _fetchList() {
    this._loading = true;
    try {
      this._templates = await this.hass.callWS({ type: WS_LIST });
    } catch (err) {
      console.error("Could not load templates", err);
      alert("Could not load templates. See console for details.");
    } finally {
      this._loading = false;
    }
  }

  async _syncNow() {
    this._syncing = true;
    try {
      await this.hass.callWS({ type: WS_SYNC });
      await this._fetchList();
    } catch (err) {
      console.error("Sync failed", err);
      alert("Sync failed. See console for details.");
    } finally {
      this._syncing = false;
    }
  }

  _handleSearchInput(ev) {
    this._filter = ev.detail.value;
  }

  _handleRowClick(ev) {
    this._openDialog(ev.detail.id);
  }

  async _deleteTemplate(name) {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await this.hass.callWS({ type: WS_DELETE, name });
      this._fetchList();
    } catch (err) {
      console.error(`Could not delete template "${name}"`, err);
      alert(`Could not delete template "${name}". See console for details.`);
    }
  }

  async _openDialog(name) {
    let dialogParams;
    if (name) {
      let result;
      try {
        result = await this.hass.callWS({ type: WS_GET, name });
      } catch (err) {
        console.error(`Could not load template "${name}"`, err);
        alert(`Could not load template "${name}". See console for details.`);
        return;
      }
      dialogParams = {
        heading: `Edit ${name}`,
        name,
        originalName: name,
        isNew: false,
        yamlObj: jsyaml.load(result.yaml) ?? {},
      };
    } else {
      dialogParams = {
        heading: "New template",
        name: "",
        originalName: undefined,
        isNew: true,
        yamlObj: {},
      };
    }

    const saved = await openTemplateFormDialog(this.hass, this, dialogParams);
    if (saved) {
      this._fetchList();
    }
  }
}

customElements.define("button-card-shared-templates-panel", ButtonCardSharedTemplatesPanel);
