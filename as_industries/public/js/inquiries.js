/* Quick Contact submission and account/admin views share one implementation. */
(() => {
  "use strict";
  const t = (en, fa) => document.documentElement.lang === "fa" ? fa : en;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const api = (method, values = {}) => window.AS_ACCOUNT.request(
    "as_industries.inquiries." + method + "?" + new URLSearchParams(values), undefined, "GET");
  function photoError(file) {
    if (!file) return "";
    if (!["image/jpeg","image/png","image/webp"].includes(file.type))
      return t("Choose a JPG, PNG or WebP image.","یک عکس JPG، PNG یا WebP انتخاب کنید.");
    return file.size > 10 * 1024 * 1024 ? t("The photo must be 10 MB or smaller.","حجم عکس باید حداکثر ۱۰ مگابایت باشد.") : "";
  }
  function bind(form, status) {
    if (!form || form.dataset.inquiryBound) return;
    form.dataset.inquiryBound = "1";
    const input = form.querySelector("[name=photo]");
    const preview = form.querySelector("#quick-photo-preview");
    const photoStatus = form.querySelector("#quick-photo-status");
    const button = form.querySelector("[type=submit]");
    const message = form.querySelector("[name=message]");
    message.maxLength = 5000;
    let busy = false, photoVersion = 0;
    const clearPhoto = () => {
      photoVersion++;
      if (preview) { preview.hidden = true; preview.querySelector("img").removeAttribute("src"); }
      if (photoStatus) photoStatus.textContent = "";
    };
    if (input) {
      input.onchange = () => {
        clearPhoto();
        const file = input.files?.[0], error = photoError(file);
        input.setCustomValidity(error);
        photoStatus.textContent = error;
        if (!file || error) return;
        const version = photoVersion, reader = new FileReader();
        reader.onload = () => {
          if (version !== photoVersion || !form.isConnected) return;
          preview.querySelector("img").src = reader.result;
          preview.hidden = false; photoStatus.textContent = file.name;
        };
        reader.onerror = () => {
          if (version === photoVersion) photoStatus.textContent = t("Choose the photo again.","عکس را دوباره انتخاب کنید.");
        };
        reader.readAsDataURL(file);
      };
      form.querySelector("#quick-photo-remove").onclick = () => {
        input.value = ""; input.setCustomValidity(""); clearPhoto(); input.focus();
      };
    }
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      busy = true; button.disabled = true;
      status.textContent = t("Sending…","در حال ارسال…");
      try {
        const session = await window.AS_ACCOUNT.request("as_industries.account.session", undefined, "GET");
        if (!session.user) {
          status.innerHTML = t("Sign in, then return to this tab and send your request. Your form is preserved. ","وارد حساب شوید، سپس به این تب برگردید و درخواست را ارسال کنید. اطلاعات فرم حفظ شده است. ") +
            '<a class="button ghost" href="#/account?mode=password" target="_blank" rel="noopener">' + t("Sign in","ورود") + '</a>';
          return;
        }
        const data = new FormData(form), file = input?.files?.[0], error = photoError(file);
        if (error) throw Error(error);
        data.set("messenger_active", data.get("messengerActive") ? "1" : "0");
        data.delete("messengerActive");
        if (!file) data.delete("photo");
        const result = await window.AS_ACCOUNT.request("as_industries.inquiries.submit", data);
        if (!result?.ok || !result.name) throw Error(t("Submission was not confirmed.","ثبت درخواست تأیید نشد."));
        form.reset(); clearPhoto();
        status.innerHTML = t("Request saved. Reference: ","درخواست ثبت شد. کد پیگیری: ") + esc(result.name) +
          ' <a class="button primary" href="#/orders?inquiry=' + encodeURIComponent(result.name) + '">' + t("View in My Orders","مشاهده در سفارش‌های من") + '</a>';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false; button.disabled = false;
      }
    };
  }
  function mount(container, administrative = false) {
    if (!container) return;
    let start = 0, busy = false;
    async function load() {
      if (busy || !container.isConnected) return;
      busy = true;
      try {
        const data = await api(administrative ? "admin" : "mine", {start});
        if (!container.isConnected) return;
        container.innerHTML = '<h2>' + t("Quick Contact requests","درخواست‌های ارتباط سریع") + '</h2>' +
          data.requests.map(row => '<article id="inquiry-' + esc(row.name) + '" class="profile-panel panel"><h3>' + esc(row.name) +
            ' <span class="status-tag">' + t("Quick Contact","ارتباط سریع") + '</span></h3>' +
            '<p>' + esc(row.status) + '</p>' +
            (administrative ? '<p>' + [row.customer_name,row.phone,row.email,row.messenger].filter(Boolean).map(esc).join(" · ") + '</p>' : '') +
            '<p style="white-space:pre-wrap">' + esc(row.description) + '</p>' +
            (row.reference_image ? '<img data-inquiry-image="' + esc(row.name) + '" alt="' + t("Reference photo","عکس مرجع") + '" style="max-width:180px;max-height:160px;object-fit:contain">' : '') +
            '<small>' + esc(row.creation) + '</small></article>').join("") +
          (!data.requests.length ? '<p>' + t("No requests yet.","هنوز درخواستی ثبت نشده است.") + '</p>' : '') +
          '<button type="button" data-inquiry-prev ' + (!start ? 'disabled' : '') + '>' + t("Previous","قبلی") + '</button> ' +
          '<button type="button" data-inquiry-next ' + (!data.has_more ? 'disabled' : '') + '>' + t("Next","بعدی") + '</button>';
        for (const img of container.querySelectorAll("[data-inquiry-image]"))
          api("image", {name:img.dataset.inquiryImage,admin_view:administrative ? 1 : 0})
            .then(result => { if (img.isConnected) img.src = result.image; })
            .catch(() => { img.alt = t("Image could not be loaded","عکس بارگذاری نشد"); });
        const selected = new URLSearchParams(location.hash.split("?")[1] || "").get("inquiry");
        if (selected) document.getElementById("inquiry-" + selected)?.scrollIntoView({block:"center"});
      } catch (error) {
        if (container.isConnected) container.textContent = error.message;
      } finally { busy = false; }
    }
    container.addEventListener("click", event => {
      if (busy) return;
      if (event.target.hasAttribute("data-inquiry-prev")) { start = Math.max(0,start-20); load(); }
      if (event.target.hasAttribute("data-inquiry-next")) { start += 20; load(); }
    });
    load();
  }
  function section(main, id) {
    if (!main || main.querySelector("#" + id)) return;
    const container = document.createElement("section");
    container.id = id; container.className = "profile-panel";
    main.append(container); mount(container);
  }
  window.AS_INQUIRIES = {
    bind, mountAdmin:container => mount(container,true),
    mountProfile:main => section(main,"profileInquiries"),
    mountOrders:main => section(main,"orderInquiries")
  };
})();
