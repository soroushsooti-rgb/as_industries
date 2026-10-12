"""Shared AS account on the existing Industries site, using Frappe User and sessions."""
import hashlib
import json
import re
import secrets
from urllib.parse import parse_qs, urlsplit

import frappe
from frappe.rate_limiter import rate_limit
from frappe.sessions import get_csrf_token
from frappe.website.utils import is_signup_disabled

ACCOUNT_ROUTE = "/as-industries#/profile"
OTP_TTL = 300
# Re-enable this flag when the SMS registration service is ready.
SIGNUP_REQUIRES_OTP = False


def _mobile_digits(value):
    digits = str(value or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    digits = re.sub(r"[\s()+-]", "", digits)
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("98"):
        digits = "0" + digits[2:]
    return digits


def normalize_mobile(value):
    digits = _mobile_digits(value)
    if not re.fullmatch(r"09\d{9}", digits):
        frappe.throw("Enter a valid Iranian mobile number.")
    return digits


def _phone_records(mobile):
    # Normalize legacy Desk values too (country code, spaces and Persian digits).
    users = frappe.get_all("User", or_filters=[{"mobile_no": ["is", "set"]}, {"phone": ["is", "set"]}],
                           fields=["name", "enabled", "user_type", "mobile_no", "phone"])
    return [u for u in users if mobile in {_mobile_digits(u.mobile_no), _mobile_digits(u.phone)}][:2]


def _phone_user(mobile):
    users = _phone_records(mobile)
    if len(users) == 1 and users[0].enabled and users[0].user_type == "Website User":
        return users[0].name
    return None


def _sms_configured():
    return bool(frappe.db.get_single_value("SMS Settings", "sms_gateway_url"))


def _google_provider():
    return frappe.db.get_value("Social Login Key",
                               {"provider_name": "Google", "enable_social_login": 1}, "name")


@frappe.whitelist(allow_guest=True, methods=["GET"])
def session():
    user = None
    if frappe.session.user != "Guest":
        user = frappe.db.get_value("User", frappe.session.user,
                                  ["name", "first_name", "last_name", "email", "username", "mobile_no", "phone", "user_image", "last_login", "creation"],
                                  as_dict=True)
    frappe.local.response["headers"] = {"Cache-Control": "no-store"}
    return {"user": user, "csrf_token": get_csrf_token(), "sms_ready": _sms_configured(),
            "google_ready": bool(_google_provider()), "signup_enabled": not is_signup_disabled(),
            "signup_requires_otp": SIGNUP_REQUIRES_OTP,
            "can_admin": frappe.session.user != "Guest" and (frappe.session.user == "Administrator" or
                (frappe.db.get_value("User", frappe.session.user, "user_type") == "System User" and
                 "System Manager" in frappe.get_roles(frappe.session.user)))}


def _throttle(mobile):
    cache = frappe.cache
    key = cache.make_key("as-account:send-hour:" + mobile)
    count = cache.incr(key)
    if count == 1:
        cache.expire(key, 3600)
    if count > 5:
        frappe.throw("Too many code requests. Try again later.", frappe.RateLimitExceededError)
    if not cache.set(cache.make_key("as-account:cooldown:" + mobile), "1", nx=True, ex=60):
        frappe.throw("Wait 60 seconds before requesting another code.", frappe.RateLimitExceededError)


def _send_code(mobile, code):
    # sms.ir Verify API uses a template and named code parameter.
    settings = frappe.get_doc("SMS Settings")
    if urlsplit(settings.sms_gateway_url).hostname == "api.sms.ir":
        import requests
        from frappe.core.doctype.sms_settings.sms_settings import get_headers
        headers = get_headers(settings)
        header_key = next((v for k, v in headers.items() if k.lower() == "x-api-key"), None)
        template_id = next((d.value for d in settings.parameters
                            if not d.header and d.parameter.lower() == "templateid"), None)
        try:
            template_id = int(template_id)
            if template_id <= 0 or not header_key or not settings.message_parameter:
                raise ValueError()
        except (TypeError, ValueError):
            frappe.throw("Configure sms.ir API key, templateId and code parameter in SMS Settings.")
        try:
            response = requests.post(
                "https://api.sms.ir/v1/send/verify",
                headers={"x-api-key": header_key, "Content-Type": "application/json"},
                json={"mobile": mobile, "templateId": template_id,
                      "parameters": [{"name": settings.message_parameter, "value": code}]},
                timeout=15, allow_redirects=False,
            )
            if not response.ok or response.json().get("status") != 1:
                raise ValueError()
        except (requests.RequestException, ValueError):
            frappe.throw("The SMS service could not send the code. Try again later.")
        return
    # Other gateways continue using the existing Frappe SMS Settings.
    from frappe.core.doctype.sms_settings.sms_settings import get_headers, send_request
    settings = frappe.get_doc("SMS Settings")
    headers = get_headers(settings)
    params = {d.parameter: d.value for d in settings.parameters if not d.header}
    params[settings.message_parameter] = "AS verification code: " + code + ". Expires in 5 minutes."
    params[settings.receiver_parameter] = mobile
    status = send_request(settings.sms_gateway_url, params, headers, settings.use_post,
                          headers.get("Content-Type") == "application/json")
    if not 200 <= status < 300:
        frappe.throw("The SMS service could not send the code. Try again later.")


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=3600)
def request_code(mobile, purpose="login"):
    if purpose not in {"login", "signup", "reset", "link"}:
        frappe.throw("Invalid verification purpose.")
    mobile = normalize_mobile(mobile)
    if not _sms_configured():
        frappe.throw("SMS sign-in is not configured yet.")
    if purpose == "signup" and is_signup_disabled():
        frappe.throw("Account registration is disabled.")
    _throttle(mobile)
    if purpose == "link":
        current = frappe.get_doc("User", frappe.session.user)
        if current.name == "Guest" or current.user_type != "Website User" or current.mobile_no:
            frappe.throw("A mobile number can only be added to your signed-in account.", frappe.PermissionError)
    user = frappe.session.user if purpose == "link" else _phone_user(mobile)
    challenge = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1000000):06d}"
    record = {"mobile": mobile, "purpose": purpose, "user": user,
              "hash": hashlib.sha256((challenge + ":" + code).encode()).hexdigest(), "attempts": 0}
    # Existing/disabled/ambiguous numbers receive the same response.
    eligible = (purpose == "signup" and not _phone_records(mobile)) or (
        purpose == "link" and not any(u.name != user for u in _phone_records(mobile))) or (
        purpose in {"login", "reset"} and user is not None)
    if eligible:
        _send_code(mobile, code)
    frappe.cache.set(frappe.cache.make_key("as-account:otp:" + challenge), json.dumps(record), ex=OTP_TTL)
    return {"challenge": challenge, "expires_in": OTP_TTL, "retry_after": 60}


# Check attempts and consume successful challenges atomically, including concurrent requests.
VERIFY_SCRIPT = """
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local row = cjson.decode(raw)
row.attempts = row.attempts + 1
if row.attempts > 5 then redis.call('DEL', KEYS[1]); return nil end
if row.hash == ARGV[1] then redis.call('DEL', KEYS[1]); return raw end
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 and row.attempts < 5 then
  redis.call('SET', KEYS[1], cjson.encode(row), 'EX', ttl)
else redis.call('DEL', KEYS[1]) end
return nil
"""


def _consume(challenge, code):
    if not re.fullmatch(r"[A-Za-z0-9_-]{40,64}", str(challenge or "")):
        frappe.throw("The code is invalid or expired.", frappe.AuthenticationError)
    code = str(code or "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    digest = hashlib.sha256((challenge + ":" + code).encode()).hexdigest()
    raw = frappe.cache.eval(VERIFY_SCRIPT, 1, frappe.cache.make_key("as-account:otp:" + challenge), digest)
    if not raw:
        frappe.throw("The code is invalid or expired.", frappe.AuthenticationError)
    return json.loads(raw)


def _password(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        frappe.throw("Choose a password between 8 and 128 characters.")
    return password


def _registration_identity(username, email, mobile):
    username = str(username or "").strip().lower()
    email = str(email or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_.-]{3,40}", username):
        frappe.throw("Use 3 to 40 English letters, digits, dots, underscores or hyphens for username.")
    from frappe.utils import validate_email_address
    if not email or len(email) > 140 or email.endswith("@as-account.invalid"):
        frappe.throw("Enter a valid email address.")
    validate_email_address(email, throw=True)
    return username, email, normalize_mobile(mobile)


def _reject_duplicate_identity(username, email, mobile):
    if frappe.db.exists("User", {"username": username}) or frappe.db.exists("User", username):
        frappe.throw("This username is already registered.")
    if frappe.db.exists("User", email) or frappe.db.exists("User", {"email": email}) or frappe.db.exists("User", {"username": email}):
        frappe.throw("This email is already registered.")
    if _phone_records(mobile):
        frappe.throw("This mobile number is already registered.")


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=3600)
def register(full_name, username, password, email=None, mobile=None):
    """Password registration; retain an unverified phone separately until SMS verification."""
    if is_signup_disabled():
        frappe.throw("Account registration is disabled.")
    if SIGNUP_REQUIRES_OTP:
        frappe.throw("Verify your mobile number to create an account.")
    full_name = str(full_name or "").strip()
    if not full_name or len(full_name) > 140:
        frappe.throw("Enter your full name.")
    username, email, mobile = _registration_identity(username, email, mobile)
    password = _password(password)
    limit = int(frappe.get_system_settings("max_signups_allowed_per_hour") or 300)
    if frappe.db.get_creation_count("User", 60) >= limit:
        frappe.throw("Too many registrations. Try again later.", frappe.RateLimitExceededError)
    # All AS registration/link paths share one lock, held until the insert commits.
    with frappe.cache.lock(frappe.cache.make_key("as-account:identity"), timeout=30):
        # Reads before acquiring the lock can hold an older MariaDB snapshot.
        frappe.db.rollback()
        _reject_duplicate_identity(username, email, mobile)
        user = frappe.get_doc({"doctype": "User", "email": email, "first_name": full_name,
                               "username": username, "phone": mobile, "enabled": 1,
                               "user_type": "Website User", "send_welcome_email": 0,
                               "new_password": password})
        user.insert(ignore_permissions=True)
        if user.username != username:
            frappe.throw("This username is already registered.")
        frappe.db.commit()
    frappe.local.login_manager.login_as(user.name)
    return session()


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=600)
def password_login(usr, pwd):
    """Resolve AS identities, then run the native password, lockout and 2FA flow."""
    identifier = str(usr or "").strip().lower()
    user = frappe.db.get_value("User", {"username": identifier}, "name")
    if not user:
        user = frappe.db.get_value("User", {"email": identifier}, "name")
    if not user and re.fullmatch(r"09\d{9}", _mobile_digits(identifier)):
        rows = _phone_records(normalize_mobile(identifier))
        user = rows[0].name if len(rows) == 1 else None
    frappe.form_dict.usr = user or identifier
    frappe.form_dict.pwd = pwd
    frappe.local.login_manager.login()
    return session()


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=600)
def verify_code(challenge, code, full_name=None, username=None, password=None):
    row = _consume(challenge, code)
    mobile = row["mobile"]
    if row["purpose"] == "link":
        if frappe.session.user == "Guest" or frappe.session.user != row.get("user"):
            frappe.throw("Sign in first.", frappe.AuthenticationError)
        with frappe.cache.lock(frappe.cache.make_key("as-account:identity"), timeout=30):
            frappe.db.rollback()
            doc = frappe.get_doc("User", frappe.session.user)
            if doc.user_type != "Website User" or doc.mobile_no or any(u.name != doc.name for u in _phone_records(mobile)):
                frappe.throw("This mobile number cannot be added to this account.")
            doc.mobile_no = mobile
            doc.phone = mobile
            doc.save(ignore_permissions=True)
            frappe.db.commit()
    elif row["purpose"] == "signup":
        if is_signup_disabled():
            frappe.throw("Account registration is disabled.")
        # Phone registration cannot claim an unverified Google/email identity.
        email = mobile + "@as-account.invalid"
        full_name = str(full_name or "").strip()
        username = str(username or "").strip().lower()
        if not full_name or len(full_name) > 140:
            frappe.throw("Enter your full name.")
        if username and not re.fullmatch(r"[a-z0-9_.-]{3,40}", username):
            frappe.throw("Use 3 to 40 English letters, digits, dots, underscores or hyphens for username.")
        if _phone_records(mobile) or frappe.db.exists("User", email) or (
            username and frappe.db.exists("User", {"username": username})):
            frappe.throw("This account is already registered. Sign in or recover your password.")
        # Lock a canonical number to avoid two simultaneous registrations of one phone.
        with frappe.cache.lock(frappe.cache.make_key("as-account:identity"), timeout=30):
            frappe.db.rollback()
            if _phone_records(mobile):
                frappe.throw("This mobile number is already registered.")
            if username and frappe.db.exists("User", {"username": username}):
                frappe.throw("This username is already registered.")
            user = frappe.get_doc({"doctype": "User", "email": email, "first_name": full_name,
                                   "username": username or None, "mobile_no": mobile, "enabled": 1,
                                   "user_type": "Website User", "send_welcome_email": 0,
                                   "new_password": _password(password)})
            user.insert(ignore_permissions=True)
            if username and user.username != username:
                frappe.throw("This username is already registered.")
            frappe.db.commit()
            # Never add System User roles from a client or from default portal settings.
            frappe.local.login_manager.login_as(user.name)
    else:
        user = _phone_user(mobile)
        if not user or user != row.get("user"):
            frappe.throw("The code is invalid or expired.", frappe.AuthenticationError)
        if not frappe.db.get_value("User", user, "mobile_no"):
            with frappe.cache.lock(frappe.cache.make_key("as-account:identity"), timeout=30):
                frappe.db.rollback()
                if any(u.name != user for u in _phone_records(mobile)):
                    frappe.throw("This mobile number is already registered.")
                frappe.db.set_value("User", user, "mobile_no", mobile)
                frappe.db.commit()
        if row["purpose"] == "reset":
            from frappe.core.doctype.user.user import update_password
            doc = frappe.get_doc("User", user)
            doc.validate_reset_password()
            link = doc._reset_password(send_email=False)
            key = parse_qs(urlsplit(link).query)["key"][0]
            update_password(new_password=_password(password), key=key, logout_all_sessions=1)
        else:
            frappe.local.login_manager.login_as(user)
    return session()


@frappe.whitelist(methods=["POST"])
def save_profile(first_name, last_name=""):
    if frappe.session.user == "Guest":
        frappe.throw("Sign in first.", frappe.AuthenticationError)
    first_name, last_name = str(first_name).strip(), str(last_name or "").strip()
    if not first_name or len(first_name) > 140 or len(last_name) > 140:
        frappe.throw("Enter a valid name.")
    doc = frappe.get_doc("User", frappe.session.user)
    doc.first_name, doc.last_name = first_name, last_name
    doc.save(ignore_permissions=True)
    return session()


@frappe.whitelist(methods=["POST"])
def change_password(old_password, new_password):
    from frappe.core.doctype.user.user import update_password
    update_password(new_password=_password(new_password), old_password=old_password, logout_all_sessions=1)
    return session()


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=600)
def google_url(return_route=None):
    from frappe.utils.oauth import get_oauth2_authorize_url
    provider = _google_provider()
    if not provider:
        frappe.throw("Google sign-in is not configured yet.")
    redirect=ACCOUNT_ROUTE
    if isinstance(return_route,str) and re.match(r"^/(checkout|orders|tickets)(\?|$)",return_route) and len(return_route)<1000:
        redirect="/as-industries#"+return_route
    return {"url": get_oauth2_authorize_url(provider, redirect)}


PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024


def _profile_image_content(content):
    """Decode and re-encode raster images, limiting size and stripping metadata."""
    from io import BytesIO
    import warnings
    from PIL import Image, ImageOps, UnidentifiedImageError

    if not content or len(content) > PROFILE_IMAGE_MAX_BYTES:
        frappe.throw("Choose an image smaller than 5 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as original:
                if original.width * original.height > 20_000_000:
                    frappe.throw("Image dimensions are too large.")
                original.load()
                image = ImageOps.exif_transpose(original)
                image.thumbnail((1024, 1024))
                image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
                image.info.clear()
                result = BytesIO()
                image.save(result, format="PNG", optimize=True)
                return result.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        frappe.throw("Choose a valid JPG, PNG or WebP image.")


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=20, seconds=3600)
def upload_profile_image():
    """Upload an avatar for the signed-in user only; never accept a user ID."""
    if frappe.session.user == "Guest":
        frappe.throw("Sign in first.", frappe.AuthenticationError)
    upload = frappe.request.files.get("image")
    if not upload:
        frappe.throw("Choose an image first.")
    content = _profile_image_content(upload.stream.read(PROFILE_IMAGE_MAX_BYTES + 1))
    from frappe.utils.file_manager import save_file
    image_file = save_file("as-avatar-" + secrets.token_hex(8) + ".png", content,
                           "User", frappe.session.user, is_private=1, df="user_image")
    doc = frappe.get_doc("User", frappe.session.user)
    doc.user_image = image_file.file_url
    doc.save(ignore_permissions=True)
    return session()
