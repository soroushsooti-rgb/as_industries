"""Account-owned Quick Contact requests stored in the existing manufacturing DocType."""
from io import BytesIO
import re
import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, validate_email_address
from frappe.utils.file_manager import save_file
from PIL import Image, UnidentifiedImageError
from as_industries.admin import require_admin
from as_industries.tickets import user

DOCTYPE = "AS Manufacturing Request"
TAG = "Quick Contact"
MAX_IMAGE = 10 * 1024 * 1024


def validate_photo(content):
    if len(content) > MAX_IMAGE:
        frappe.throw(_("The photo must be 10 MB or smaller."))
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError()
            image.verify()
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        frappe.throw(_("Choose a JPG, PNG or WebP image."))


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=20, seconds=3600)
def submit(message, phone, messenger, messenger_active=None, email=""):
    identity = user()
    message = str(message or "").strip()
    phone = re.sub(r"[\s()-]", "", str(phone or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")))
    email = str(email or "").strip()
    if not message or len(message) > 5000:
        frappe.throw(_("Write a request of up to 5,000 characters."))
    if not re.fullmatch(r"\+?\d{7,15}", phone):
        frappe.throw(_("Enter a valid phone number."))
    if messenger not in {"whatsapp", "bale"} or str(messenger_active).lower() not in {"1", "true", "on"}:
        frappe.throw(_("Choose an active messenger for this number."))
    if email:
        validate_email_address(email, throw=True)
        if len(email) > 140:
            frappe.throw(_("Email address is too long."))
    uploaded = frappe.request.files.get("photo") if getattr(frappe, "request", None) else None
    content = uploaded.read(MAX_IMAGE + 1) if uploaded else None
    if uploaded:
        if not content:
            frappe.throw(_("Choose a valid photo."))
        validate_photo(content)
    doc = frappe.get_doc({
        "doctype": DOCTYPE, "title": message.splitlines()[0][:140],
        "technology": TAG, "quantity": 1, "status": "new",
        "customer_name": frappe.db.get_value("User", identity, "full_name") or identity,
        "email": email, "phone": phone, "messenger": messenger, "description": message,
    }).insert(ignore_permissions=True)
    if content:
        photo = save_file(uploaded.filename, content, DOCTYPE, doc.name, df="reference_image", is_private=1)
        doc.db_set("reference_image", photo.file_url, update_modified=False)
    return {"ok": True, "name": doc.name}


def listing(start=0, administrative=False):
    identity = user()
    if administrative:
        require_admin()
    filters = {"technology": TAG}
    if not administrative:
        filters["owner"] = identity
    rows = frappe.get_all(DOCTYPE, filters=filters,
        fields=["name", "technology", "title", "status", "description", "reference_image", "creation"] +
               (["customer_name", "phone", "email", "messenger"] if administrative else []),
        order_by="creation desc, name desc", limit_start=max(0, cint(start)), limit_page_length=21)
    return {"requests": rows[:20], "has_more": len(rows) > 20}


@frappe.whitelist(methods=["GET"])
def mine(start=0):
    return listing(start)


@frappe.whitelist(methods=["GET"])
def admin(start=0):
    return listing(start, administrative=True)


@frappe.whitelist(methods=["GET"])
def image(name, admin_view=0):
    identity = user()
    administrative = str(admin_view) == "1"
    if administrative:
        require_admin()
    filters = {"name": name, "technology": TAG}
    if not administrative:
        filters["owner"] = identity
    reference = frappe.db.get_value(DOCTYPE, filters, "reference_image")
    if not reference:
        frappe.throw(_("Photo not found."), frappe.PermissionError)
    photo = frappe.get_doc("File", {"file_url": reference, "attached_to_doctype": DOCTYPE, "attached_to_name": name})
    import base64
    import mimetypes
    return {"image": "data:" + (mimetypes.guess_type(photo.file_name)[0] or "image/png") +
            ";base64," + base64.b64encode(photo.get_content()).decode()}
