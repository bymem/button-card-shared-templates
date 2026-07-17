# button-card-shared-templates

A single source of truth for [`button-card`](https://github.com/custom-cards/button-card)
templates, plus a native-feeling sidebar panel to manage them.

`button-card` resolves `template:` references from the `button_card_templates`
key of whatever dashboard is currently loaded. That key is scoped per
dashboard, so storage-mode dashboards have no native way to share it —
templates get copy-pasted into every dashboard's raw config editor and drift
out of sync. This integration keeps templates in one YAML file and pushes the
merged result into every dashboard's stored config whenever a template is
added, edited, or deleted.

## Requirements

[`button-card`](https://github.com/custom-cards/button-card) itself must
already be installed (e.g. via HACS) and added as a dashboard resource.
This integration only manages the shared `button_card_templates:` config —
it doesn't install or replace the `button-card` custom card.

## Installation

### HACS (custom repository)

1. HACS → Integrations → menu (⋮) → **Custom repositories**.
2. Add this repository URL, category **Integration**.
3. Install **Button Card Shared Templates**, then restart Home Assistant.

### Manual

1. Copy `custom_components/button_card_shared_templates` into your Home
   Assistant `config/custom_components/` directory.
2. Restart Home Assistant.

## Setup

Settings → Devices & services → **+ Add integration** → search for
**Button Card Shared Templates** → **Submit**. Nothing to configure — no
YAML editing, no restart. A **Button Card Templates** entry appears in the
sidebar (admin users only), and an empty `button_card_templates.yaml` is
created in your config directory if one doesn't already exist.

## Usage

Open the **Button Card Templates** panel from the sidebar. **+ New template**
(bottom right) or clicking an existing row opens the editor dialog, which has
two separate fields:

- **Name** — becomes the template's top-level key in
  `button_card_templates.yaml`.
- The **YAML editor** below it — holds only that key's *value*, i.e. the
  `button-card` template config itself (`color_type`, `styles`,
  `custom_fields`, etc.), indented one level in. Don't repeat the name inside
  the editor, and don't wrap it in an extra `name:` line — the panel adds that
  key for you from the Name field.

For example, entering **Name**: `my_template_name` with this in the YAML
editor:

```yaml
color_type: label-card
styles:
  card:
    - padding: 4px
```

produces exactly this entry in `button_card_templates.yaml`:

```yaml
my_template_name:
  color_type: label-card
  styles:
    card:
      - padding: 4px
```

Renaming an existing template's **Name** and saving moves its config to the
new key — the old key is removed, not duplicated.

### Importing an old-style pasted template

If you've got a template in the old per-dashboard copy/paste shape — a
top-level name with the config nested (and possibly indented) under it, e.g.:

```yaml
base:
    state:
      - value: unavailable
        icon: mdi:alert-circle-outline
    styles:
      card:
        - padding: 12px
```

you don't need to manually split the name out or fix the indentation. Paste
the whole block into the YAML editor as-is; a **Use "base" as name** button
appears whenever the editor's content has exactly one top-level key. Clicking
it moves that key into the Name field and replaces the editor's content with
just its value, re-indented to a clean 2-space style.

- Saving writes the template to `button_card_templates.yaml`, then pushes the
  full merged templates dict into every storage-mode dashboard's
  `button_card_templates` key.
- A YAML syntax error in the editor is caught on save and shown inline in the
  dialog rather than closing it — fix it and save again.
- **Delete** removes a template and re-syncs, so the removal propagates too.
- **Sync now** re-runs the push manually — useful after hand-editing the YAML
  file directly, or after creating a new dashboard.

The templates file itself is human-editable directly and safe to version
control — this is the same shape the dialog's Name + YAML editor combine
into, just all the templates at once:

```yaml
my_template_name:
  color_type: label-card
  styles:
    card:
      - padding: 4px
another_template:
  # ...arbitrary button-card template config
```

A manual edit to the file won't update the panel's "last modified" column
until the next panel save touches that key — sync it via **Sync now** if you
want the dashboards updated immediately.

## Known limitations

- **Sync race on concurrent edit**: if a dashboard is open in a browser's
  edit mode at the exact moment a sync writes to it, and that browser
  session then saves, the session's in-memory (pre-sync) copy of
  `button_card_templates` overwrites the just-synced version. Considered
  low-probability for typical single-admin setups and not engineered around
  in v1.
- Storage-mode dashboards only; YAML-mode dashboards (`mode: yaml`) are
  skipped and must still use `!include` if you want templates shared into
  them.
- No per-dashboard opt-out — every storage dashboard receives every
  template.

## Development

Frontend source lives in `src/`; the committed build artifact lives in
`custom_components/button_card_shared_templates/www/`. CI fails if one
changes without the other.

```bash
npm install
npm run build
```
