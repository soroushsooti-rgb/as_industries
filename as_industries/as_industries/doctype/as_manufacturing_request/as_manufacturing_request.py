import frappe
from frappe.model.document import Document
from frappe.utils import validate_email_address

class ASManufacturingRequest(Document):
    pass

@frappe.whitelist(methods=["POST"])
def submit_repair_request(**kwargs):
    frappe.log_error(title="REPAIR_SUBMIT_PAYLOAD", message=frappe.as_json(kwargs))
    machine = (kwargs.get("machine") or "").strip()
    manufacturer = (kwargs.get("manufacturer") or "").strip()
    description = (kwargs.get("description") or "").strip()
    location = (kwargs.get("location") or "").strip()
    name = (kwargs.get("name") or "").strip()
    email = (kwargs.get("email") or "").strip()
    model = (kwargs.get("model") or "").strip()
    urgency = (kwargs.get("urgency") or "").strip()
    deadline = (kwargs.get("deadline") or "").strip()

    if not machine:
        frappe.throw(frappe._("Machine / Equipment name is required."))
    if not manufacturer:
        frappe.throw(frappe._("Manufacturer is required."))
    if not description:
        frappe.throw(frappe._("Description is required."))
    if not location:
        frappe.throw(frappe._("Location is required."))

    # The current repair form does not ask separately for customer name/email.
    # Use the logged-in user's data when available and a valid fallback for guests.
    current_user = frappe.session.user or "Guest"

    if current_user != "Guest":
        user_values = frappe.db.get_value(
            "User",
            current_user,
            ["full_name", "email"],
        ) or ("", "")

        user_full_name, user_email = user_values
        name = name or user_full_name or current_user
        email = email or user_email

    name = name or "Guest Customer"
    email = email or "repair-guest@as-industries.localhost"

    validate_email_address(email, throw=True)

    title_parts = [machine]
    if model:
        title_parts.append(model)
    title = " - ".join(title_parts)

    doc = frappe.get_doc({
        "doctype": "AS Manufacturing Request",
        "title": title[:140],
        "technology": "Repair",
        "part_name": machine[:140],
        "material": manufacturer[:140],
        "quantity": 1,
        "status": "new",
        "customer_name": name[:140],
        "email": email[:140],
        "description": description,
        "location": location[:140],
        "urgency": urgency[:140],
        "deadline": deadline[:140]
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "success": True,
        "name": doc.name,
        "message": frappe._("Repair request submitted successfully.")
    }
