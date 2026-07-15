"""Config flow for Button Card Shared Templates.

Single-instance, field-free: Settings > Devices & services > Add
integration > search > Submit. No options to fill in.
"""
from __future__ import annotations

from homeassistant import config_entries

from .const import DOMAIN


class ButtonCardSharedTemplatesConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the (field-free) config flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None):
        """Confirm setup - no fields, single instance only."""
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")

        if user_input is not None:
            return self.async_create_entry(title="Button Card Shared Templates", data={})

        return self.async_show_form(step_id="user")
