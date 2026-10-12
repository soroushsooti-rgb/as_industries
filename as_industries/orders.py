"""The existing Industries account authorizes customer orders on the Shop server."""
import hashlib
import hmac
import json
import secrets
import time
import requests
import frappe
from frappe.utils import cint
from as_industries import inventory
def customer():
    user=frappe.session.user
    if user=="Guest":return {"id":"Guest"}
    record=frappe.db.get_value("User",user,["enabled","full_name","email","mobile_no","phone"],as_dict=True)
    if not record or not record.enabled:
        frappe.throw("Sign in first.",frappe.AuthenticationError)
    return {"id":user,"name":record.full_name,"email":record.email if not (record.email or "").endswith("@as-account.invalid") else "",
            "mobile":record.mobile_no or record.phone or ""}
def bridge(action,payload=None,guest=False):
    who=customer()
    if who["id"]=="Guest" and not guest:
        frappe.throw("Sign in before viewing or placing orders.",frappe.AuthenticationError)
    key=frappe.conf.get("as_checkout_bridge_secret")
    if not key:frappe.throw("Checkout connection is not configured.")
    envelope=json.dumps({"issuer":frappe.conf.get("as_checkout_issuer","as-industries"),"timestamp":time.time(),
        "nonce":secrets.token_hex(16),"customer":who,"action":action,"payload":payload or {}},ensure_ascii=True,separators=(",",":"))
    signature=hmac.new(key.encode(),envelope.encode(),hashlib.sha256).hexdigest()
    connection,base,_=inventory.client()
    frappe.local.response["headers"]={"Cache-Control":"no-store"}
    return inventory.remote(connection,base,"as_shop.orders.service",{"envelope":envelope,"signature":signature})
@frappe.whitelist(allow_guest=True,methods=["GET"])
def preview(cart_token):
    return bridge("preview",{"cart_token":cart_token},guest=True)
@frappe.whitelist(methods=["POST"])
def payment_start(cart_token,shipping,language="fa"):
    return bridge("start",{"cart_token":cart_token,"shipping":frappe.parse_json(shipping),"language":language})
@frappe.whitelist(methods=["GET"])
def mine(name=None,start=0):
    return bridge("order" if name else "orders",{"name":name,"start":max(0,cint(start))})
@frappe.whitelist(methods=["POST"])
def reconcile(name):
    return bridge("reconcile",{"name":name})
def admin_bridge(action,payload=None,write=False):
    inventory.require_admin()
    allowed={"settings","fulfillment","reconcile"} if write else {"orders","order","settings"}
    if action not in allowed:frappe.throw("Unknown order operation.")
    connection,base,_=inventory.connected_client()
    if write:
        result=inventory.remote(connection,base,"as_shop.orders.admin_write",{"action":action,"payload":payload or {}})
    else:
        suffix="?action="+requests.utils.quote(action,safe="")+"&payload="+requests.utils.quote(json.dumps(payload or {}),safe="")
        result=inventory.remote(connection,base,"as_shop.orders.admin_read"+suffix)
    inventory.update_state(connection)
    return result
@frappe.whitelist(methods=["GET"])
def admin_read(action,payload=None):
    return admin_bridge(action,frappe.parse_json(payload) or {})
@frappe.whitelist(methods=["POST"])
def admin_write(action,payload=None):
    return admin_bridge(action,frappe.parse_json(payload) or {},write=True)
