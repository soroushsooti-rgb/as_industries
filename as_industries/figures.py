"""Shared AS account access to Shop figure requests."""
import base64
import frappe
from frappe.rate_limiter import rate_limit
from as_industries.orders import bridge
from as_industries.admin import require_admin

@frappe.whitelist(methods=["POST"])
@rate_limit(limit=20, seconds=3600)
def submit(**kwargs):
    uploaded = frappe.request.files.get("reference_image")
    content = uploaded.read(5 * 1024 * 1024 + 1) if uploaded else None
    if content and len(content) > 5 * 1024 * 1024:
        frappe.throw("The reference image must be 5 MB or smaller.")
    return bridge("figure_submit", {"fields": kwargs, "filename": uploaded.filename if uploaded else None,
                  "image": base64.b64encode(content).decode() if content else None})

@frappe.whitelist(methods=["GET"])
def mine(start=0):
    return bridge("figure_mine", {"start": start})

@frappe.whitelist(methods=["GET"])
def admin(start=0):
    require_admin()
    return bridge("figure_admin", {"start": start})

@frappe.whitelist(methods=["GET"])
def image(name, admin_view=0):
    if str(admin_view) == "1":
        require_admin()
    return bridge("figure_admin_image" if str(admin_view) == "1" else "figure_image", {"name": name})
