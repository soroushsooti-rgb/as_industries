/* Checkout and customer orders share the existing AS account and website shell. */
(() => {
  "use strict";
  const fa=()=>document.documentElement.lang==="fa";
  const t=(en,persian)=>fa()?persian:en;
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num=v=>new Intl.NumberFormat(fa()?"fa-IR":"en-US",{maximumFractionDigits:2}).format(Number(v)||0);
  const money=v=>num(v)+" "+t("Toman","تومان");
  const date=v=>v?new Date(String(v).replace(" ","T")).toLocaleString(fa()?"fa-IR":"en-US"):"—";
  const payment=v=>({Paid:t("Paid","پرداخت‌شده"),"Awaiting Payment":t("Awaiting payment","در انتظار پرداخت"),Failed:t("Payment failed","پرداخت ناموفق"),Expired:t("Payment expired","مهلت پرداخت تمام شده")}[v]||v);
  const stage=v=>({Preparing:t("Preparing","در حال آماده‌سازی"),Posted:t("Handed to post","تحویل به پست"),Delivered:t("Delivered","تحویل داده‌شده")}[v]||v);
  const image=(raw,shop)=>{try{const url=new URL(raw,shop||window.SHN_INTEGRATION?.app_urls?.shop||location.origin);return ["https:","http:"].includes(url.protocol)?url.href:"";}catch(_){return "";}};
  const icon=path=>'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'+path+'</svg>';
  const lock=icon('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>');
  const box=icon('<path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4m-9 4v10"/>');
  const errors={
    "Online payment is not configured yet.":"درگاه پرداخت هنوز تنظیم نشده است.",
    "Some basket products are no longer available.":"موجودی بعضی محصولات سبد کافی نیست؛ سبد را اصلاح کنید.",
    "Requested quantity is not available.":"موجودی محصول کافی نیست.",
    "Complete the recipient name, province, city and address.":"نام گیرنده، استان، شهر و آدرس را کامل وارد کنید.",
    "Enter a valid Iranian mobile number.":"شماره موبایل ایرانی معتبر وارد کنید.",
    "Enter a ten-digit postal code.":"کد پستی ۱۰ رقمی وارد کنید.",
    "Order changed. Reload it before saving.":"سفارش تغییر کرده؛ ابتدا تازه‌سازی کنید.",
    "Fulfillment requires a verified payment and reserved stock.":"تغییر وضعیت ارسال فقط برای سفارش پرداخت‌شده با موجودی تأمین‌شده مجاز است.",
    "The gateway rejected the payment request.":"درگاه درخواست پرداخت را نپذیرفت.",
    "The gateway did not respond. The order is saved; check its status before trying again.":"درگاه پاسخ نداد؛ سفارش ذخیره شده است. پیش از تلاش دوباره وضعیت آن را بررسی کنید.",
    "Checkout connection is not configured.":"اتصال سفارش‌ها هنوز تنظیم نشده است."
  };
  const error=e=>fa()?(errors[e.message]||e.message):e.message;
  async function api(method,data,verb="POST"){return window.AS_ACCOUNT.request("as_industries.orders."+method,data,verb);}
  function get(method,values={}){return api(method+"?"+new URLSearchParams(values),undefined,"GET");}
  function params(){return new URLSearchParams((location.hash.split("?")[1]||""));}
  function shopLink(){const url=new URL(window.SHN_INTEGRATION?.app_urls?.shop||location.origin);url.searchParams.set("lang",fa()?"fa":"en");url.hash="/shop/basket";return url.href;}
  function itemsHTML(items,shop){
    return '<div class="commerce-items">'+items.map(item=>'<article class="commerce-item">'+(item.image?'<img src="'+esc(image(item.image,shop))+'" alt="" loading="lazy">':'<span class="commerce-item-placeholder">'+box+'</span>')+
      '<div><strong>'+esc((fa()?item.title:item.title_en)||item.title)+'</strong><small dir="ltr">'+esc(item.product_code)+'</small><small>'+num(item.quantity)+" "+t("pieces","عدد")+" × "+money(item.unit_price)+'</small></div><b>'+money(item.line_total)+'</b></article>').join("")+'</div>';
  }
  function statusHTML(order){return '<span class="commerce-badge '+(order.payment_status==="Paid"?"is-paid":"")+'">'+payment(order.payment_status)+'</span>'+
    (order.payment_status==="Paid"&&!order.is_test&&order.fulfillment_status?'<span class="commerce-badge">'+(order.needs_review?t("Stock allocation under review","در انتظار تأمین موجودی"):stage(order.fulfillment_status))+'</span>':"")+
    (order.is_test?'<span class="commerce-badge is-test">'+t("Test order","سفارش آزمایشی")+'</span>':"");}
  function detailHTML(order,shop){
    return '<div class="commerce-order-heading"><h2 dir="ltr">'+esc(order.name)+'</h2><div>'+statusHTML(order)+'</div></div>'+
      (order.is_test?'<p class="commerce-notice">'+t("This is a sandbox payment. No real order is dispatched.","این پرداخت آزمایشی است و سفارش واقعی ارسال نمی‌شود.")+'</p>':"")+
      '<div class="commerce-order-meta"><span>'+t("Created","ثبت")+": "+date(order.creation)+'</span><span>'+t("Payment reference","کد پیگیری پرداخت")+': <b dir="ltr">'+esc(order.payment_reference||"—")+'</b></span></div>'+
      itemsHTML(order.items,shop)+'<dl class="commerce-totals"><div><dt>'+t("Subtotal","جمع کالاها")+'</dt><dd>'+money(order.subtotal)+'</dd></div><div><dt>'+t("Shipping","هزینه ارسال")+'</dt><dd>'+money(order.shipping_fee)+'</dd></div><div class="commerce-grand"><dt>'+t("Total","مبلغ کل")+'</dt><dd>'+money(order.total_amount)+'</dd></div></dl>'+
      '<section class="commerce-address"><h3>'+t("Delivery address","آدرس تحویل")+'</h3><strong>'+esc(order.recipient_name)+'</strong><p>'+esc(order.province)+"، "+esc(order.city)+" — "+esc(order.address)+'</p><small dir="ltr">'+esc(order.mobile)+" · "+esc(order.postal_code)+'</small>'+(order.customer_notes?'<p>'+esc(order.customer_notes)+'</p>':"")+
      '<p>'+t("Postal tracking","کد رهگیری پستی")+': <b dir="ltr">'+esc(order.tracking_code||"—")+'</b>'+ (order.shipping_company?" · "+esc(order.shipping_company):"")+'</p></section>'+
      '<section class="commerce-history"><h3>'+t("Order history","تاریخچه سفارش")+'</h3>'+order.events.map(ev=>'<div><i></i><strong>'+esc(ev.event_type==="fulfillment"?stage(ev.message):ev.message==="Stock allocated"?t("Stock allocated","موجودی تأمین شد"):payment(ev.message))+'</strong><time>'+date(ev.occurred_at)+'</time></div>').join("")+'</section>';
  }
  async function orders(panel,embedded=false){
    let start=0,busy=false,name=embedded?null:params().get("order");const alive=()=>panel.isConnected;
    async function load(){
      if(busy||!alive())return;busy=true;panel.setAttribute("aria-busy","true");
      try{
        const data=await get("mine",name?{name}:{start});if(!alive())return;
        if(name){
          const order=data.order;
          panel.innerHTML='<div class="commerce-toolbar"><button class="button ghost" data-order-back>'+t("All orders","همه سفارش‌ها")+'</button>'+ (order.payment_status!=="Paid"?'<button class="button primary" data-order-reconcile="'+esc(order.name)+'">'+t("Check payment status","بررسی وضعیت پرداخت")+'</button>':"")+'<a class="button ghost" href="'+esc(shopLink())+'">'+t("Back to shop","بازگشت به فروشگاه")+'</a></div><section class="commerce-panel">'+detailHTML(order)+'</section><p class="commerce-status" role="status"></p>';
        }else{
          panel.innerHTML='<div class="commerce-order-list">'+(data.orders.length?data.orders.map(order=>'<article class="commerce-order-card"><div><a href="#/orders?order='+encodeURIComponent(order.name)+'" dir="ltr">'+esc(order.name)+'</a><small>'+date(order.creation)+'</small><div>'+statusHTML(order)+'</div></div><div><strong>'+money(order.total_amount)+'</strong><small>'+num(order.total_qty)+" "+t("items","عدد")+'</small><a class="button ghost" href="#/orders?order='+encodeURIComponent(order.name)+'">'+t("Details","جزئیات")+'</a></div></article>').join(""):'<div class="commerce-empty">'+box+'<h3>'+t("No orders yet","هنوز سفارشی ثبت نکرده‌اید")+'</h3><a class="button primary" href="'+esc(shopLink())+'">'+t("Visit shop","رفتن به فروشگاه")+'</a></div>')+'</div>'+
            '<div class="commerce-pagination"><button class="button ghost" data-order-prev '+(!start?"disabled":"")+'>'+t("Previous","قبلی")+'</button><span>'+num(start/20+1)+'</span><button class="button ghost" data-order-next '+(!data.has_more?"disabled":"")+'>'+t("Next","بعدی")+'</button></div><p class="commerce-status" role="status"></p>';
        }
      }catch(e){if(alive())panel.innerHTML='<p class="commerce-status" role="alert">'+esc(error(e))+'</p><button class="button ghost" data-order-refresh>'+t("Refresh","تازه‌سازی")+'</button>';}
      finally{busy=false;if(alive())panel.removeAttribute("aria-busy");}
    }
    panel.addEventListener("click",async event=>{
      const button=event.target.closest("button");if(!button||busy)return;
      if(button.hasAttribute("data-order-back")){name=null;history.replaceState(null,"","#/orders");load();}
      else if(button.hasAttribute("data-order-prev")){start=Math.max(0,start-20);load();}
      else if(button.hasAttribute("data-order-next")){start+=20;load();}
      else if(button.hasAttribute("data-order-refresh"))load();
      else if(button.dataset.orderReconcile){
        busy=true;button.disabled=true;
        try{await api("reconcile",{name:button.dataset.orderReconcile});busy=false;load();}
        catch(e){panel.querySelector(".commerce-status").textContent=error(e);}
        finally{busy=false;button.disabled=false;}
      }
    });
    load();
  }
  function mountProfile(main){
    if(!main||main.querySelector("#profileOrders"))return;
    const section=document.createElement("section");section.id="profileOrders";section.className="profile-panel commerce-profile-orders";
    section.innerHTML='<div class="profile-panel-heading">'+box+'<div><h3>'+t("My orders","سفارش‌های من")+'</h3><p>'+t("Payments, fulfillment and postal tracking.","پرداخت‌ها، وضعیت آماده‌سازی و رهگیری پستی.")+'</p></div><a class="button ghost" href="#/orders">'+t("View all","مشاهده همه")+'</a></div><div data-orders-body></div>';
    main.append(section);orders(section.querySelector("[data-orders-body]"),true);
  }
  async function checkout(container){
    const cart=params().get("cart")||"";
    if(!/^[A-Za-z0-9_-]{48}$/.test(cart)){container.innerHTML='<section class="wrap commerce-page"><div class="commerce-panel"><h1>'+t("Your basket is needed","ابتدا سبد خرید را تکمیل کنید")+'</h1><a class="button primary" href="'+esc(shopLink())+'">'+t("Go to basket","رفتن به سبد")+'</a></div></section>';return;}
    const page=document.createElement("section");page.className="wrap commerce-page";container.replaceChildren(page);
    page.innerHTML='<div class="commerce-empty">'+t("Loading checkout…","در حال دریافت اطلاعات پرداخت…")+'</div>';
    try{
      const [summary,session]=await Promise.all([get("preview",{cart_token:cart}),window.AS_ACCOUNT.request("as_industries.account.session",undefined,"GET")]);
      if(!page.isConnected)return;
      if(summary.closed){page.innerHTML='<div class="commerce-panel"><h2>'+t("This basket was already checked out","این سبد قبلاً به سفارش تبدیل شده است")+'</h2><a class="button primary" href="#/orders">'+t("View my orders","مشاهده سفارش‌ها")+'</a></div>';return;}
      const ready=summary.settings.ready,user=session.user;
      const field=(name,label,type="text",value="",extra="")=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+' required></label>';
      page.innerHTML='<div class="commerce-page-title"><div><small>AS INDUSTRIES / CHECKOUT</small><h1>'+t("Complete your purchase","تکمیل خرید")+'</h1></div><span class="commerce-secure">'+lock+t("Bank gateway checkout","پرداخت از درگاه بانکی")+'</span></div><div class="commerce-checkout-grid">'+
        '<section class="commerce-panel"><div class="commerce-panel-title">'+box+'<div><h2>'+t("Order summary","خلاصه سفارش")+'</h2><p>'+t("Products and prices from your basket","محصولات و قیمت‌های سبد خرید شما")+'</p></div></div>'+itemsHTML(summary.items)+
        '<dl class="commerce-totals"><div><dt>'+t("Subtotal","جمع کالاها")+'</dt><dd>'+money(summary.subtotal)+'</dd></div><div><dt>'+t("Shipping","هزینه ارسال")+'</dt><dd>'+money(summary.shipping_fee)+'</dd></div><div class="commerce-grand"><dt>'+t("Total","مبلغ کل")+'</dt><dd>'+money(summary.total_amount)+'</dd></div></dl>'+
        (summary.settings.shipping_description?'<p class="commerce-notice">'+esc(summary.settings.shipping_description)+'</p>':"")+'<a class="commerce-back" href="'+esc(shopLink())+'">'+t("Edit basket","ویرایش سبد خرید")+'</a></section>'+
        '<section class="commerce-panel"><div class="commerce-panel-title">'+lock+'<div><h2>'+t("Payment details","اطلاعات پرداخت")+'</h2><p>'+t("Iranian bank cards through the gateway","پرداخت با کارت‌های بانکی ایرانی از طریق درگاه")+'</p></div></div>'+
        (summary.settings.sandbox?'<p class="commerce-notice">'+t("Sandbox mode: no real purchase or dispatch.","حالت آزمایشی: خرید و ارسال واقعی انجام نمی‌شود.")+'</p>':"")+
        (!ready?'<p class="commerce-notice" role="status">'+t("Online payment is not configured yet. You can review your basket; payment becomes available when the administrator connects the gateway.","درگاه هنوز تنظیم نشده است. پس از اتصال درگاه توسط مدیر، پرداخت فعال می‌شود.")+'</p>':"")+
        (!user?'<div class="commerce-signin"><p>'+t("Sign in or create an account to save and track your order.","برای ثبت و پیگیری سفارش وارد حساب شوید یا حساب بسازید.")+'</p><a class="button primary" href="#/account?mode=password&return='+encodeURIComponent("/checkout?cart="+cart)+'">'+t("Sign in","ورود")+'</a><a class="button ghost" href="#/account?mode=signup&return='+encodeURIComponent("/checkout?cart="+cart)+'">'+t("Create account","ساخت حساب")+'</a></div>':"")+
        '<form id="commerce-payment-form"><fieldset '+(!user?"disabled":"")+'><legend>'+t("Delivery information","اطلاعات تحویل")+'</legend><div class="commerce-fields">'+
        field("recipient_name",t("Recipient name","نام گیرنده"),"text",[user?.first_name,user?.last_name].filter(Boolean).join(" "),'autocomplete="name" maxlength="140"')+
        field("mobile",t("Mobile number","شماره موبایل"),"tel",user?.mobile_no||user?.phone||"",'autocomplete="tel" dir="ltr" maxlength="20"')+
        field("province",t("Province","استان"),"text","","autocomplete=\"address-level1\" maxlength=\"140\"")+
        field("city",t("City","شهر"),"text","","autocomplete=\"address-level2\" maxlength=\"140\"")+
        '<label class="commerce-wide">'+t("Full address","آدرس کامل")+'<textarea name="address" autocomplete="street-address" rows="3" maxlength="1000" required></textarea></label>'+
        field("postal_code",t("Postal code","کد پستی"),"text","","inputmode=\"numeric\" dir=\"ltr\" maxlength=\"10\" autocomplete=\"postal-code\"")+
        '<label>'+t("Delivery notes (optional)","توضیحات تحویل (اختیاری)")+'<input name="customer_notes" maxlength="1000"></label></div>'+
        '<h3>'+t("Payment method","روش پرداخت")+'</h3><div class="commerce-gateway">'+lock+'<div><strong>'+ (summary.settings.provider==="Zarinpal"?t("Zarinpal","زرین‌پال"):t("Zibal","زیبال"))+'</strong><small>'+t("Iranian bank cards","کارت‌های بانکی عضو شتاب")+'</small></div><span>●</span></div>'+
        '<p class="commerce-notice">'+t("Enter your card information on the bank gateway. This website does not receive your card number, CVV2 or bank password.","اطلاعات کارت را در صفحه درگاه وارد می‌کنید. سایت شماره کارت، CVV2 و رمز بانکی را دریافت نمی‌کند.")+'</p>'+
        '<button class="button primary commerce-pay" type="submit" '+(!ready?"disabled":"")+'>'+lock+t("Pay ","پرداخت ")+money(summary.total_amount)+'</button></fieldset><p class="commerce-status" role="status" aria-live="polite"></p></form></section></div>';
      let busy=false;
      page.querySelector("form").addEventListener("submit",async event=>{
        event.preventDefault();const form=event.target;if(busy||!ready||!user||!form.reportValidity())return;
        busy=true;const button=form.querySelector("[type=submit]");button.disabled=true;
        const status=form.querySelector(".commerce-status");status.textContent=t("Saving order and opening the gateway…","در حال ثبت سفارش و اتصال به درگاه…");
        try{
          const result=await api("payment_start",{cart_token:cart,shipping:Object.fromEntries(new FormData(form)),language:fa()?"fa":"en"});
          if(result.redirect_url){
            const destination=new URL(result.redirect_url);const allowed=["www.zarinpal.com","sandbox.zarinpal.com","gateway.zibal.ir"];
            if(destination.protocol!=="https:"||!allowed.includes(destination.hostname))throw Error(t("Invalid gateway destination.","آدرس درگاه معتبر نیست."));
            location.assign(destination.href);
          }else if(result.order){
            status.textContent=result.message?error({message:result.message}):t("Open your order to check its status.","وضعیت سفارش را بررسی کنید.");
            const link=document.createElement("a");link.className="button ghost";link.href="#/orders?order="+encodeURIComponent(result.order.name);link.textContent=t("View saved order","مشاهده سفارش ثبت‌شده");status.append(link);
          }
        }catch(e){status.textContent=error(e);}
        finally{busy=false;button.disabled=false;}
      });
    }catch(e){if(page.isConnected)page.innerHTML='<div class="commerce-panel"><p role="alert">'+esc(error(e))+'</p><a class="button primary" href="'+esc(shopLink())+'">'+t("Back to basket","بازگشت به سبد")+'</a></div>';}
  }
  function mount(path,container){
    if(path==="/checkout"){checkout(container);return;}
    const page=document.createElement("section");page.className="wrap commerce-page";
    page.innerHTML='<div class="commerce-page-title"><h1>'+t("My orders","سفارش‌های من")+'</h1><a class="button ghost" href="#/profile">'+t("My profile","پروفایل من")+'</a></div><div data-orders-body></div>';container.replaceChildren(page);
    window.AS_ACCOUNT.request("as_industries.account.session",undefined,"GET").then(state=>{
      if(!page.isConnected)return;
      if(!state.user){page.querySelector("[data-orders-body]").innerHTML='<div class="commerce-panel"><a class="button primary" href="#/account?mode=password&return='+encodeURIComponent("/orders"+(params().get("order")?"?order="+params().get("order"):""))+'">'+t("Sign in to view orders","برای مشاهده سفارش‌ها وارد شوید")+'</a></div>';return;}
      orders(page.querySelector("[data-orders-body]"));
      window.AS_FIGURES?.mountOrders(page);
    }).catch(e=>{if(page.isConnected)page.querySelector("[data-orders-body]").textContent=error(e);});
  }
  window.AS_COMMERCE={owns:path=>["/checkout","/orders"].includes(path),mount,mountProfile,detailHTML,statusHTML,t,esc,money,date,payment,stage,error};
})();
