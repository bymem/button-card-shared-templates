"""Button Card Shared Templates.

Gives `button-card` templates a single source of truth (one YAML file) and
a sidebar panel to manage them, then pushes the merged result into every
storage-mode dashboard's stored config whenever a template changes.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import voluptuous as vol
import yaml

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.dashboard import LovelaceStorage
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    PANEL_ICON,
    PANEL_NAME,
    PANEL_TITLE,
    PANEL_URL,
    STATIC_JS_FILENAME,
    STATIC_URL_BASE,
    STORAGE_KEY,
    STORAGE_VERSION,
    TEMPLATES_FILENAME,
    WS_TYPE_DELETE,
    WS_TYPE_GET,
    WS_TYPE_LIST,
    WS_TYPE_SAVE,
    WS_TYPE_SYNC,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the Button Card Shared Templates integration."""
    hass.data[DOMAIN] = {"lock": asyncio.Lock()}

    await _async_ensure_templates_file(hass)

    www_path = Path(__file__).parent / "www"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL_BASE, str(www_path), False)]
    )

    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL,
        config={
            "_panel_custom": {
                "name": PANEL_NAME,
                "embed_iframe": False,
                "trust_external": False,
                "js_url": f"{STATIC_URL_BASE}/{STATIC_JS_FILENAME}",
            }
        },
        require_admin=True,
    )

    websocket_api.async_register_command(hass, handle_list)
    websocket_api.async_register_command(hass, handle_get)
    websocket_api.async_register_command(hass, handle_save)
    websocket_api.async_register_command(hass, handle_delete)
    websocket_api.async_register_command(hass, handle_sync)

    return True


# ---------------------------------------------------------------------------
# Templates file (config/button_card_templates.yaml) — the single source of
# truth. Human-editable directly; the panel is a convenience layer on top.
# ---------------------------------------------------------------------------


def _templates_path(hass: HomeAssistant) -> Path:
    return Path(hass.config.path(TEMPLATES_FILENAME))


def _read_templates_file(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file)
    return data or {}


def _write_templates_file(path: Path, templates: dict) -> None:
    with path.open("w", encoding="utf-8") as file:
        yaml.safe_dump(templates, file, default_flow_style=False, sort_keys=True)


async def _async_ensure_templates_file(hass: HomeAssistant) -> None:
    path = _templates_path(hass)

    def _ensure() -> None:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8") as file:
                yaml.safe_dump({}, file)

    await hass.async_add_executor_job(_ensure)


async def _async_load_templates(hass: HomeAssistant) -> dict:
    return await hass.async_add_executor_job(_read_templates_file, _templates_path(hass))


async def _async_save_templates(hass: HomeAssistant, templates: dict) -> None:
    await hass.async_add_executor_job(_write_templates_file, _templates_path(hass), templates)


# ---------------------------------------------------------------------------
# Metadata sidecar (.storage/button_card_shared_templates_meta) — tracks
# last_modified per template. Kept out of the YAML file so hand-editing it
# doesn't pick up noise. Only the integration's own save path updates it.
# ---------------------------------------------------------------------------


def _meta_store(hass: HomeAssistant) -> Store:
    return Store(hass, STORAGE_VERSION, STORAGE_KEY)


async def _async_load_meta(hass: HomeAssistant) -> dict:
    data = await _meta_store(hass).async_load()
    return data or {}


async def _async_save_meta(hass: HomeAssistant, meta: dict) -> None:
    await _meta_store(hass).async_save(meta)


# ---------------------------------------------------------------------------
# Sync — push the merged templates dict into every storage-mode dashboard.
# ---------------------------------------------------------------------------


async def async_sync_dashboards(hass: HomeAssistant) -> None:
    """Push the current merged templates dict into every storage dashboard."""
    templates = await _async_load_templates(hass)

    lovelace_data = hass.data.get("lovelace")
    if not lovelace_data:
        _LOGGER.debug("Lovelace is not set up yet, skipping sync")
        return

    dashboards = lovelace_data.get("dashboards", {})
    for url_path, dashboard in dashboards.items():
        if not isinstance(dashboard, LovelaceStorage):
            _LOGGER.debug(
                "Skipping YAML-mode dashboard '%s' (not sync-able)", url_path
            )
            continue

        try:
            dashboard_config = await dashboard.async_load(force=True)
            dashboard_config["button_card_templates"] = templates
            await dashboard.async_save(dashboard_config)
        except Exception:  # noqa: BLE001 - one bad dashboard shouldn't abort the rest
            _LOGGER.exception(
                "Failed to sync button_card_templates to dashboard '%s'", url_path
            )


# ---------------------------------------------------------------------------
# WebSocket commands
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): WS_TYPE_LIST})
@websocket_api.async_response
async def handle_list(hass: HomeAssistant, connection, msg) -> None:
    """List all templates with their last-modified timestamp."""
    templates = await _async_load_templates(hass)
    meta = await _async_load_meta(hass)

    result = [
        {"name": name, "last_modified": meta.get(name)}
        for name in sorted(templates)
    ]
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_GET,
        vol.Required("name"): str,
    }
)
@websocket_api.async_response
async def handle_get(hass: HomeAssistant, connection, msg) -> None:
    """Return a single template's raw YAML for the editor dialog."""
    name = msg["name"]
    templates = await _async_load_templates(hass)

    if name not in templates:
        connection.send_error(
            msg["id"], websocket_api.const.ERR_NOT_FOUND, f"Template '{name}' not found"
        )
        return

    yaml_text = await hass.async_add_executor_job(
        lambda: yaml.safe_dump(templates[name], sort_keys=False)
    )
    connection.send_result(msg["id"], {"name": name, "yaml": yaml_text})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_SAVE,
        vol.Required("name"): str,
        vol.Required("yaml"): str,
        vol.Optional("old_name"): str,
    }
)
@websocket_api.async_response
async def handle_save(hass: HomeAssistant, connection, msg) -> None:
    """Save (create/update/rename) a template, then run sync."""
    name = msg["name"]
    old_name = msg.get("old_name")

    try:
        parsed = await hass.async_add_executor_job(yaml.safe_load, msg["yaml"])
    except yaml.YAMLError as err:
        connection.send_error(msg["id"], websocket_api.const.ERR_INVALID_FORMAT, str(err))
        return

    if not isinstance(parsed, dict):
        connection.send_error(
            msg["id"],
            websocket_api.const.ERR_INVALID_FORMAT,
            "Template must be a YAML mapping",
        )
        return

    lock: asyncio.Lock = hass.data[DOMAIN]["lock"]
    async with lock:
        templates = await _async_load_templates(hass)
        if old_name and old_name != name:
            templates.pop(old_name, None)
        templates[name] = parsed
        await _async_save_templates(hass, templates)

        meta = await _async_load_meta(hass)
        if old_name and old_name != name:
            meta.pop(old_name, None)
        meta[name] = dt_util.utcnow().isoformat()
        await _async_save_meta(hass, meta)

    await async_sync_dashboards(hass)
    connection.send_result(msg["id"], {"name": name})


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DELETE,
        vol.Required("name"): str,
    }
)
@websocket_api.async_response
async def handle_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a template, then run sync so the removal propagates too."""
    name = msg["name"]

    lock: asyncio.Lock = hass.data[DOMAIN]["lock"]
    async with lock:
        templates = await _async_load_templates(hass)
        templates.pop(name, None)
        await _async_save_templates(hass, templates)

        meta = await _async_load_meta(hass)
        meta.pop(name, None)
        await _async_save_meta(hass, meta)

    await async_sync_dashboards(hass)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): WS_TYPE_SYNC})
@websocket_api.async_response
async def handle_sync(hass: HomeAssistant, connection, msg) -> None:
    """Manual 'Sync now' trigger — no save/delete attached."""
    await async_sync_dashboards(hass)
    connection.send_result(msg["id"])
