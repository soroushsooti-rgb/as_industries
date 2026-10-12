/* Native Shop orders and gateway settings inside the existing AS admin panel. */
(() => {
  "use strict";
  let active;
  function mount(panel,options){
    const C=window.AS_COMMERCE,{t,esc,money,date,payment,stage}=C;
    let connection={connected:false},start=0,query="",paymentFilter="",stageFilter="",busy=false,modal,canWrite=false;
    const alive=()=>panel.isConnected;
    const button=(action,label,cls="outline-button",extra="")=>'<button type="button" class="'+cls+'" data-admin-order="'+action+'" '+extra+'>'+label+'</button>';
    const request=(method,data,verb="POST")=>window.AS_ACCOUNT.request("as_industries."+method,data,verb);
    const read=(action,payload={})=>request("orders.admin_read?"+new URLSearchParams({action,payload:JSON.stringify(payload)}),undefined,"GET");
    const write=(action,payload)=>request("orders.admin_write",{action,payload});
    function status(message){const el=modal?.querySelector(".inventory-dialog-status")||panel.querySelector("[data-order-status]");if(el)el.textContent=message;}
    function close(){if(modal){modal.close();modal.remove();modal=null;}}
    function dialog(title,body){
      close();modal=document.createElement("dialog");modal.className="inventory-dialog";
      modal.innerHTML='<header><h2>'+esc(title)+'</h2>'+button("close","×","inventory-close")+'</header><div class="inventory-dialog-body">'+body+'</div><p class="inventory-dialog-status" role="status"></p>';
      modal.addEventListener("cancel",event=>{event.preventDefault();close();});panel.append(modal);modal.showModal();return modal;
    }
    async function run(fn){
      if(busy)return;busy=true;
      panel.querySelectorAll("button").forEach(b=>{b.dataset.orderDisabled=String(b.disabled);b.disabled=true;});
      try{await fn();}catch(e){status(C.error(e));}
      finally{busy=false;if(alive())panel.querySelectorAll("button").forEach(b=>{if(b.dataset.orderDisabled!==undefined){b.disabled=b.dataset.orderDisabled==="true";delete b.dataset.orderDisabled;}});}
    }
    function connectView(){
      panel.innerHTML='<div class="section-title"><h1>'+t("Shop management connection","اتصال مدیریت فروشگاه")+'</h1></div><section class="panel inventory-connect"><p>'+t("Use the Shop administrator account to manage orders and gateway settings.","برای مدیریت سفارش‌ها و تنظیمات درگاه، با حساب مدیر فروشگاه متصل شوید.")+'</p><form data-admin-order-form="connect">'+
        (connection.needs_otp?'<label>'+t("Verification code","کد تأیید")+'<input name="otp" autocomplete="one-time-code" required></label>':
        '<label>'+t("Username","نام کاربری")+'<input name="usr" autocomplete="username" value="Administrator" required></label><label>'+t("Password","رمز عبور")+'<input name="pwd" type="password" autocomplete="current-password" required></label>')+
        '<button class="primary-button" type="submit">'+t("Connect","اتصال")+'</button></form><p data-order-status role="status"></p></section>';
    }
    async function settingsView(){
      const result=await read("settings");if(!alive())return;
      const s=result.settings;canWrite=result.can_write;
      panel.innerHTML='<div class="section-title"><div><h1>'+t("Iranian payment gateway","درگاه پرداخت ایرانی")+'</h1><p>'+t("Zarinpal connection, shipping fee and callback URLs.","اتصال زرین‌پال، هزینه ارسال و آدرس بازگشت پرداخت.")+'</p></div>'+button("refresh",t("Refresh","تازه‌سازی"))+'</div>'+
        '<section class="panel inventory-connect"><form class="commerce-settings" data-admin-order-form="settings"><fieldset '+(!canWrite?"disabled":"")+'><div class="commerce-settings">'+
        '<label class="commerce-setting-check"><input name="enabled" type="checkbox" '+(s.enabled?"checked":"")+'>'+t("Enable online payment","فعال کردن پرداخت آنلاین")+'</label>'+
        '<label>'+t("Gateway","درگاه")+'<select name="provider"><option value="Zarinpal" '+(s.provider==="Zarinpal"?"selected":"")+'>'+t("Zarinpal","زرین‌پال")+'</option><option value="Zibal" '+(s.provider==="Zibal"?"selected":"")+'>'+t("Zibal","زیبال")+'</option></select></label>'+
        '<label>'+t("Merchant ID / credential","شناسه پذیرنده / مرچنت")+'<input name="merchant_id" type="password" autocomplete="new-password" placeholder="'+(s.has_credential?t("Configured — leave blank to keep","تنظیم شده؛ خالی بگذارید تا حفظ شود"):t("Enter merchant credential","شناسه پذیرنده را وارد کنید"))+'"></label>'+
        '<label class="commerce-setting-check"><input name="sandbox" type="checkbox" '+(s.sandbox?"checked":"")+'>'+t("Sandbox mode (no real dispatch)","حالت آزمایشی (بدون ارسال واقعی)")+'</label>'+
        '<label>'+t("Public Shop origin","آدرس عمومی فروشگاه بدون مسیر صفحه")+'<input name="public_shop_url" type="url" dir="ltr" value="'+esc(s.public_shop_url)+'" placeholder="https://shop.example.com" required></label>'+
        '<label>'+t("AS Industries customer website","آدرس صفحه اصلی AS Industries")+'<input name="customer_website_url" type="url" dir="ltr" value="'+esc(s.customer_website_url)+'" required></label>'+
        '<label>'+t("Shipping fee in Toman","هزینه ارسال به تومان")+'<input name="shipping_fee" type="number" min="0" step="1" value="'+Number(s.shipping_fee||0)+'" required></label>'+
        '<label>'+t("Shipping explanation","توضیحات ارسال")+'<textarea name="shipping_description" maxlength="1000">'+esc(s.shipping_description)+'</textarea></label>'+
        '<label>'+t("Stock reservation in minutes","زمان رزرو موجودی به دقیقه")+'<input name="reservation_minutes" type="number" min="5" max="60" value="'+Number(s.reservation_minutes||20)+'" required></label>'+
        '<p class="commerce-notice">'+t("Live callbacks require a public HTTPS domain. Merchant credentials remain encrypted on the server and are never returned to the browser.","بازگشت پرداخت واقعی به دامنه عمومی HTTPS نیاز دارد. شناسه پذیرنده در سرور رمزگذاری می‌شود و مقدار ذخیره‌شده به مرورگر برگردانده نمی‌شود.")+'</p>'+
        '<p class="commerce-notice">'+t("Gateway status: ","وضعیت درگاه: ")+(s.ready?t("Ready","آماده"):t("Not configured / disabled","تنظیم نشده / غیرفعال"))+'</p>'+
        (canWrite?'<button class="primary-button" type="submit">'+t("Save settings","ذخیره تنظیمات")+'</button>':"")+'</div></fieldset></form><p data-order-status role="status"></p></section>';
    }
    async function list(){
      const data=await read("orders",{start,query,payment_status:paymentFilter,fulfillment_status:stageFilter});if(!alive())return;canWrite=data.can_write;
      panel.innerHTML='<div class="section-title"><div><h1>'+t("Orders","سفارش‌ها")+'</h1><p>'+t("Verified payments, fulfillment and postal tracking.","پرداخت تأییدشده، آماده‌سازی و رهگیری پستی.")+'</p></div><div class="commerce-admin-actions">'+button("refresh",t("Refresh","تازه‌سازی"))+'<a class="outline-button" href="#payments">'+t("Gateway settings","تنظیمات درگاه")+'</a></div></div>'+
        '<div class="commerce-admin-filters"><select data-order-filter="payment"><option value="">'+t("All payments","همه پرداخت‌ها")+'</option>'+["Awaiting Payment","Paid","Failed","Expired"].map(v=>'<option value="'+v+'" '+(paymentFilter===v?"selected":"")+'>'+payment(v)+'</option>').join("")+'</select>'+
        '<select data-order-filter="stage"><option value="">'+t("All fulfillment states","همه وضعیت‌های ارسال")+'</option>'+["Preparing","Posted","Delivered"].map(v=>'<option value="'+v+'" '+(stageFilter===v?"selected":"")+'>'+stage(v)+'</option>').join("")+'</select></div>'+
        '<section class="panel table-panel"><div class="table-scroll"><table class="commerce-admin-table"><thead><tr>'+
        [t("ORDER","سفارش"),t("RECIPIENT","گیرنده"),t("MOBILE","موبایل"),t("TOTAL","مبلغ"),t("PAYMENT","پرداخت"),t("FULFILLMENT","آماده‌سازی / ارسال"),t("TRACKING","رهگیری پستی"),t("DATE","تاریخ"),t("ACTION","عملیات")].map(v=>'<th>'+v+'</th>').join("")+
        '</tr></thead><tbody>'+(data.orders.length?data.orders.map(o=>'<tr><td dir="ltr">'+esc(o.name)+'</td><td>'+esc(o.recipient_name)+'</td><td dir="ltr">'+esc(o.mobile)+'</td><td>'+money(o.total_amount)+'</td><td>'+C.statusHTML({...o,fulfillment_status:null})+'</td><td>'+ (o.payment_status==="Paid"&&!o.is_test?o.needs_review?t("Stock review","بررسی موجودی"):stage(o.fulfillment_status):"—")+'</td><td dir="ltr">'+esc(o.tracking_code||"—")+'</td><td>'+date(o.creation)+'</td><td>'+button("detail",t("Open","باز کردن"),"outline-button",'data-name="'+esc(o.name)+'"')+'</td></tr>').join(""):'<tr><td colspan="9" class="empty-cell">'+t("No orders found.","سفارشی پیدا نشد.")+'</td></tr>')+
        '</tbody></table></div><div class="pagination"><span>'+t("Page","صفحه")+" "+(start/25+1)+'</span><div>'+button("prev",t("Previous","قبلی"),"outline-button",!start?"disabled":"")+button("next",t("Next","بعدی"),"outline-button",!data.has_more?"disabled":"")+'</div></div></section><p data-order-status role="status"></p>';
    }
    async function detail(name){
      const data=await read("order",{name});if(!alive())return;const o=data.order;
      dialog(o.name,C.detailHTML(o,options.shopURL)+
        '<form data-admin-order-form="fulfillment" data-name="'+esc(name)+'" data-modified="'+esc(o.modified)+'"><div class="commerce-admin-fields">'+
        '<label>'+t("Fulfillment status","وضعیت آماده‌سازی و ارسال")+'<select name="fulfillment_status" '+(o.payment_status!=="Paid"||o.needs_review||o.is_test||!data.can_write?"disabled":"")+'>'+["Preparing","Posted","Delivered"].map(v=>'<option value="'+v+'" '+(o.fulfillment_status===v?"selected":"")+'>'+stage(v)+'</option>').join("")+'</select></label>'+
        '<label>'+t("Postal tracking code","کد رهگیری پستی")+'<input name="tracking_code" value="'+esc(o.tracking_code)+'" maxlength="140" '+(!data.can_write?"disabled":"")+'></label>'+
        '<label>'+t("Shipping company","شرکت ارسال")+'<input name="shipping_company" value="'+esc(o.shipping_company)+'" maxlength="140" '+(!data.can_write?"disabled":"")+'></label>'+
        '<label>'+t("Internal notes","یادداشت داخلی")+'<textarea name="admin_notes" maxlength="3000" '+(!data.can_write?"disabled":"")+'>'+esc(o.admin_notes)+'</textarea></label></div>'+
        (data.can_write?'<div class="inventory-form-footer"><button class="primary-button" type="submit">'+t("Save order","ذخیره سفارش")+'</button>'+button("reconcile",t("Verify payment / allocate stock","بررسی پرداخت / تأمین موجودی"),"outline-button",'data-name="'+esc(name)+'" data-modified="'+esc(o.modified)+'"')+'</div>':"")+'</form>');
    }
    async function refresh(){if(options.section==="payments")await settingsView();else await list();}
    panel.addEventListener("change",event=>{if(event.target.dataset.orderFilter){if(event.target.dataset.orderFilter==="payment")paymentFilter=event.target.value;else stageFilter=event.target.value;start=0;run(list);}});
    panel.addEventListener("click",event=>{
      const b=event.target.closest("[data-admin-order]");if(!b)return;const action=b.dataset.adminOrder;
      if(action==="close"){close();return;}
      run(async()=>{
        if(action==="refresh")return refresh();
        if(action==="prev"){start=Math.max(0,start-25);return list();}
        if(action==="next"){start+=25;return list();}
        if(action==="detail")return detail(b.dataset.name);
        if(action==="reconcile"){await write("reconcile",{name:b.dataset.name,modified:b.dataset.modified});close();await list();await detail(b.dataset.name);status(t("Payment and stock checked.","پرداخت و موجودی بررسی شد."));}
      });
    });
    panel.addEventListener("submit",event=>{
      const form=event.target.closest("[data-admin-order-form]");if(!form)return;event.preventDefault();if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form)),mode=form.dataset.adminOrderForm;
      run(async()=>{
        if(mode==="connect"){
          connection=await request("inventory.connect",values);const pwd=form.querySelector('[name="pwd"]');if(pwd)pwd.value="";
          if(connection.connected)await refresh();else connectView();return;
        }
        if(mode==="settings"){
          values.enabled=form.querySelector('[name="enabled"]').checked?1:0;
          values.sandbox=form.querySelector('[name="sandbox"]').checked?1:0;
          await write("settings",{values});await settingsView();status(t("Gateway settings saved.","تنظیمات درگاه ذخیره شد."));return;
        }
        await write("fulfillment",{name:form.dataset.name,modified:form.dataset.modified,values});
        const name=form.dataset.name;close();await list();await detail(name);status(t("Order updated.","سفارش به‌روزرسانی شد."));
      });
    });
    active={search:value=>{query=String(value||"");start=0;if(options.section==="orders"&&connection.connected)run(list);}};
    run(async()=>{connection=await request("inventory.status",undefined,"GET");if(!alive())return;if(connection.connected)await refresh();else connectView();});
  }
  window.AS_ADMIN_ORDERS={mount,search:value=>active?.search(value)};
})();
