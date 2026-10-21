/** AS account uses the existing card styles and Frappe sessions, never local credentials. */
(() => {
  "use strict";
  let csrf = "";
  const sessionMethod = "as_industries.account.session";

  async function api(method, data, verb = "POST", retryCSRF = true) {
    // Use the current site's session cookie and fetch its token before every write.
    // A login, logout or another tab can replace the session after initial page load.
    if (verb === "POST") {
      const current = await api(sessionMethod, undefined, "GET");
      if (!current?.csrf_token) throw Error("Could not refresh your session. Reload the page.");
    }
    const multipart = data instanceof FormData;
    const response = await fetch("/api/method/" + method, {
      method: verb, credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(verb === "POST" ? {
        ...(!multipart ? { "Content-Type": "application/json" } : {}), "X-Frappe-CSRF-Token": csrf
      } : {}) }, ...(verb === "POST" ? { body: multipart ? data : JSON.stringify(data || {}) } : {})
    });
    const payload = await response.json();
    if (!response.ok || payload.exc) {
      // Frappe rejects CSRF before running the controller, so this retry cannot
      // duplicate a successful write. Other validation failures are never retried.
      if (verb === "POST" && retryCSRF && payload.exc_type === "CSRFTokenError")
        return api(method, data, verb, false);
      let message = "The request could not be completed. Try again.";
      try {
        const messages = JSON.parse(payload._server_messages || "[]");
        if (messages.length) message = JSON.parse(messages[messages.length - 1]).message;
      } catch (_) {}
      if (payload.exc_type === "CSRFTokenError")
        message = "Could not refresh your session. Reload the page.";
      else if (response.status === 401) message = "Incorrect username, password or verification code.";
      if (response.status === 429) message = "Too many requests. Try again later.";
      const error = new Error(message.replace(/<[^>]*>/g, ""));
      error.status = response.status;
      error.type = payload.exc_type;
      throw error;
    }
    const result = payload.message;
    if (result?.csrf_token) csrf = result.csrf_token;
    return result;
  }
  const method = name => "as_industries.account." + name;

  function mount(card, t, escape) {
    if (!card) return;
    // A different host can select a different Frappe database for the same page.
    const accountURL = window.SHN_INTEGRATION?.app_urls?.as;
    if (accountURL) {
      const target = new URL(accountURL, location.origin);
      if (target.origin !== location.origin || target.pathname !== location.pathname) {
        target.searchParams.set("lang", document.documentElement.lang || "fa");
        target.hash = location.hash || "#/account?mode=password";
        location.replace(target.href);
        return;
      }
    }
    const profilePage = card.id === "profileCard";
    const status = card.querySelector("#accountStatus");
    const google = card.querySelector("#googleSignIn");
    const passwordButton = card.querySelector("#emailSignIn");
    let otpButton = card.querySelector("#otpSignIn");
    if (!otpButton && passwordButton) {
      otpButton = document.createElement("button");
      otpButton.id = "otpSignIn";
      otpButton.type = "button";
      otpButton.className = "button ghost account-email";
      otpButton.textContent = t("Sign in with SMS code", "ورود با کد پیامکی");
      passwordButton.after(otpButton);
    }
    const accountParams = new URLSearchParams((location.hash.split("?")[1] || ""));
    const requestedMode = accountParams.get("mode");
    const requestedReturn = accountParams.get("return") || "";
    const returnRoute = /^\/(checkout|orders|tickets)(\?|$)/.test(requestedReturn) ? requestedReturn : "";
    const signedInDestination = returnRoute ? "#" + returnRoute : "#/profile";
    const initialMode = ({otp: "login", password: "password", signup: "signup", reset: "reset"})[requestedMode] || "password";
    let slot = card.querySelector("#accountForm");
    if (!slot) {
      slot = document.createElement("div");
      slot.id = "accountForm";
      status.before(slot);
    }
    let state = null, busy = false, cooldown = 0;
    const errors = {
      "Could not refresh your session. Reload the page.": ["Could not refresh your session. Reload the page.", "نشست شما تازه‌سازی نشد؛ صفحه را دوباره بارگذاری کنید."],
      "SMS sign-in is not configured yet.": ["SMS sign-in is not configured yet.", "سرویس پیامک هنوز تنظیم نشده است."],
      "Google sign-in is not configured yet.": ["Google sign-in is not configured yet.", "ورود گوگل هنوز تنظیم نشده است."],
      "Enter a valid Iranian mobile number.": ["Enter a valid Iranian mobile number.", "شماره موبایل معتبر ایران وارد کنید."],
      "The code is invalid or expired.": ["The code is invalid or expired.", "کد اشتباه است یا اعتبار آن تمام شده است."],
      "Choose a password between 8 and 128 characters.": ["Choose a password between 8 and 128 characters.", "رمز باید بین ۸ تا ۱۲۸ کاراکتر باشد."],
      "Incorrect username, password or verification code.": ["Incorrect username, password or verification code.", "نام کاربری، رمز یا کد ورود صحیح نیست."],
      "Too many requests. Try again later.": ["Too many requests. Try again later.", "درخواست‌ها بیش از حد مجاز است؛ بعداً تلاش کنید."],
      "This account is already registered. Sign in or recover your password.": ["This account is already registered. Sign in or recover your password.", "این حساب قبلاً ثبت شده است؛ وارد شوید یا رمز را بازیابی کنید."],
      "Wait 60 seconds before requesting another code.": ["Wait 60 seconds before requesting another code.", "برای ارسال مجدد کد ۶۰ ثانیه صبر کنید."],
      "Account registration is disabled.": ["Account registration is disabled.", "ثبت‌نام در تنظیمات سایت غیرفعال است."],
    };
    Object.assign(errors, {
      "This username is already registered.": ["This username is already registered.", "این نام کاربری قبلاً ثبت شده است."],
      "This email is already registered.": ["This email is already registered.", "این ایمیل قبلاً ثبت شده است."],
      "This mobile number is already registered.": ["This mobile number is already registered.", "این شماره موبایل قبلاً ثبت شده است."],
      "Enter a valid email address.": ["Enter a valid email address.", "ایمیل معتبر وارد کنید."]
    });
    const say = message => { if (card.isConnected) status.textContent = message; };
    const field = (name, en, fa, type = "text", value = "", attributes = "") =>
      '<label class="field">' + t(en, fa) + '<input name="' + name + '" type="' + type +
      '" value="' + escape(value) + '" ' + attributes + ' required></label>';
    const button = (action, en, fa, cls = "text-button") =>
      '<button type="button" class="' + cls + '" data-account-action="' + action + '">' + t(en, fa) + '</button>';
    const submit = (en, fa) => '<button class="button primary" type="submit">' + t(en, fa) + '</button>';
    const form = (name, html) => '<form data-account-form="' + name + '">' + html + '</form>';
    const password = (name = "password", en = "Password", fa = "رمز عبور", autocomplete = "new-password") =>
      field(name, en, fa, "password", "", (name === "old_password" ? "" : 'minlength="8" ') + 'maxlength="128" autocomplete="' + autocomplete + '"');
    const mobile = () => field("mobile", "Mobile number", "شماره موبایل", "tel", "", 'autocomplete="tel" inputmode="tel" maxlength="20"');
    const navigation = () => button("signup", "Create account", "ساخت حساب") + " · " +
      button("reset", "Forgot password", "فراموشی رمز");
    const resetMode = mode => { say(""); show(mode); };
    const icon = name => {
      const paths = {
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
        shop: '<path d="M3 8h18l-2 13H5L3 8Zm5 0V6a4 4 0 0 1 8 0v2"/>',
        lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        edit: '<path d="m16 3 5 5-12 12H4v-5L16 3Z"/>',
        arrow: '<path d="M10 17l5-5-5-5M3 12h12M15 3h6v18h-6"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
      };
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
    };
    const localActivity = [];
    function profileDashboard(u) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || t("Your account", "\u062d\u0633\u0627\u0628 \u0634\u0645\u0627");
      const email = (u.email || "").endsWith("@as-account.invalid") ? "" : u.email || "";
      const initials = name.split(/\s+/).slice(0, 2).map(n => n[0]).join("");
      const image = u.user_image && u.user_image.startsWith("/") && !u.user_image.startsWith("//")
        ? '<img src="' + escape(u.user_image) + '" alt="' + escape(name) + '">' : '<span>' + escape(initials) + '</span>';
      const photoControl = '<div class="profile-photo"><div class="profile-avatar">' + image + '<i></i></div>' +
        '<label class="profile-photo-select">' + icon("edit") + t("Change photo", "\u062a\u063a\u06cc\u06cc\u0631 \u0639\u06a9\u0633") +
        '<input type="file" data-profile-image accept="image/jpeg,image/png,image/webp" aria-label="' + t("Choose profile photo","\u0627\u0646\u062a\u062e\u0627\u0628 \u0639\u06a9\u0633 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644") + '"></label>' +
        '<small>' + t("JPG, PNG, WebP \u00b7 Up to 5 MB","JPG\u060c PNG\u060c WebP \u00b7 \u062d\u062f\u0627\u06a9\u062b\u0631 \u06f5 \u0645\u06af\u0627\u0628\u0627\u06cc\u062a") + '</small></div>';
      const brand = document.querySelector("header .brand");
      const date = value => {
        if (!value) return "";
        const parsed = new Date(String(value).replace(" ", "T"));
        return Number.isNaN(parsed.getTime()) ? "" : escape(parsed.toLocaleString(document.documentElement.lang === "fa" ? "fa-IR" : "en-US", {dateStyle:"medium", timeStyle:"short"}));
      };
      const nav = (href, symbol, en, fa, current=false) => '<a href="' + href + '"' + (current ? ' aria-current="page"' : '') + '>' + icon(symbol) + t(en,fa) + '</a>';
      const row = (symbol,title,description,time) => '<li><span class="profile-event-icon">' + icon(symbol) + '</span><div><strong>' + title + '</strong><p>' + description + '</p>' + (time ? '<time>' + date(time) + '</time>' : '') + '</div></li>';
      const activities = localActivity.map(a => row(a.symbol,t(...a.title),t(...a.description),a.time)).join("") +
        (u.last_login ? row("arrow",t("Last sign in","\u0622\u062e\u0631\u06cc\u0646 \u0648\u0631\u0648\u062f"),t("You signed in to your AS account.","\u0648\u0631\u0648\u062f \u0628\u0647 \u062d\u0633\u0627\u0628 AS \u0634\u0645\u0627."),u.last_login) : "") +
        (u.creation ? row("user",t("Account created","\u0633\u0627\u062e\u062a \u062d\u0633\u0627\u0628"),t("Your shared AS account was created.","\u062d\u0633\u0627\u0628 \u0645\u0634\u062a\u0631\u06a9 AS \u0634\u0645\u0627 \u0633\u0627\u062e\u062a\u0647 \u0634\u062f."),u.creation) : "");
      const readonly = (en,fa,value) => '<label class="field">' + t(en,fa) + '<input value="' + escape(value) + '" readonly></label>';
      return '<div class="profile-layout"><aside class="profile-sidebar"><div class="profile-brand">' + (brand ? brand.outerHTML : '<a href="#/">AS Industries</a>') + '</div><nav aria-label="' + t("Account navigation","\u0645\u0646\u0648\u06cc \u062d\u0633\u0627\u0628") + '">' +
        nav("#/profile","user","Profile","\u067e\u0631\u0648\u0641\u0627\u06cc\u0644",true) + nav("#/orders","shop","My orders","سفارش‌های من") + nav("#/tickets","grid","My tickets","تیکت‌های من") + (state.can_admin ? nav("/as-admin?lang=" + document.documentElement.lang,"grid","Admin panel","پنل مدیریت") : "") + nav("#/shop","shop","AS Shop","\u0641\u0631\u0648\u0634\u06af\u0627\u0647 AS") + nav("#/services","grid","Services","\u062e\u062f\u0645\u0627\u062a") +
        button("security", icon("lock") + " Account security", icon("lock") + " امنیت حساب", "profile-nav-button") +
        button("logout", icon("arrow") + " Sign out",icon("arrow") + " \u062e\u0631\u0648\u062c","profile-nav-button") +
        '</nav><div class="profile-sidebar-footer"><span class="profile-online"></span>' + t("One account. All of AS.","\u06cc\u06a9 \u062d\u0633\u0627\u0628\u060c \u062a\u0645\u0627\u0645 \u0628\u062e\u0634\u200c\u0647\u0627\u06cc AS.") + '<p>AS Industries \u00b7 AS Shop</p></div></aside>' +
        '<div class="profile-main"><div class="profile-topline"><div><small>AS / ACCOUNT</small><h1>' + t("My profile","\u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u0645\u0646") + '</h1></div><span class="profile-top-user">' + escape(u.username || name) + '</span></div>' +
        '<section class="profile-panel profile-hero">' + photoControl + '<div class="profile-identity"><h2>' + escape(name) + '</h2><p>' + t("AS customer account","\u062d\u0633\u0627\u0628 \u0645\u0634\u062a\u0631\u06cc AS") + '</p><span class="profile-badge">' + icon("user") + t("Shared account","\u062d\u0633\u0627\u0628 \u0645\u0634\u062a\u0631\u06a9") + '</span><p class="profile-description">' + t("Manage your details and security across AS Industries and AS Shop.","\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0648 \u0627\u0645\u0646\u06cc\u062a \u062d\u0633\u0627\u0628 \u062e\u0648\u062f \u0631\u0627 \u062f\u0631 AS Industries \u0648 AS Shop \u0645\u062f\u06cc\u0631\u06cc\u062a \u06a9\u0646\u06cc\u062f.") + '</p></div>' +
        button("edit",icon("edit") + " Edit profile",icon("edit") + " \u0648\u06cc\u0631\u0627\u06cc\u0634 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644","button primary profile-edit") + '</section>' +
        '<div class="profile-columns"><div class="profile-details-column"><section class="profile-panel" id="profilePersonal"><div class="profile-panel-heading">' + icon("user") + '<div><h3>' + t("Personal information","\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0634\u062e\u0635\u06cc") + '</h3><p>' + t("Keep your personal details up to date.","\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0634\u062e\u0635\u06cc \u062d\u0633\u0627\u0628 \u062e\u0648\u062f \u0631\u0627 \u0628\u0647\u200c\u0631\u0648\u0632 \u0646\u06af\u0647 \u062f\u0627\u0631\u06cc\u062f.") + '</p></div></div>' +
        form("profile",'<div class="profile-fields">' + field("first_name","First name","\u0646\u0627\u0645","text",u.first_name || "",'maxlength="140" autocomplete="given-name"') +
        '<label class="field">' + t("Last name","\u0646\u0627\u0645 \u062e\u0627\u0646\u0648\u0627\u062f\u06af\u06cc") + '<input name="last_name" value="' + escape(u.last_name || "") + '" maxlength="140" autocomplete="family-name"></label>' +
        readonly("Username","\u0646\u0627\u0645 \u06a9\u0627\u0631\u0628\u0631\u06cc",u.username || "") + readonly("Email address","\u0627\u06cc\u0645\u06cc\u0644",email || t("Not provided","\u062b\u0628\u062a \u0646\u0634\u062f\u0647")) +
        readonly("Mobile number","\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06cc\u0644",u.mobile_no || u.phone || t("Not verified","\u062a\u0623\u06cc\u06cc\u062f \u0646\u0634\u062f\u0647")) + readonly("Account type","\u0646\u0648\u0639 \u062d\u0633\u0627\u0628",t("Customer","\u0645\u0634\u062a\u0631\u06cc")) +
        '</div>' + submit("Save changes","\u0630\u062e\u06cc\u0631\u0647 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a")) + '</section>' +
        '<section class="profile-panel" id="profileSecurity"><div class="profile-panel-heading">' + icon("lock") + '<div><h3>' + t("Account security","\u0627\u0645\u0646\u06cc\u062a \u062d\u0633\u0627\u0628") + '</h3><p>' + t("Manage your password and verified mobile number.","\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0648 \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06cc\u0644 \u062a\u0623\u06cc\u06cc\u062f\u0634\u062f\u0647 \u0631\u0627 \u0645\u062f\u06cc\u0631\u06cc\u062a \u06a9\u0646\u06cc\u062f.") + '</p></div></div>' +
        '<div class="profile-security-row"><span class="profile-security-icon">' + icon("lock") + '</span><div><strong>' + t("Password","\u0631\u0645\u0632 \u0639\u0628\u0648\u0631") + '</strong><p>' + t("Choose a strong password for your account.","\u06cc\u06a9 \u0631\u0645\u0632 \u0642\u0648\u06cc \u0628\u0631\u0627\u06cc \u062d\u0633\u0627\u0628 \u062e\u0648\u062f \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f.") + '</p></div>' + button("change","Change password","\u062a\u063a\u06cc\u06cc\u0631 \u0631\u0645\u0632","button ghost") + '</div>' +
        '<div class="profile-security-row"><span class="profile-security-icon">' + icon("user") + '</span><div><strong>' + t("Mobile verification","\u062a\u0623\u06cc\u06cc\u062f \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06cc\u0644") + '</strong><p>' + (u.mobile_no ? escape(u.mobile_no) : t("Add a verified number for SMS sign in.","\u0628\u0631\u0627\u06cc \u0648\u0631\u0648\u062f \u067e\u06cc\u0627\u0645\u06a9\u06cc\u060c \u0634\u0645\u0627\u0631\u0647 \u062e\u0648\u062f \u0631\u0627 \u062a\u0623\u06cc\u06cc\u062f \u06a9\u0646\u06cc\u062f.")) + '</p><span class="profile-security-state">' + (u.mobile_no ? t("Verified","\u062a\u0623\u06cc\u06cc\u062f \u0634\u062f\u0647") : t("Not verified","\u062a\u0623\u06cc\u06cc\u062f \u0646\u0634\u062f\u0647")) + '</span></div>' +
        (u.mobile_no ? '' : button("link","Verify mobile","\u062a\u0623\u06cc\u06cc\u062f \u0645\u0648\u0628\u0627\u06cc\u0644","button ghost")) + '</div></section></div>' +
        '<section class="profile-panel profile-activity"><div class="profile-panel-heading">' + icon("clock") + '<div><h3>' + t("Account activity","\u0641\u0639\u0627\u0644\u06cc\u062a \u062d\u0633\u0627\u0628") + '</h3><p>' + t("Account dates and changes during this visit.","\u062a\u0627\u0631\u06cc\u062e\u200c\u0647\u0627\u06cc \u062d\u0633\u0627\u0628 \u0648 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a \u0627\u0646\u062c\u0627\u0645\u200c\u0634\u062f\u0647 \u062f\u0631 \u0627\u06cc\u0646 \u0628\u0627\u0632\u062f\u06cc\u062f.") + '</p></div></div><ol>' +
        (activities || '<li><p>' + t("No activity available yet.","\u0647\u0646\u0648\u0632 \u0641\u0639\u0627\u0644\u06cc\u062a\u06cc \u0628\u0631\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634 \u0648\u062c\u0648\u062f \u0646\u062f\u0627\u0631\u062f.") + '</p></li>') + '</ol></section></div></div></div>';
    }
    function show(mode = "password") {
      if (!card.isConnected) return;
      if (google) google.hidden = Boolean(state?.user);
      if (passwordButton) passwordButton.hidden = Boolean(state?.user);
      if (otpButton) otpButton.hidden = Boolean(state?.user);
      if (state?.user && !["change", "profile", "link"].includes(mode)) mode = "profile";
      passwordButton?.setAttribute("aria-pressed", String(mode === "password"));
      otpButton?.setAttribute("aria-pressed", String(mode === "login"));
      const headings = {
        password: ["Sign in with username and password", "ورود با نام کاربری و رمز"],
        login: ["Sign in with SMS code", "ورود با کد پیامکی"],
        signup: ["Create account", "ساخت حساب"],
        reset: ["Recover password", "بازیابی رمز"],
        profile: ["Your profile", "پروفایل شما"],
        change: ["Change password", "تغییر رمز"],
        link: ["Verify mobile number", "تأیید شماره موبایل"]
      };
      card.querySelector(profilePage ? ":scope > h2" : "h2").textContent = t(...(headings[mode] || headings.password));
      if (mode === "profile") {
        const u = state.user;
        if (profilePage) { slot.innerHTML = profileDashboard(u); window.AS_COMMERCE?.mountProfile(slot.querySelector(".profile-main")); window.AS_TICKETS?.mountProfile(slot.querySelector(".profile-main")); window.AS_FIGURES?.mountProfile(slot.querySelector(".profile-main")); }
        else {
        slot.innerHTML = '<p>' + escape(u.username || ((u.email || "").endsWith("@as-account.invalid") ? u.mobile_no : u.email)) + '</p><p>' + escape(u.mobile_no || "") + '</p>' +
          form("profile", field("first_name", "First name", "نام", "text", u.first_name || "", 'maxlength="140" autocomplete="given-name"') +
          '<label class="field">' + t("Last name", "نام خانوادگی") + '<input name="last_name" value="' + escape(u.last_name || "") + '" maxlength="140" autocomplete="family-name"></label>' +
          submit("Save profile", "ذخیره پروفایل")) +
          (u.mobile_no ? "" : button("link", "Verify mobile number", "تأیید شماره موبایل") + " · ") +
          button("change", "Change password", "تغییر رمز") + " · " + button("logout", "Sign out", "خروج");
        }
      } else if (mode === "change") {
        slot.innerHTML = form("change", password("old_password", "Current password", "رمز فعلی", "current-password") +
          password("new_password", "New password", "رمز جدید") + password("confirm", "Repeat new password", "تکرار رمز جدید") +
          submit("Change password", "تغییر رمز")) + button("profile", "Back to profile", "بازگشت به پروفایل");
      } else if (mode === "password") {
        slot.innerHTML = form("password", field("usr", "Username, email or mobile", "نام کاربری، ایمیل یا موبایل", "text", "",
          'autocomplete="username" maxlength="140"') + field("pwd", "Password", "رمز عبور", "password", "",
          'autocomplete="current-password" maxlength="128"') + submit("Sign in", "ورود")) +
          navigation();
      } else if (mode === "signup" && !state?.signup_requires_otp) {
        slot.innerHTML = form("signup",
          field("full_name", "Full name", "نام و نام خانوادگی", "text", "", 'maxlength="140" autocomplete="name"') +
          field("username", "Username", "نام کاربری", "text", "", 'pattern="(?:[A-Za-z0-9_.]|-){3,40}" autocomplete="username" maxlength="40"') +
          field("email", "Email address", "ایمیل", "email", "", 'maxlength="140" autocomplete="email"') +
          mobile() +
          password() + password("confirm", "Repeat password", "تکرار رمز") +
          submit("Create account", "ساخت حساب")) +
          button("password", "Already have an account? Sign in", "حساب دارید؟ وارد شوید");
      } else {
        const registering = mode === "signup", recovering = mode === "reset";
        slot.innerHTML = form(mode, mobile() + (registering ?
          field("full_name", "Full name", "نام و نام خانوادگی", "text", "", 'maxlength="140" autocomplete="name"') +
          field("username", "Username", "نام کاربری", "text", "", 'pattern="(?:[A-Za-z0-9_.]|-){3,40}" autocomplete="username" maxlength="40"') : "") +
          (registering || recovering ? password() + password("confirm", "Repeat password", "تکرار رمز") : "") +
          '<div data-code-field hidden>' + field("code", "Verification code", "کد تأیید", "text", "",
          'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9۰-۹٠-٩]{6}" maxlength="6" disabled') + '</div>' +
          submit("Send verification code", "ارسال کد تأیید") +
          '<button type="button" class="text-button" data-account-action="resend" hidden>' + t("Resend code", "ارسال مجدد کد") + '</button>') +
          button("password", "Sign in with password", "ورود با رمز عبور") + " · " + navigation();
        slot.querySelector("form").dataset.challenge = "";
        if (!state?.sms_ready) say(t("SMS sign-in is not configured yet.", "سرویس پیامک هنوز تنظیم نشده است."));
      }
    }
    const ready = api(method("session"), {}, "GET").then(result => {
      if (!card.isConnected) return;
      state = result; csrf = result.csrf_token || "";
      if (profilePage && !result.user) { location.replace("#/account?mode=password"); return; }
      if (!profilePage && result.user) { location.replace(signedInDestination); return; }
      show(profilePage ? "profile" : initialMode);
      if (result.user || initialMode === "password" || (initialMode === "signup" && !result.signup_requires_otp) || result.sms_ready)
        say(t("One account for AS Industries and AS Shop.", "یک حساب مشترک برای AS Industries و AS Shop."));
    }).catch(error => say(t("Could not load your account. Refresh the page.", "اطلاعات حساب بارگذاری نشد؛ صفحه را تازه‌سازی کنید.")));
    async function run(action) {
      if (busy) return;
      busy = true;
      card.setAttribute("aria-busy", "true");
      slot.querySelectorAll("button").forEach(b => b.disabled = true);
      try { await ready; await action(); }
      catch (error) { say(errors[error.message] ? t(...errors[error.message]) : error.message); }
      finally {
        busy = false; card.removeAttribute("aria-busy");
        slot.querySelectorAll("button").forEach(b => b.disabled = b.dataset.accountAction === "resend" && Date.now() < cooldown);
      }
    }
    async function sendCode(f, values) {
      if (!state?.sms_ready) throw Error("SMS sign-in is not configured yet.");
      const result = await api(method("request_code"), {mobile: values.mobile, purpose: f.dataset.accountForm});
      f.dataset.challenge = result.challenge;
      f.querySelector('[name="mobile"]').readOnly = true;
      f.querySelector("[data-code-field]").hidden = false;
      f.querySelector('[name="code"]').disabled = false;
      f.querySelector('[type="submit"]').textContent = t("Verify and continue", "تأیید و ادامه");
      const resend = f.querySelector('[data-account-action="resend"]');
      resend.hidden = false; cooldown = Date.now() + result.retry_after * 1000;
      const updateResend = () => {
        const seconds = Math.max(0, Math.ceil((cooldown - Date.now()) / 1000));
        resend.textContent = seconds ? t("Resend code in ", "ارسال مجدد پس از ") + seconds + t(" seconds", " ثانیه") :
          t("Resend code", "ارسال مجدد کد");
      };
      updateResend();
      const timer = setInterval(() => {
        updateResend();
        if (!f.isConnected || Date.now() >= cooldown) {
          clearInterval(timer); if (f.isConnected) resend.disabled = busy;
        }
      }, 1000);
      say(t("If this number is eligible, a code was sent. It expires in 5 minutes.", "اگر شماره واجد شرایط باشد، کد ارسال شد؛ اعتبار کد ۵ دقیقه است."));
      f.querySelector('[name="code"]').focus();
    }
    slot.addEventListener("change", event => {
      const input = event.target.closest("[data-profile-image]");
      const file = input?.files?.[0];
      if (!file || busy) return;
      run(async () => {
        if (!state?.user) throw Error(t("Sign in first.","\u0627\u0628\u062a\u062f\u0627 \u0648\u0627\u0631\u062f \u062d\u0633\u0627\u0628 \u0634\u0648\u06cc\u062f."));
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
          throw Error(t("Choose a JPG, PNG or WebP image.","\u0639\u06a9\u0633 JPG\u060c PNG \u06cc\u0627 WebP \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f."));
        if (file.size > 5 * 1024 * 1024)
          throw Error(t("Choose an image smaller than 5 MB.","\u0639\u06a9\u0633 \u0628\u0627\u06cc\u062f \u06a9\u0648\u0686\u06a9\u200c\u062a\u0631 \u0627\u0632 \u06f5 \u0645\u06af\u0627\u0628\u0627\u06cc\u062a \u0628\u0627\u0634\u062f."));
        say(t("Uploading your photo\u2026","\u062f\u0631 \u062d\u0627\u0644 \u0630\u062e\u06cc\u0631\u0647 \u0639\u06a9\u0633\u2026"));
        const data = new FormData();
        data.append("image", file);
        state = await api(method("upload_profile_image"), data);
        localActivity.unshift({symbol:"user",title:["Profile photo updated","\u062a\u063a\u06cc\u06cc\u0631 \u0639\u06a9\u0633 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644"],
          description:["You changed your profile photo.","\u0639\u06a9\u0633 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u062e\u0648\u062f \u0631\u0627 \u062a\u063a\u06cc\u06cc\u0631 \u062f\u0627\u062f\u06cc\u062f."],time:new Date().toISOString()});
        show("profile");
        say(t("Profile photo saved.","\u0639\u06a9\u0633 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f."));
      }).finally(() => { input.value = ""; });
    });
    slot.addEventListener("submit", event => {
      const f = event.target.closest("[data-account-form]");
      if (!f) return;
      event.preventDefault();
      const values = Object.fromEntries(new FormData(f));
      const mode = f.dataset.accountForm;
      run(async () => {
        if (!state) throw Error("The request could not be completed. Try again.");
        if (values.confirm !== undefined && values.confirm !== values.password && values.confirm !== values.new_password)
          throw Error(t("Passwords do not match.", "رمزها یکسان نیستند."));
        if (mode === "password") {
          state = await api(method("password_login"), values);
          state = await api(method("session"), {}, "GET");
          if (!state.user) throw Error(t("Complete the additional verification on the standard login page.", "تأیید اضافی ورود را در صفحه ورود استاندارد انجام دهید."));
        } else if (mode === "profile") {
          state = await api(method("save_profile"), values);
          localActivity.unshift({symbol:"user",title:["Profile updated","ویرایش پروفایل"],description:["You updated your personal details.","اطلاعات شخصی خود را ویرایش کردید."],time:new Date().toISOString()});
        } else if (mode === "change") {
          state = await api(method("change_password"), {old_password: values.old_password, new_password: values.new_password});
          localActivity.unshift({symbol:"lock",title:["Password changed","تغییر رمز"],description:["Your password was changed successfully.","رمز شما با موفقیت تغییر کرد."],time:new Date().toISOString()});
        } else if (mode === "signup" && !state.signup_requires_otp) {
          state = await api(method("register"), {full_name: values.full_name, username: values.username, password: values.password, email: values.email, mobile: values.mobile});
        } else if (!f.dataset.challenge) {
          await sendCode(f, values); return;
        } else {
          state = await api(method("verify_code"), {
            challenge: f.dataset.challenge, code: values.code,
            full_name: values.full_name, username: values.username, password: values.password
          });
        }
        csrf = state.csrf_token || "";
        if (!profilePage && state.user) { location.replace(signedInDestination); return; }
        show(); say(t("Saved successfully.", "با موفقیت انجام شد."));
      });
    });
    slot.addEventListener("click", event => {
      const b = event.target.closest("[data-account-action]");
      if (!b || busy) return;
      const action = b.dataset.accountAction;
      if (action === "logout") run(async () => { await api("logout"); location.replace("#/account?mode=password"); });
      else if (action === "resend") run(async () => {
        const f = b.closest("form"); await sendCode(f, Object.fromEntries(new FormData(f)));
      });
      else if (action === "edit") { slot.querySelector('[name="first_name"]')?.focus(); slot.querySelector("#profilePersonal")?.scrollIntoView({behavior:"smooth",block:"center"}); }
      else if (action === "security") slot.querySelector("#profileSecurity")?.scrollIntoView({behavior:"smooth",block:"center"});
      else resetMode(action);
    });
    if (google) google.onclick = () => run(async () => {
      const result = await api(method("google_url"), {return_route: returnRoute});
      location.assign(result.url);
    });
    if (passwordButton) passwordButton.onclick = () => { if (!busy) resetMode("password"); };
    if (otpButton) otpButton.onclick = () => { if (!busy) resetMode("login"); };
  }
  window.AS_ACCOUNT = {mount, request: api};
})();
