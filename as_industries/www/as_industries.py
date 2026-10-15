"""Public AS Industries website context."""
import json
import frappe
from as_industries.integration import get_navigation_config

no_cache = 1

def get_context(context):
    """Inject only public URLs; no credentials or business records."""
    context.no_cache = 1
    context.shn_integration = json.dumps(get_navigation_config(), ensure_ascii=False).replace("<", "\u003c")
    context.csrf_token = frappe.sessions.get_csrf_token()
    context.current_user = frappe.session.user
    context.is_guest = frappe.session.user == "Guest"
    return context
