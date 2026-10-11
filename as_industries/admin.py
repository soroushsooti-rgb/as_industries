"""AS management views use existing Frappe documents and permissions."""
from datetime import timedelta
import frappe
from frappe.utils import cint, flt, get_datetime, now_datetime

MODULES = {
    "requests": "AS Manufacturing Request",
    "production": "AS Production Order",
    "machines": "AS Machine",
    "materials": "AS Material",
    "quality": "AS Quality Check",
}

def can_admin():
    user = frappe.session.user
    return user != "Guest" and (
        user == "Administrator" or
        (frappe.db.get_value("User", user, "user_type") == "System User" and
         "System Manager" in frappe.get_roles(user))
    )

def require_admin():
    if not can_admin():
        frappe.throw("Administrator access is required.", frappe.PermissionError)
    frappe.local.response["headers"] = {"Cache-Control": "no-store"}

def records_for(section):
    doctype = MODULES[section]
    if not frappe.db.exists("DocType", doctype):
        return {"available": False, "doctype": doctype, "rows": [], "limited": False}
    if not frappe.has_permission(doctype, "read"):
        return {"available": False, "doctype": doctype, "rows": [], "limited": False}
    meta = frappe.get_meta(doctype)
    candidates = ["title", "part_name", "material", "technology", "quantity", "qty",
                  "status", "completed_on", "completed_at", "completed_date"]
    fields = ["name", "creation", "modified"] + [f for f in candidates if meta.has_field(f)]
    rows = frappe.get_list(doctype, fields=fields, order_by="creation desc", limit_page_length=1001)
    limited = len(rows) > 1000
    return {"available": True, "doctype": doctype, "rows": rows[:1000], "limited": limited}

@frappe.whitelist(methods=["GET"])
def dashboard():
    require_admin()
    requests = records_for("requests")
    machines = records_for("machines")
    rows = requests["rows"]
    statuses = {"production": 0, "completed": 0, "hold": 0, "cancelled": 0, "new": 0}
    status_map = {
        "in production": "production", "in progress": "production", "production": "production",
        "completed": "completed", "done": "completed", "on hold": "hold",
        "cancelled": "cancelled", "canceled": "cancelled",
    }
    trend = [{"date": (now_datetime().date() - timedelta(days=6-i)).isoformat(), "quantity": 0} for i in range(7)]
    dates = {r["date"]: r for r in trend}
    durations = []
    for row in rows:
        category = status_map.get(str(row.get("status") or "").strip().lower(), "new")
        statuses[category] += 1
        completed = row.get("completed_on") or row.get("completed_at") or row.get("completed_date")
        if category == "completed" and completed:
            end = get_datetime(completed)
            duration = (end - get_datetime(row.creation)).total_seconds() / 86400
            if duration >= 0:
                durations.append(duration)
            day = end.date().isoformat()
            if day in dates:
                dates[day]["quantity"] += max(0, flt(row.get("quantity") or row.get("qty") or 1))
    machine_status = {"online": 0, "offline": 0, "maintenance": 0, "unknown": 0}
    for row in machines["rows"]:
        value = str(row.get("status") or "").lower()
        machine_status[value if value in machine_status else "unknown"] += 1
    users_filter = {"name": ["!=", "Guest"]}
    total_users = frappe.get_list("User", filters=users_filter, fields=[{"COUNT": "name", "as": "total"}])[0].total
    new_users = frappe.get_list("User", filters={"name": ["not in", ["Guest", "Administrator"]],
                      "creation": [">=", now_datetime() - timedelta(days=7)]},
                      fields=[{"COUNT": "name", "as": "total"}])[0].total
    current = frappe.db.get_value("User", frappe.session.user,
                ["first_name", "last_name", "username", "user_image"], as_dict=True)
    return {"user": current, "request_data": requests, "statuses": statuses,
            "trend": trend, "trend_available": bool(durations),
            "lead_time": round(sum(durations)/len(durations), 1) if durations else None,
            "machine_data": machines, "machine_status": machine_status,
            "users_count": total_users, "new_users_count": new_users,
            "updated_at": now_datetime().isoformat()}

@frappe.whitelist(methods=["GET"])
def collection(section):
    require_admin()
    if section not in MODULES:
        frappe.throw("Unknown management section.")
    return records_for(section)

@frappe.whitelist(methods=["GET"])
def users(query="", start=0):
    require_admin()
    start = max(0, cint(start))
    query = str(query or "").strip()[:140]
    filters = {"name": ["!=", "Guest"]}
    or_filters = [{f: ["like", "%" + query + "%"]} for f in
                  ["name", "username", "first_name", "last_name", "mobile_no", "phone"]] if query else None
    rows = frappe.get_list("User", filters=filters, or_filters=or_filters,
        fields=["name", "first_name", "last_name", "username", "email", "mobile_no",
                "phone", "enabled", "user_type", "creation", "last_login"],
        order_by="creation desc", limit_start=start, limit_page_length=26)
    return {"rows": rows[:25], "has_more": len(rows) > 25, "start": start}
