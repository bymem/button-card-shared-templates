# button-card-shared-templates — Technical Spec

## Overview

`button-card` (the custom Lovelace card) resolves its `template:` references
from a `button_card_templates` key living inside whatever dashboard config
is currently loaded in the browser. That key is scoped per-dashboard —
storage-mode dashboards have no native way to share it, so templates get
copy-pasted into every dashboard's raw config editor and drift out of sync.

This integration gives templates a single source of truth (one YAML file)
and a native-feeling management UI, then pushes the merged result into
every dashboard's stored config whenever a template is added, edited, or
deleted. It reuses HA's own dashboard load/save methods to do the push — no
monkeypatching, no runtime interception of every dashboard load.

Modeled on [NativePop](https://github.com/bymem/NativePop)'s shape:
small Python integration + sidebar panel, dependency-free JS with a build
step only where `ha-data-table`/`lit-html` require it.

## Non-goals

- No structured/form-based template editing — templates are arbitrary
  nested YAML (styles, states, custom_fields, JS templates); a raw YAML
  editor is the only sane authoring surface.
- No live/automatic re-sync while the integration is idle. Sync only runs
  when a template is saved/deleted through the panel, or when the user
  hits "Sync now."
- No per-dashboard opt-out in v1 — every dashboard gets the merged
  `button_card_templates` key. (Worth revisiting if that turns out to be
  too broad in practice.)

## Storage

Single file: `config/button_card_templates.yaml`

```yaml
my_template_name:
  color_type: label-card
  styles:
    card:
      - padding: 4px
  # ...arbitrary button-card template config
another_template:
  # ...
```

- This is the exact shape a dashboard's `button_card_templates:` key
  expects — the merge step is a straight top-level key assignment, no
  transformation needed.
- Human-editable directly (git-trackable). The panel is a convenience
  layer on top of this file, not the only way to change it.
- `last_modified` per template is **not** stored in this file (would
  pollute the YAML users may want to hand-edit/diff). Track it separately
  in a small sidecar, e.g. `.storage/button_card_templates_meta` via HA's
  `Store` helper, keyed by template name → ISO timestamp. Updated only by
  the integration's own save path; a manual edit to the YAML file won't
  update the sidecar until the next panel save touches that key (acceptable
  — "last modified" is a UI nicety, not a sync trigger).

## Backend: `custom_components/button_card_shared_templates/`

### Setup

- `manifest.json` — `config_flow: false` (single field-free setup step,
  same as NativePop), `domain: button_card_shared_templates`
- `__init__.py`:
  - Registers the sidebar panel via `frontend.async_register_built_in_panel`
    (`panel_custom`, JS module served from `www/`)
  - Registers WS commands (below)
  - Loads `button_card_templates.yaml` on startup (create empty if missing)

### WebSocket commands (new commands — not overriding any built-in ones)

- `button_card_shared_templates/list`
  → returns `[{name, last_modified}, ...]`, sorted server-side by name by
  default (client can re-sort; `ha-data-table` handles that column-side)

- `button_card_shared_templates/get`
  → `{name}` in, `{name, yaml: "<raw yaml string>"}` out — raw YAML text is
  what feeds the `ha-yaml-editor` dialog

- `button_card_shared_templates/save`
  → `{name, yaml}` in (name may be new or existing)
  → parses YAML, writes to the templates file, updates the metadata
    sidecar's timestamp for that key, then runs the **sync** step (below)
  → returns success/parse-error so the dialog can surface a YAML syntax
    error inline instead of closing

- `button_card_shared_templates/delete`
  → `{name}` in → removes the key from the templates file, removes it from
    the metadata sidecar, runs sync (so the deletion also propagates and
    stops shipping to dashboards, not just future syncs)

- `button_card_shared_templates/sync`
  → no payload — manual "Sync now" trigger, runs the sync step without any
    save/delete attached to it (for after a hand-edit to the YAML file, or
    after a new dashboard is created)

### Sync step

```
for each dashboard in hass.data[lovelace_domain]["dashboards"]:
    config = await dashboard.async_load(force=True)
    config["button_card_templates"] = <current merged templates dict>
    await dashboard.async_save(config)
```

- Calls `LovelaceStorage.async_load()` / `async_save()` directly as normal
  method calls — not patched, not overridden. This is the same
  read-whole-config/write-whole-config cycle the dashboard UI editor
  itself does, so any unrelated keys (`views`, `strategy`, etc.) pass
  through untouched.
- Applies to storage-mode dashboards only. YAML-mode dashboards
  (`mode: yaml`) aren't backed by `LovelaceStorage` and should be skipped —
  detect via `dashboard.__class__` or the existing mode flag on the
  dashboard config entry, and skip with a debug log line rather than
  erroring.
- Wrap each dashboard's load/save in its own try/except — one dashboard
  failing to sync (e.g. malformed existing config) shouldn't abort the
  whole run. Log which dashboard failed and continue.

## Frontend panel

Sidebar panel, same registration pattern as Popup Manager.

### List view

- `ha-data-table`, columns: **Name** (sortable, primary/default sort),
  **Last modified** (sortable)
- Built-in `filter` prop on `ha-data-table` handles search — no custom
  search logic
- Row actions: Edit, Delete (icon buttons)
- "+ New template" button (top right, same placement convention as
  Popup Manager's "+ New popup")
- "Sync now" — secondary action, top right, for manual re-sync

### Edit dialog

- Opens on row click or "+ New template"
- New template: empty **Name** text field + empty `ha-yaml-editor`
- Existing template: name field pre-filled (editable — renaming changes
  the YAML key, old key gets removed on save), `ha-yaml-editor` pre-filled
  with the template's raw YAML (from `button_card_shared_templates/get`)
- Uses `ha-yaml-editor` specifically (the same internal component behind
  HA's own raw config editors) — gives YAML syntax validation and error
  markers for free, no custom parser/linter needed on the frontend
- Save button calls `button_card_shared_templates/save`; a YAML parse error from
  the backend surfaces as an inline error in the dialog instead of closing
  it
- Delete (from the list row, with a confirm prompt) calls
  `button_card_shared_templates/delete`

## File structure

```
custom_components/button_card_shared_templates/
  __init__.py          # setup, WS commands, sync logic
  manifest.json
  const.py             # domain, storage keys, file paths
  www/
    button-card-shared-templates.js   # build artifact (esbuild), same as NativePop
src/
  button-card-shared-templates.js     # real source, lit-html for the data-table
hacs.json
README.md
button-card-templates-spec.md  # this file
```

- Same build convention as NativePop: `src/` is source, `www/` is the
  committed build artifact, CI fails if one changes without the other.

## Known limitations (README-flagged)

- **Sync race on concurrent edit**: if a dashboard is open in a browser's
  edit mode at the exact moment a sync writes to it, and that browser
  session then saves, the session's in-memory (pre-sync) copy of
  `button_card_templates` overwrites the just-synced version. Considered
  low-probability for typical single-admin setups and not engineered
  around in v1 — flagged explicitly in the README rather than solved.
- Storage-mode dashboards only; YAML-mode dashboards are skipped and must
  still use `!include` if you want templates shared into them.
- No per-dashboard opt-out — every storage dashboard receives every
  template.
