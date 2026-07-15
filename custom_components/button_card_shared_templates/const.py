"""Constants for the Button Card Shared Templates integration."""

DOMAIN = "button_card_shared_templates"

# Templates file lives in the config root, human-editable/git-trackable.
TEMPLATES_FILENAME = "button_card_templates.yaml"

# Metadata sidecar (last_modified per template), kept out of the YAML file
# so it stays hand-editable/diffable.
STORAGE_VERSION = 1
STORAGE_KEY = "button_card_shared_templates_meta"

# Sidebar panel registration.
PANEL_URL = "button-card-shared-templates"
PANEL_TITLE = "Button Card Templates"
PANEL_ICON = "mdi:view-grid-plus"
PANEL_NAME = "button-card-shared-templates-panel"

# Static path the panel's JS module is served from.
STATIC_URL_BASE = "/button_card_shared_templates_static"
STATIC_JS_FILENAME = "button-card-shared-templates.js"

# WebSocket command types.
WS_TYPE_LIST = "button_card_shared_templates/list"
WS_TYPE_GET = "button_card_shared_templates/get"
WS_TYPE_SAVE = "button_card_shared_templates/save"
WS_TYPE_DELETE = "button_card_shared_templates/delete"
WS_TYPE_SYNC = "button_card_shared_templates/sync"
