"""Authenticated support conversations use the existing Industries account."""
import hashlib
import re
import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, now_datetime, get_datetime
from as_industries.admin import require_admin
TICKET = "AS Support Ticket"
MESSAGE = "AS Support Message"
STATUSES = {"Open", "Awaiting Customer", "Closed"}

def user():
    identity = frappe.session.user
    if identity == "Guest" or not frappe.db.get_value("User", identity, "enabled"):
        frappe.throw("Sign in to send or view support tickets.", frappe.AuthenticationError)
    frappe.local.response_headers["Cache-Control"] = "no-store"
    return identity

def text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        frappe.throw("Enter a valid {0} (up to {1} characters).".format(label, limit))
    return value.strip()

def request_key(identity, value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", value):
        frappe.throw("Invalid message request. Refresh the page and try again.")
    return hashlib.sha256((identity + ":" + value).encode()).hexdigest()

def save(doc):
    doc.flags.support_update = True
    return doc.insert(ignore_permissions=True) if doc.is_new() else doc.save(ignore_permissions=True)

def validate_ticket(doc):
    if doc.status not in STATUSES:
        frappe.throw("Choose a valid ticket status.")
    if doc.flags.support_update:
        return
    previous = doc.get_doc_before_save()
    if not previous:
        frappe.throw("Support tickets must be created from the website.")
    require_admin()
    for field in ("customer", "customer_name", "subject", "source", "request_key", "last_message_at", "last_sender"):
        if doc.get(field) != previous.get(field):
            frappe.throw("Ticket identity and messages cannot be edited.")

def validate_message(doc):
    if not doc.flags.support_update:
        frappe.throw("Support messages can only be sent through the conversation.")

def locked(name, administrative=False):
    if administrative:
        require_admin()
    identity = user()
    rows = frappe.db.sql("SELECT name FROM " + chr(96) + "tabAS Support Ticket" + chr(96) + " WHERE name=%s FOR UPDATE", name)
    if not rows:
        frappe.throw("Ticket not found.", frappe.DoesNotExistError)
    doc = frappe.get_doc(TICKET, name)
    if not administrative and doc.customer != identity:
        frappe.throw("Ticket not found.", frappe.PermissionError)
    return doc

def ticket_data(doc, administrative=False):
    fields = ["name", "subject", "status", "creation", "modified", "last_message_at", "last_sender", "source"]
    result = {key: doc.get(key) for key in fields}
    if administrative:
        result.update(customer=doc.customer, customer_name=doc.customer_name)
    return result

def message_data(row):
    return {key: row.get(key) for key in ("name", "body", "sender_type", "sender_name", "creation")}

def conversation(doc, before=None, administrative=False):
    filters = {"ticket": doc.name}
    if before:
        boundary = frappe.db.get_value(MESSAGE, {"name": before, "ticket": doc.name}, ["creation", "name"], as_dict=True)
        if not boundary:
            frappe.throw("Invalid conversation page.")
        # Timestamp plus name gives stable paging even when two messages share a timestamp.
        rows = frappe.db.sql(
            "SELECT name,body,sender_type,sender_name,creation FROM " + chr(96) + "tabAS Support Message" + chr(96) +
            " WHERE ticket=%s AND (creation<%s OR (creation=%s AND name<%s)) ORDER BY creation DESC,name DESC LIMIT 51",
            (doc.name, boundary.creation, boundary.creation, boundary.name), as_dict=True)
    else:
        rows = frappe.get_all(MESSAGE, filters=filters, fields=["name", "body", "sender_type", "sender_name", "creation"],
                              order_by="creation desc, name desc", limit_page_length=51)
    selected = rows[:50]
    return {"ticket": ticket_data(doc, administrative), "messages": [message_data(row) for row in reversed(selected)],
            "has_older": len(rows) > 50, "before": selected[-1].name if selected else None}

def existing_message(key, ticket, body):
    existing = frappe.db.get_value(MESSAGE, {"request_key": key}, ["ticket", "body"], as_dict=True)
    if existing and (existing.ticket != ticket or existing.body != body):
        frappe.throw("This submission was already used for another message.")
    return bool(existing)

def append_message(doc, body, key, staff=False):
    identity = user()
    message = frappe.get_doc({"doctype": MESSAGE, "ticket": doc.name, "sender": identity,
        "sender_name": frappe.db.get_value("User", identity, "full_name") or identity,
        "sender_type": "Staff" if staff else "Customer", "body": body, "request_key": key})
    save(message)
    doc.last_message_at = message.creation or now_datetime()
    doc.last_sender = message.sender_type
    save(doc)

@frappe.whitelist(methods=["POST"])
@rate_limit(limit=15, seconds=600)
def create(subject, body, request_id, source="message"):
    identity = user()
    subject = text(subject, "subject", 200)
    body = text(body, "message", 5000)
    key = request_key(identity, request_id)
    # Serializes duplicate submissions for the same account without changing the user.
    frappe.db.sql("SELECT name FROM " + chr(96) + "tabUser" + chr(96) + " WHERE name=%s FOR UPDATE", identity)
    existing = frappe.db.get_value(TICKET, {"request_key": key}, "name")
    if existing:
        doc = locked(existing)
        if doc.subject != subject or not existing_message(key, doc.name, body):
            frappe.throw("This submission was already used for another ticket.")
        return conversation(doc)
    doc = frappe.get_doc({"doctype": TICKET, "customer": identity,
        "customer_name": frappe.db.get_value("User", identity, "full_name") or identity,
        "subject": subject, "status": "Open", "source": source if source in {"message", "profile"} else "message",
        "request_key": key})
    save(doc)
    append_message(doc, body, key)
    return conversation(doc)

@frappe.whitelist(methods=["GET"])
def mine(name=None, start=0, before=None):
    identity = user()
    if name:
        return conversation(locked(name), before)
    rows = frappe.get_all(TICKET, filters={"customer": identity},
        fields=["name", "subject", "status", "creation", "modified", "last_message_at", "last_sender", "source"],
        order_by="last_message_at desc, name desc", limit_start=max(0, cint(start)), limit_page_length=21)
    return {"tickets": rows[:20], "has_more": len(rows) > 20}

@frappe.whitelist(methods=["POST"])
@rate_limit(limit=60, seconds=600)
def reply(name, body, request_id):
    identity = user()
    body = text(body, "message", 5000)
    key = request_key(identity, request_id)
    doc = locked(name)
    if not existing_message(key, doc.name, body):
        doc.status = "Open"
        append_message(doc, body, key)
    return conversation(doc)

@frappe.whitelist(methods=["GET"])
def admin_list(query="", status="", start=0):
    require_admin()
    user()
    filters = {}
    if status:
        if status not in STATUSES:
            frappe.throw("Choose a valid ticket status.")
        filters["status"] = status
    query = str(query or "").strip()[:140]
    or_filters = [{"name": ["like", "%" + query + "%"]}, {"subject": ["like", "%" + query + "%"]},
                  {"customer": ["like", "%" + query + "%"]}, {"customer_name": ["like", "%" + query + "%"]}] if query else None
    rows = frappe.get_all(TICKET, filters=filters, or_filters=or_filters,
        fields=["name", "subject", "customer", "customer_name", "status", "creation", "modified", "last_message_at", "last_sender"],
        order_by="last_message_at desc, name desc", limit_start=max(0, cint(start)), limit_page_length=26)
    return {"tickets": rows[:25], "has_more": len(rows) > 25}

@frappe.whitelist(methods=["GET"])
def admin_detail(name, before=None):
    return conversation(locked(name, True), before, True)

@frappe.whitelist(methods=["POST"])
@rate_limit(limit=120, seconds=600)
def admin_reply(name, body, request_id, status="Awaiting Customer"):
    require_admin()
    identity = user()
    body = text(body, "message", 5000)
    if status not in STATUSES:
        frappe.throw("Choose a valid ticket status.")
    key = request_key(identity, request_id)
    doc = locked(name, True)
    if not existing_message(key, doc.name, body):
        doc.status = status
        append_message(doc, body, key, True)
    return conversation(doc, administrative=True)

@frappe.whitelist(methods=["POST"])
def admin_status(name, status, modified):
    doc = locked(name, True)
    if status not in STATUSES:
        frappe.throw("Choose a valid ticket status.")
    if get_datetime(doc.modified) != get_datetime(modified):
        frappe.throw("Ticket changed. Refresh it before saving.", frappe.TimestampMismatchError)
    doc.status = status
    save(doc)
    return conversation(doc, administrative=True)
