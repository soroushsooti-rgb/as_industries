"""Public shell; all management records require a System Manager session."""
import json
from urllib.parse import urlsplit, urlunsplit
import frappe
from as_industries.admin import can_admin
from as_industries.integration import get_navigation_config

no_cache = 1

def get_context(context):
    context.no_cache = 1
    navigation = get_navigation_config()
    language = "fa" if frappe.form_dict.get("lang", "fa") == "fa" else "en"
    target = urlsplit(navigation["app_urls"]["as"])
    if target.netloc and target.netloc != frappe.request.host:
        frappe.local.flags.redirect_location = urlunsplit(
            (target.scheme, target.netloc, "/as-admin", "lang=" + language, ""))
        raise frappe.Redirect
    context.admin_language = language
    context.admin_direction = "rtl" if language == "fa" else "ltr"
    context.admin_config = json.dumps({"authorized": bool(can_admin()),
        "logged_in": frappe.session.user != "Guest",
        "urls": navigation["app_urls"], "language": language},
        ensure_ascii=False).replace("<", "\\u003c")
    return context
