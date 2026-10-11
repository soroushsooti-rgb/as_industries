"""A real Shop session connects the central panel to independent Shop permissions."""
import hashlib
import json
from urllib.parse import urlsplit
import requests
import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils import strip_html
from as_industries.admin import require_admin
from as_industries.integration import get_navigation_config

TTL = 1800
READ_ACTIONS = {"catalog","product","stock","history","participants","print"}
WRITE_ACTIONS = {"product_save","product_delete","product_duplicate","stock_save","stock_submit",
    "stock_cancel","stock_delete","stock_amend","stock_set","image_upload","comment","share",
    "unshare","assign","unassign","import"}

def cache_key():
    return "as-inventory:" + hashlib.sha256((frappe.session.user+":"+frappe.session.sid).encode()).hexdigest()

def client(state=None):
    target = urlsplit(get_navigation_config()["app_urls"]["shop"])
    if not target.hostname:
        frappe.throw("Configure the full Shop website URL before connecting.")
    connection = requests.Session()
    connection.trust_env = False
    if target.hostname == "localhost" or target.hostname.endswith(".localhost"):
        base = target.scheme+"://127.0.0.1:"+str(target.port or (443 if target.scheme=="https" else 80))
        connection.headers["Host"] = target.netloc
    else:
        base = target.scheme+"://"+target.netloc
    if state:
        if state.get("target") != target.netloc:
            frappe.cache.delete_value(cache_key())
            frappe.throw("The Shop connection changed. Sign in again.")
        connection.cookies.update(state.get("cookies") or {})
    return connection, base, target.netloc

def remote(connection, base, method, values=None):
    try:
        if values is None:
            response = connection.get(base+"/api/method/"+method, timeout=30, allow_redirects=False)
        else:
            token = connection.get(base+"/api/method/as_shop.management.session", timeout=15, allow_redirects=False)
            token.raise_for_status()
            csrf = token.json()["message"]["csrf_token"]
            response = connection.post(base+"/api/method/"+method, json=values,
                headers={"X-Frappe-CSRF-Token":csrf}, timeout=60, allow_redirects=False)
        body = response.json()
    except (requests.RequestException,ValueError,KeyError):
        frappe.throw("The Shop could not be reached. Refresh the inventory before retrying.")
    if response.status_code in (401,403) and body.get("exc_type") in ("AuthenticationError","SessionStopped"):
        frappe.cache.delete_value(cache_key())
        frappe.throw("Incorrect username, password or verification code." if method=="as_shop.management.login" else "The Shop session expired. Connect again.",frappe.AuthenticationError)
    if not response.ok or body.get("exc"):
        message = "The Shop operation could not be completed."
        try:
            rows = json.loads(body.get("_server_messages") or "[]")
            if rows:
                message = json.loads(rows[-1])["message"]
        except (ValueError,KeyError,TypeError):
            pass
        frappe.throw(strip_html(message))
    return body.get("message")

def save_state(connection,target,context):
    frappe.cache.set_value(cache_key(), {"target":target,"cookies":connection.cookies.get_dict(),
        "pending":bool(context.get("tmp_id") and not context.get("user")),
        "tmp_id":context.get("tmp_id")}, expires_in_sec=TTL)

@frappe.whitelist(methods=["POST"])
@rate_limit(limit=20,seconds=600)
def connect(usr="",pwd="",otp=None):
    require_admin()
    frappe.form_dict.pop("pwd",None)
    previous = frappe.cache.get_value(cache_key())
    connection,base,target = client(previous if otp else None)
    values = {"usr":usr,"pwd":pwd}
    if otp and previous and previous.get("pending"):
        values.update({"otp":otp,"tmp_id":previous.get("tmp_id")})
    context = remote(connection,base,"as_shop.management.login",values)
    if context.get("tmp_id") and not context.get("user"):
        save_state(connection,target,context)
        return {"connected":False,"needs_otp":True,"verification":context.get("verification")}
    if not context.get("user"):
        frappe.throw("Use a Shop account with inventory management permission.",frappe.PermissionError)
    save_state(connection,target,context)
    return {"connected":True,"user":context["user"],"permissions":context["permissions"]}

@frappe.whitelist(methods=["GET"])
def status():
    require_admin()
    state = frappe.cache.get_value(cache_key())
    if not state or state.get("pending"):
        return {"connected":False,"needs_otp":bool(state and state.get("pending"))}
    connection,base,target = client(state)
    context = remote(connection,base,"as_shop.management.session")
    if not context.get("user"):
        frappe.cache.delete_value(cache_key())
        return {"connected":False}
    save_state(connection,target,context)
    return {"connected":True,"user":context["user"],"permissions":context["permissions"]}

def connected_client():
    state = frappe.cache.get_value(cache_key())
    if not state or state.get("pending"):
        frappe.throw("Connect the Shop management account first.",frappe.AuthenticationError)
    return client(state)

def update_state(connection):
    state = frappe.cache.get_value(cache_key())
    if state:
        state["cookies"] = connection.cookies.get_dict()
        frappe.cache.set_value(cache_key(),state,expires_in_sec=TTL)

@frappe.whitelist(methods=["GET"])
def read(action,payload=None):
    require_admin()
    if action not in READ_ACTIONS:
        frappe.throw("Unknown inventory operation.")
    connection,base,_ = connected_client()
    method = "as_shop.management.read?action="+requests.utils.quote(action,safe="")+"&payload="+requests.utils.quote(json.dumps(frappe.parse_json(payload) or {}),safe="")
    result = remote(connection,base,method)
    update_state(connection)
    return result

@frappe.whitelist(methods=["POST"])
def write(action,payload=None):
    require_admin()
    if action not in WRITE_ACTIONS:
        frappe.throw("Unknown inventory operation.")
    connection,base,_ = connected_client()
    result = remote(connection,base,"as_shop.management.write",{"action":action,"payload":frappe.parse_json(payload) or {}})
    update_state(connection)
    return result

@frappe.whitelist(methods=["POST"])
def disconnect():
    require_admin()
    state = frappe.cache.get_value(cache_key())
    try:
        if state and not state.get("pending"):
            connection,base,_ = client(state)
            remote(connection,base,"logout",{})
    finally:
        frappe.cache.delete_value(cache_key())
    return {"connected":False}
