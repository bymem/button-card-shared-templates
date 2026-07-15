import { LitElement, html, css, nothing } from "lit";
import jsyaml from "js-yaml";

const WS_LIST = "button_card_shared_templates/list";
const WS_GET = "button_card_shared_templates/get";
const WS_SAVE = "button_card_shared_templates/save";
const WS_DELETE = "button_card_shared_templates/delete";
const WS_SYNC = "button_card_shared_templates/sync";

const mdiPencil =
  "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z";
const mdiDelete =
  "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z";
const mdiPlus = "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z";
const mdiSync =
  "M12,18A6,6 0 0,1 6,12C6,11 6.25,10.03 6.7,9.2L5.24,7.74C4.46,8.97 4,10.43 4,12A8,8 0 0,0 12,20V23L16,19L12,15M12,4V1L8,5L12,9V6A6,6 0 0,1 18,12C18,13 17.75,13.97 17.3,14.8L18.76,16.26C19.54,15.03 20,13.57 20,12A8,8 0 0,0 12,4Z";

class ButtonCardSharedTemplatesPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
    _templates: { state: true },
    _filter: { state: true },
    _loading: { state: true },
    _syncing: { state: true },
    _dialogOpen: { state: true },
    _dialogIsNew: { state: true },
    _dialogOriginalName: { state: true },
    _dialogName: { state: true },
    _dialogYamlObj: { state: true },
    _dialogYamlValid: { state: true },
    _dialogError: { state: true },
  };

  constructor() {
    super();
    this._templates = [];
    this._filter = "";
    this._loading = false;
    this._syncing = false;
    this._dialogOpen = false;
  }

  firstUpdated() {
    this._fetchList();
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
          <ha-icon-button
            .path=${mdiPencil}
            .label=${"Edit"}
            .rowName=${row.name}
            @click=${this._editRow}
          ></ha-icon-button>
          <ha-icon-button
            .path=${mdiDelete}
            .label=${"Delete"}
            .rowName=${row.name}
            @click=${this._deleteRow}
          ></ha-icon-button>
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

    return html`
      <div class="header">
        <h1>Button Card Templates</h1>
        <div class="actions">
          <mwc-button @click=${this._syncNow} .disabled=${this._syncing}>
            <ha-svg-icon slot="icon" .path=${mdiSync}></ha-svg-icon>
            Sync now
          </mwc-button>
          <mwc-button raised @click=${() => this._openDialog()}>
            <ha-svg-icon slot="icon" .path=${mdiPlus}></ha-svg-icon>
            New template
          </mwc-button>
        </div>
      </div>

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
        .noDataText=${this._loading ? "Loading…" : "No templates yet."}
        clickable
        @row-click=${this._handleRowClick}
      ></ha-data-table>

      ${this._dialogOpen ? this._renderDialog() : nothing}
    `;
  }

  _renderDialog() {
    return html`
      <ha-dialog
        open
        .heading=${this._dialogIsNew ? "New template" : `Edit ${this._dialogOriginalName}`}
        @closed=${this._closeDialog}
      >
        <div class="dialog-content">
          <ha-textfield
            label="Name"
            .value=${this._dialogName}
            @input=${this._handleNameInput}
            autofocus
          ></ha-textfield>
          <ha-yaml-editor
            .defaultValue=${this._dialogYamlObj}
            @value-changed=${this._handleYamlChanged}
          ></ha-yaml-editor>
          ${this._dialogError
            ? html`<div class="error">${this._dialogError}</div>`
            : nothing}
        </div>
        <mwc-button slot="secondaryAction" @click=${this._closeDialog}>
          Cancel
        </mwc-button>
        <mwc-button slot="primaryAction" @click=${this._saveDialog}>
          Save
        </mwc-button>
      </ha-dialog>
    `;
  }

  async _fetchList() {
    this._loading = true;
    try {
      this._templates = await this.hass.callWS({ type: WS_LIST });
    } finally {
      this._loading = false;
    }
  }

  async _syncNow() {
    this._syncing = true;
    try {
      await this.hass.callWS({ type: WS_SYNC });
      await this._fetchList();
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

  _editRow(ev) {
    ev.stopPropagation();
    this._openDialog(ev.currentTarget.rowName);
  }

  async _deleteRow(ev) {
    ev.stopPropagation();
    const name = ev.currentTarget.rowName;
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) {
      return;
    }
    await this.hass.callWS({ type: WS_DELETE, name });
    this._fetchList();
  }

  async _openDialog(name) {
    this._dialogError = undefined;
    if (name) {
      const result = await this.hass.callWS({ type: WS_GET, name });
      this._dialogIsNew = false;
      this._dialogOriginalName = name;
      this._dialogName = name;
      this._dialogYamlObj = jsyaml.load(result.yaml) ?? {};
    } else {
      this._dialogIsNew = true;
      this._dialogOriginalName = undefined;
      this._dialogName = "";
      this._dialogYamlObj = {};
    }
    this._dialogYamlValid = true;
    this._dialogOpen = true;
  }

  _closeDialog() {
    this._dialogOpen = false;
  }

  _handleNameInput(ev) {
    this._dialogName = ev.target.value;
  }

  _handleYamlChanged(ev) {
    this._dialogYamlObj = ev.detail.value;
    this._dialogYamlValid = ev.detail.isValid;
  }

  async _saveDialog() {
    const name = (this._dialogName || "").trim();
    if (!name) {
      this._dialogError = "Name is required.";
      return;
    }
    if (this._dialogYamlValid === false) {
      this._dialogError = "Fix the YAML syntax errors before saving.";
      return;
    }

    const payload = {
      type: WS_SAVE,
      name,
      yaml: jsyaml.dump(this._dialogYamlObj ?? {}),
    };
    if (!this._dialogIsNew && this._dialogOriginalName !== name) {
      payload.old_name = this._dialogOriginalName;
    }

    try {
      await this.hass.callWS(payload);
      this._dialogOpen = false;
      this._fetchList();
    } catch (err) {
      this._dialogError = err?.message || "Failed to save template.";
    }
  }

  static styles = css`
    :host {
      display: block;
      padding: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .header h1 {
      font-size: 24px;
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    search-input {
      display: block;
      margin-bottom: 8px;
    }
    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 400px;
    }
    .error {
      color: var(--error-color);
    }
  `;
}

customElements.define("button-card-shared-templates-panel", ButtonCardSharedTemplatesPanel);
