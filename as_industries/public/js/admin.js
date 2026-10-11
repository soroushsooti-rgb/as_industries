/* AS management shell: existing Frappe sessions, permissions and documents. */
(() => {
  "use strict";
  const boot = JSON.parse(document.getElementById("admin-config").textContent);
  const root = document.getElementById("admin-root");
  const fa = boot.language === "fa", t = (en, persian) => fa ? persian : en;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = n => n == null ? "—" : new Intl.NumberFormat(fa ? "fa-IR" : "en-US", {maximumFractionDigits:1}).format(n);
  const date = value => {
    if (!value) return "—";
    const d = new Date(String(value).replace(" ","T"));
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(fa ? "fa-IR" : "en-US", {year:"numeric",month:"short",day:"numeric"});
  };
  const path = {
    dashboard:'<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
    requests:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M8 12h8m-8 4h5"/>',
    production:'<path d="M4 10h16v10H4ZM7 10V5l5 3V5l5 3v2M8 14v2m4-2v2m4-2v2"/>',
    machines:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8v8H8ZM8 18h8"/>',
    materials:'<path d="m4 7 8-4 8 4v10l-8 4-8-4Zm0 0 8 4 8-4m-8 4v10"/>',
    inventory:'<path d="M3 8h18v13H3ZM3 8l3-5h12l3 5m-11 4h4"/>',
    quality:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6"/>',
    reports:'<path d="M4 3h12l4 4v14H4Zm12 0v5h4M8 16v-3m4 3V9m4 7v-5"/>',
    users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-18a3 3 0 0 1 0 6m3 12v-3a6 6 0 0 0-3-5"/>',
    settings:'<path d="m9 3-1 3-3 1-2 3 2 3-1 3 3 2 3-1 3 2 3-2 1-3 3-1 1-3-2-3 1-3-3-2-3 1Z"/><circle cx="12" cy="11" r="3"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0v6l-3 3h18l-3-3ZM10 21h4"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    down:'<path d="m6 9 6 6 6-6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    logout:'<path d="M9 3H3v18h6m5-15 6 6-6 6M7 12h13"/>',
    refresh:'<path d="M20 8a8 8 0 1 0 1 7m-1-12v5h-5"/>'
  };
  const icon = n => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (path[n] || path.requests) + '</svg>';
  const sections = {
    dashboard:[t("Dashboard","داشبورد"),"dashboard"],
    requests:[t("Manufacturing Requests","درخواست‌های ساخت"),"requests"],
    production:[t("Production","تولید"),"production"],
    machines:[t("Machines","دستگاه‌ها"),"machines"],
    materials:[t("Materials","مواد اولیه"),"materials"],
    inventory:[t("Inventory","موجودی و محصولات"),"inventory"],
    quality:[t("Quality Control","کنترل کیفیت"),"quality"],
    reports:[t("Reports","گزارش‌ها"),"reports"],
    users:[t("Users","کاربران"),"users"],
    settings:[t("Settings","تنظیمات"),"settings"]
  };
  const wordmark = '<span class="as-wordmark" dir="ltr">AS<span>INDUSTRIES</span></span>';
  let data, current="dashboard", query="", start=0, hasMore=false, generation=0, searchTimer;
  const links = {
    website:boot.urls.as,
    profile:boot.urls.as + "?lang=" + boot.language + "#/profile",
    user:"/app/user",
    settings:"/app/system-settings",
    websiteSettings:"/app/website-settings",
    sms:"/app/sms-settings",
    google:"/app/social-login-key"
  };
  function shopLink(route) {
    const u = new URL(boot.urls.shop, location.origin);
    u.pathname = route; u.hash=""; u.search="";
    return u.href;
  }
  const rowLink = (doctype, name) => "/app/" + doctype.toLowerCase().replace(/ /g,"-") + "/" + encodeURIComponent(name);
  const setStatus = value => { const el=document.getElementById("admin-status"); if(el) el.textContent=value; };
  function errorText(error) {
    if(error.status===403) return t("Your account cannot access this management panel.","حساب شما دسترسی به پنل مدیریت ندارد.");
    if(error.status===401) return t("Sign in again to continue.","برای ادامه دوباره وارد شوید.");
    return t("The data could not be loaded. Try again.","اطلاعات بارگذاری نشد؛ دوباره تلاش کنید.");
  }
  async function get(method, values={}) {
    const params = new URLSearchParams(values).toString();
    return window.AS_ACCOUNT.request("as_industries.admin."+method+(params?"?"+params:""),undefined,"GET");
  }
  function access() {
    root.innerHTML = '<main class="access-card">'+wordmark+'<h1>'+t("AS management panel","پنل مدیریت AS")+'</h1><p>'+
      (boot.logged_in ? t("Your account does not have administrator access.","حساب شما دسترسی مدیریتی ندارد.") :
      t("Sign in with your administrator account to continue.","برای ادامه با حساب مدیر وارد شوید."))+
      '</p><a class="primary-button" href="/login?redirect-to=%2Fas-admin">'+t("Administrator sign in","ورود مدیر")+
      '</a><a class="outline-button" href="'+esc(links.website)+'">'+t("Website","وب‌سایت")+'</a></main>';
  }
  function layout() {
    const name=[data.user.first_name,data.user.last_name].filter(Boolean).join(" ") || data.user.username || t("Administrator","مدیر");
    const photo=data.user.user_image;
    const avatar=photo && photo.startsWith("/") && !photo.startsWith("//") ?
      '<img src="'+esc(photo)+'" alt="">' : esc(name.slice(0,1));
    root.innerHTML='<div class="admin-shell"><button class="admin-nav-backdrop" id="nav-backdrop" aria-label="'+t("Close menu","بستن منو")+'"></button><aside class="admin-sidebar" id="admin-sidebar"><a class="admin-brand" href="'+esc(links.website)+'" aria-label="AS Industries"><div>'+wordmark+'<small>ADDITIVE MANUFACTURING</small></div></a><nav class="admin-nav" aria-label="'+t("Management navigation","منوی مدیریت")+'">'+
      Object.entries(sections).map(([id,[label,symbol]])=>'<a href="#/'+id+'" data-section="'+id+'">'+icon(symbol)+'<span>'+label+'</span></a>').join("")+
      '</nav><div class="admin-sidebar-bottom"><span class="online-dot"></span>'+t("Connected","متصل")+'<small>'+t("AS management workspace","فضای مدیریت AS")+'</small></div></aside>'+
      '<div class="admin-main"><header class="admin-topbar"><button class="menu-toggle icon-button" id="menu-toggle" aria-expanded="false" aria-controls="admin-sidebar" aria-label="'+t("Open menu","باز کردن منو")+'">'+icon("menu")+'</button>'+
      '<label class="search-box">'+icon("search")+'<input id="admin-search" type="search" autocomplete="off" aria-label="'+t("Search this section","جست‌وجو در این بخش")+'" placeholder="'+t("Search this section…","جست‌وجو در این بخش…")+'"></label>'+
      '<div class="topbar-actions"><button id="notifications-toggle" class="icon-button" aria-expanded="false" aria-controls="notification-popover" aria-label="'+t("Notifications","اعلان‌ها")+'">'+icon("bell")+(data.new_users_count?'<i class="notification-dot"></i>':"")+'</button>'+
      '<button class="user-menu-button" id="user-menu-toggle" aria-expanded="false" aria-controls="user-popover"><span class="mini-avatar">'+avatar+'</span><span class="user-label"><strong>'+esc(name)+'</strong><small>'+t("Administrator","مدیر سیستم")+'</small></span>'+icon("down")+'</button></div>'+
      '<div class="popover" id="notification-popover" hidden><strong>'+t("Recent activity","فعالیت اخیر")+'</strong><p>'+num(data.new_users_count)+" "+t("new accounts in the last 7 days.","حساب جدید در ۷ روز گذشته.")+'</p><a href="#/users">'+icon("users")+t("View users","مشاهده کاربران")+'</a></div>'+
      '<div class="popover" id="user-popover" hidden><a href="'+esc(links.profile)+'">'+icon("user")+t("My profile","پروفایل من")+'</a><a href="/app">'+icon("settings")+t("Frappe Desk","مدیریت اطلاعات")+'</a><button id="admin-logout">'+icon("logout")+t("Sign out","خروج")+'</button></div></header>'+
      '<main id="admin-content" class="admin-content" tabindex="-1"><div id="admin-view"></div><p id="admin-status" class="admin-status" role="status" aria-live="polite"></p><footer class="admin-footer"><span><b class="footer-stripes">////</b>ADDITIVE MANUFACTURING / PROTOTYPE / LOW VOLUME / ON DEMAND</span><span>TURNING IDEAS INTO REALITY</span></footer></main></div></div>';
    document.getElementById("menu-toggle").addEventListener("click",()=>{
      const open=root.classList.toggle("nav-open");
      document.getElementById("menu-toggle").setAttribute("aria-expanded",String(open));
    });
    document.getElementById("nav-backdrop").addEventListener("click",()=>{
      root.classList.remove("nav-open");
      document.getElementById("menu-toggle").setAttribute("aria-expanded","false");
    });
    for(const [button,popover] of [["notifications-toggle","notification-popover"],["user-menu-toggle","user-popover"]]) {
      document.getElementById(button).addEventListener("click",()=>{
        const el=document.getElementById(popover), show=el.hidden;
        closeMenus();el.hidden=!show;document.getElementById(button).setAttribute("aria-expanded",String(show));
      });
    }
    document.getElementById("admin-search").addEventListener("input", e=>{
      query=e.target.value.trim().toLowerCase();start=0;
      clearTimeout(searchTimer);searchTimer=setTimeout(()=>current==="inventory"?window.AS_INVENTORY.search(query):render(),250);
    });
    document.getElementById("admin-logout").addEventListener("click",async e=>{
      e.currentTarget.disabled=true;
      try{await window.AS_ACCOUNT.request("logout");location.replace("/login?redirect-to=%2Fas-admin");}
      catch(error){setStatus(errorText(error));e.target.closest("button").disabled=false;}
    });
  }
  function closeMenus() {
    for(const [button,popover] of [["notifications-toggle","notification-popover"],["user-menu-toggle","user-popover"]]) {
      const el=document.getElementById(popover);if(el)el.hidden=true;
      document.getElementById(button)?.setAttribute("aria-expanded","false");
    }
  }
  const statusCategory = v => ({"in production":"production","production":"production","in progress":"production","completed":"completed","done":"completed","on hold":"hold","cancelled":"cancelled","canceled":"cancelled"}[String(v||"").toLowerCase()]||"new");
  function tag(value) {
    const category=statusCategory(value);
    const labels={production:t("In Production","در حال تولید"),completed:t("Completed","تکمیل شده"),hold:t("On Hold","متوقف"),cancelled:t("Cancelled","لغو شده"),new:esc(value||t("New","جدید"))};
    return '<span class="status-tag '+category+'">'+labels[category]+'</span>';
  }
  const matches = row => !query || Object.values(row).some(v=>String(v??"").toLowerCase().includes(query));
  function recordTable(source, limit) {
    const rows=source.rows.filter(matches).slice(0,limit||1000);
    return '<div class="table-scroll"><table><thead><tr>'+[t("ID","شناسه"),t("PART NAME","نام قطعه"),t("MATERIAL","متریال"),t("TECHNOLOGY","تکنولوژی"),t("QUANTITY","تعداد"),t("STATUS","وضعیت"),t("REQUESTED","تاریخ ثبت"),t("ACTIONS","عملیات")].map(s=>'<th scope="col">'+s+'</th>').join("")+'</tr></thead><tbody>'+
      (rows.length?rows.map(r=>'<tr><td dir="ltr">'+esc(r.name)+'</td><td>'+esc(r.title||r.part_name||r.name)+'</td><td>'+esc(r.material||"—")+'</td><td>'+esc(r.technology||"—")+'</td><td>'+num(r.quantity??r.qty)+'</td><td>'+tag(r.status)+'</td><td>'+date(r.creation)+'</td><td><a href="'+esc(rowLink(source.doctype,r.name))+'" aria-label="'+t("Open record","باز کردن رکورد")+' '+esc(r.name)+'">'+icon("arrow")+'</a></td></tr>').join("") :
      '<tr><td colspan="8" class="empty-cell">'+icon("requests")+'<strong>'+ (query?t("No matching records.","رکوردی مطابق جست‌وجو پیدا نشد."):t("No manufacturing requests yet.","هنوز درخواست ساختی ثبت نشده است."))+'</strong>'+
      (source.available?t("New records will appear here.","رکوردهای جدید اینجا نمایش داده می‌شوند."):t("Manufacturing data has not been connected yet.","داده‌های ساخت هنوز به پنل متصل نشده‌اند."))+'</td></tr>')+'</tbody></table></div>';
  }
  function stat(symbol,label,value,note) {
    return '<article class="stat-card"><div class="stat-icon">'+icon(symbol)+'</div><span class="stat-label">'+label+'</span><strong class="stat-value">'+value+'</strong><p class="stat-note">'+note+'</p></article>';
  }
  function donut(total, values, labels, center, available) {
    const colors=["#b6ef27","#72b635","#727e86","#3f494e","#c5d6d9"];
    let offset=0;
    const gradient=total?values.map((v,i)=>{const next=offset+100*v/total;const part=colors[i]+" "+offset+"% "+next+"%";offset=next;return part;}).join(","):"#303a3f 0% 100%";
    return '<div class="donut-body"><div class="donut" style="background:conic-gradient('+gradient+')"><div class="donut-label"><strong>'+ (available?center:"—")+'</strong><small>'+t("Total","مجموع")+'</small></div></div><div class="legend">'+labels.map((s,i)=>'<div class="legend-item"><i style="background:'+colors[i]+'"></i><span>'+s+'</span><b>'+num(available?values[i]:null)+'</b></div>').join("")+'</div></div>';
  }
  function lineChart() {
    const values=data.trend.map(r=>r.quantity),max=Math.max(1,...values);
    const points=values.map((v,i)=>[30+i*42,130-v/max*105]);
    const line=points.map((p,i)=>(i?"L":"M")+p.join(",")).join(" ");
    return '<svg class="line-chart" viewBox="0 0 300 163" role="img" aria-label="'+t("Production volume for the last seven days","حجم تولید در هفت روز گذشته")+'"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b6ef27" stop-opacity=".23"/><stop offset="100%" stop-color="#b6ef27" stop-opacity="0"/></linearGradient></defs>'+
      [0,1,2,3].map(i=>'<path d="M30 '+(25+i*35)+'H292" stroke="#253036" stroke-width=".5"/><text x="3" y="'+(29+i*35)+'">'+(data.trend_available?num(Math.round(max*(1-i/3))):"—")+'</text>').join("")+
      (data.trend_available?'<path d="'+line+' L282,132 L30,132Z" fill="url(#chart-fill)"/><path d="'+line+'" fill="none" stroke="#b6ef27" stroke-width="1.5"/>'+points.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="2.6" fill="#b6ef27"/>').join(""):"")+
      data.trend.map((r,i)=>'<text x="'+(30+i*42)+'" y="155" text-anchor="middle">'+esc(new Date(r.date+"T12:00:00").toLocaleDateString(fa?"fa-IR":"en-US",{month:"short",day:"numeric"}))+'</text>').join("")+'</svg>';
  }
  function dashboardView() {
    const available=data.request_data.available,s=data.statuses,total=data.request_data.rows.length;
    const note=available?t("Recorded requests","درخواست‌های ثبت‌شده"):t("Awaiting manufacturing data","در انتظار اتصال داده‌های تولید");
    return '<section class="admin-hero"><img src="/assets/as_industries/media/admin/hero.png" alt="'+t("3D printing a precision component","چاپ سه‌بعدی یک قطعه صنعتی")+'"><div class="hero-shade"></div><div class="hero-copy"><small>'+t("WELCOME BACK","به پنل مدیریت خوش آمدید")+'</small><h1>'+t("3D Printing Manufacturing","مدیریت ساخت و چاپ سه‌بعدی")+'</h1><p>'+t("Track production, manage requests, and keep your manufacturing moving smoothly.","درخواست‌ها، روند تولید و اطلاعات مجموعه را از یک پنل مدیریت کنید.")+'</p></div><div class="hero-motto" dir="ltr">FASTER<br>SMARTER<br>STRONGER</div></section>'+
      '<div class="stats-grid">'+stat("materials",t("Total Requests","کل درخواست‌ها"),num(available?total:null),note)+stat("settings",t("In Production","در حال تولید"),num(available?s.production:null),note)+stat("check",t("Completed","تکمیل شده"),num(available?s.completed:null),note)+stat("clock",t("Avg. Lead Time","میانگین زمان ساخت"),num(data.lead_time)+(data.lead_time!=null?" "+t("days","روز"):""),t("From recorded completion dates","بر اساس تاریخ تکمیل ثبت‌شده"))+'</div>'+
      '<div class="charts-grid"><section class="panel"><div class="panel-heading"><div><h2>'+t("Production Volume","حجم تولید")+'</h2><p class="panel-subtitle">'+t("Parts completed per day","قطعات تکمیل‌شده در هر روز")+'</p></div><span class="small-chip">'+t("Last 7 days","۷ روز گذشته")+'</span></div>'+lineChart()+(!data.trend_available?'<p class="chart-empty">'+t("Awaiting completed production records","در انتظار اطلاعات تکمیل تولید")+'</p>':"")+'</section>'+
      '<section class="panel"><h2>'+t("Request Status","وضعیت درخواست‌ها")+'</h2><p class="panel-subtitle">'+t("Overview of manufacturing requests","نمای کلی درخواست‌های ساخت")+'</p>'+donut(total,[s.production,s.completed,s.hold,s.cancelled,s.new],[t("In Production","در تولید"),t("Completed","تکمیل"),t("On Hold","متوقف"),t("Cancelled","لغو"),t("New","جدید")],num(total),available)+'</section>'+
      '<section class="panel"><h2>'+t("Printer Utilization","وضعیت دستگاه‌ها")+'</h2><p class="panel-subtitle">'+t("Active printers / total","دستگاه‌های فعال / کل")+'</p>'+donut(data.machine_data.rows.length,Object.values(data.machine_status),[t("Online","فعال"),t("Offline","غیرفعال"),t("Maintenance","تعمیرات"),t("Unknown","نامشخص")],num(data.machine_status.online)+"/"+num(data.machine_data.rows.length),data.machine_data.available)+'</section></div>'+
      '<section class="panel table-panel"><div class="table-heading"><h2>'+icon("inventory")+t("Recent Manufacturing Requests","آخرین درخواست‌های ساخت")+'</h2><a class="outline-button" href="#/requests">'+t("View All Requests","همه درخواست‌ها")+icon("arrow")+'</a></div>'+recordTable(data.request_data,8)+'</section>';
  }
  const title = (id, subtitle="",action="") => '<div class="section-title"><div><h1>'+sections[id][0]+'</h1><p>'+subtitle+'</p></div>'+action+'</div>';
  const quickCard = (symbol,name,description,href,label=t("Open management","باز کردن مدیریت")) =>
    '<article class="panel quick-card">'+icon(symbol)+'<h2>'+name+'</h2><p>'+description+'</p><a class="outline-button" href="'+esc(href)+'">'+label+icon("arrow")+'</a></article>';
  function inventoryView() {
    return '<section id="inventory-panel" class="inventory-panel"><div class="loading-panel"><span class="spinner"></span>'+t("Loading products…","در حال بارگذاری محصولات…")+'</div></section>';
  }
  function settingsView() {
    return title("settings",t("Manage your existing AS website settings.","مدیریت تنظیمات فعلی وب‌سایت AS."))+
      '<div class="quick-grid">'+quickCard("settings",t("System settings","تنظیمات سیستم"),t("Language, time zone and account policies.","زبان، منطقه زمانی و تنظیمات حساب‌ها."),links.settings)+
      quickCard("dashboard",t("Website settings","تنظیمات سایت"),t("Registration and website preferences.","ثبت‌نام و تنظیمات وب‌سایت."),links.websiteSettings)+
      quickCard("user",t("SMS settings","تنظیمات پیامک"),t("Configure the sms.ir connection.","تنظیم اتصال به sms.ir."),links.sms)+
      quickCard("quality",t("Google sign in","ورود گوگل"),t("Manage the existing social login settings.","مدیریت تنظیمات ورود با گوگل."),links.google)+
      quickCard("users",t("Users & access","کاربران و دسترسی"),t("Manage users with Frappe permissions.","مدیریت کاربران با مجوزهای استاندارد."),links.user)+
      quickCard("user",t("My account","حساب من"),t("Profile photo and password settings.","عکس پروفایل و تنظیمات رمز."),links.profile)+'</div>';
  }
  function reportsView() {
    const available=data.request_data.available;
    return title("reports",t("Reports use the records available in this workspace.","گزارش‌ها بر اساس اطلاعات ثبت‌شده این مجموعه هستند."))+
      '<div class="report-grid">'+stat("users",t("Registered accounts","حساب‌های ثبت‌شده"),num(data.users_count),t("This website","در این سایت"))+
      stat("user",t("New accounts","حساب‌های جدید"),num(data.new_users_count),t("Last 7 days","۷ روز گذشته"))+
      stat("requests",t("Manufacturing requests","درخواست‌های ساخت"),num(available?data.request_data.rows.length:null),t("Current data","داده‌های موجود"))+
      stat("check",t("Completed requests","درخواست‌های تکمیل‌شده"),num(available?data.statuses.completed:null),t("Current data","داده‌های موجود"))+'</div><div class="report-footer"><button class="primary-button" id="download-summary">'+icon("reports")+t("Download summary CSV","دریافت خلاصه CSV")+'</button><span>'+t("Updated","به‌روزرسانی")+": "+date(data.updated_at)+'</span></div>';
  }
  function usersTable(payload) {
    hasMore=payload.has_more;
    return title("users",t("Search and manage the accounts stored in the database.","جست‌وجو و مدیریت حساب‌های ذخیره‌شده در دیتابیس."),
      '<a class="outline-button" href="/app/user">'+t("Manage users","مدیریت کاربران")+icon("arrow")+'</a>')+
      '<section class="panel table-panel"><div class="table-scroll"><table><thead><tr>'+
      [t("NAME","نام"),t("USERNAME","نام کاربری"),t("EMAIL","ایمیل"),t("MOBILE","موبایل"),t("TYPE","نوع حساب"),t("STATUS","وضعیت"),t("CREATED","تاریخ ساخت"),t("ACTIONS","عملیات")].map(s=>'<th scope="col">'+s+'</th>').join("")+
      '</tr></thead><tbody>'+(payload.rows.length?payload.rows.map(u=>'<tr><td>'+esc([u.first_name,u.last_name].filter(Boolean).join(" ")||u.name)+'</td><td dir="ltr">'+esc(u.username||"—")+'</td><td dir="ltr">'+esc((u.email||"").endsWith("@as-account.invalid")?"—":u.email||"—")+'</td><td dir="ltr">'+esc(u.mobile_no||u.phone||"—")+'</td><td>'+ (u.user_type==="System User"?t("System","سیستم"):t("Customer","مشتری"))+'</td><td><span class="status-tag '+(u.enabled?"completed":"hold")+'">'+(u.enabled?t("Enabled","فعال"):t("Disabled","غیرفعال"))+'</span></td><td>'+date(u.creation)+'</td><td><a class="outline-button" href="'+esc(rowLink("User",u.name))+'">'+t("Edit","ویرایش")+'</a></td></tr>').join(""):'<tr><td colspan="8" class="empty-cell">'+t("No matching users.","کاربری مطابق جست‌وجو پیدا نشد.")+'</td></tr>')+
      '</tbody></table></div><div class="pagination"><span>'+t("Page","صفحه")+" "+num(start/25+1)+'</span><div><button class="outline-button" id="previous-page" '+(start?"":"disabled")+'>'+t("Previous","قبلی")+'</button><button class="outline-button" id="next-page" '+(hasMore?"":"disabled")+'>'+t("Next","بعدی")+'</button></div></div></section>';
  }
  function collectionView(id,source) {
    if(id==="requests") return title(id,source.limited?t("Showing the latest 1,000 records.","نمایش آخرین ۱۰۰۰ رکورد."):t("Manufacturing requests recorded in this workspace.","درخواست‌های ساخت ثبت‌شده این مجموعه."))+
      '<section class="panel table-panel">'+recordTable(source)+'</section>';
    if(!source.available || !source.rows.length) return title(id)+
      '<section class="panel empty-panel">'+icon(sections[id][1])+'<h2>'+t("No records available yet","هنوز اطلاعاتی ثبت نشده است")+'</h2><p>'+
      (source.available?t("New records will appear in this section.","رکوردهای جدید در این بخش نمایش داده می‌شوند."):t("This section is ready to display your manufacturing data once connected.","این بخش پس از اتصال اطلاعات مجموعه، رکوردها را نمایش می‌دهد."))+
      '</p>'+(source.available?'<a class="outline-button" href="'+esc(rowLink(source.doctype,"").replace(/\/$/,""))+'">'+t("Manage records","مدیریت رکوردها")+icon("arrow")+'</a>':"")+'</section>';
    return title(id,source.limited?t("Showing the latest 1,000 records.","نمایش آخرین ۱۰۰۰ رکورد."):"")+'<section class="panel table-panel">'+recordTable(source)+'</section>';
  }
  function exportSummary() {
    const rows=[["Metric","Value"],["Users",data.users_count],["New users last 7 days",data.new_users_count],
      ["Manufacturing data connected",data.request_data.available?"Yes":"No"],
      ["Requests",data.request_data.available?data.request_data.rows.length:""],
      ["Completed",data.request_data.available?data.statuses.completed:""],["Average lead time days",data.lead_time??""],
      ["Updated",data.updated_at]];
    const text=rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="as-management-summary.csv";link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function render() {
    const id=++generation, view=document.getElementById("admin-view");
    closeMenus();root.classList.remove("nav-open");document.getElementById("menu-toggle").setAttribute("aria-expanded","false");
    document.querySelectorAll("[data-section]").forEach(a=>{
      if(a.dataset.section===current)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");
    });
    setStatus("");
    view.setAttribute("aria-busy","true");
    try {
      let html;
      if(current==="dashboard")html=dashboardView();
      else if(current==="inventory")html=inventoryView();
      else if(current==="settings")html=settingsView();
      else if(current==="reports")html=reportsView();
      else{
        view.innerHTML='<div class="loading-panel"><span class="spinner"></span>'+t("Loading records…","در حال بارگذاری اطلاعات…")+'</div>';
        const payload=await get(current==="users"?"users":"collection",current==="users"?{query,start}:{section:current});
        if(id!==generation)return;
        html=current==="users"?usersTable(payload):collectionView(current,payload);
      }
      view.innerHTML=html;
      if(current==="inventory")window.AS_INVENTORY.mount(document.getElementById("inventory-panel"),{language:boot.language,shopURL:boot.urls.shop});
      if(data.request_data.limited && current==="dashboard")setStatus(t("Statistics cover the latest 1,000 requests.","آمار مربوط به آخرین ۱۰۰۰ درخواست است."));
      document.getElementById("previous-page")?.addEventListener("click",()=>{start=Math.max(0,start-25);render();});
      document.getElementById("next-page")?.addEventListener("click",()=>{start+=25;render();});
      document.getElementById("download-summary")?.addEventListener("click",exportSummary);
    }catch(error){
      if(id!==generation)return;
      view.innerHTML='<section class="panel error-panel"><h2>'+t("Data unavailable","اطلاعات در دسترس نیست")+'</h2><p>'+errorText(error)+'</p><button class="outline-button" id="retry-view">'+icon("refresh")+t("Try again","تلاش مجدد")+'</button></section>';
      document.getElementById("retry-view").addEventListener("click",()=>render());
    }finally{if(id===generation)view.removeAttribute("aria-busy");}
  }
  function route() {
    const candidate=location.hash.replace(/^#\/?/,"").split("?")[0];
    current=sections[candidate]?candidate:"dashboard";
    start=0;query="";const input=document.getElementById("admin-search");if(input)input.value="";
    input.disabled=["settings","reports"].includes(current);
    render();
  }
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){closeMenus();root.classList.remove("nav-open");document.getElementById("menu-toggle")?.setAttribute("aria-expanded","false");}
  });
  document.addEventListener("click",e=>{
    if(!e.target.closest(".popover,#notifications-toggle,#user-menu-toggle"))closeMenus();
  });
  async function init() {
    if(!boot.authorized){access();return;}
    root.innerHTML='<main class="access-card">'+wordmark+'<span class="spinner"></span><p>'+t("Loading your workspace…","در حال بارگذاری پنل…")+'</p></main>';
    try{data=await get("dashboard");layout();window.addEventListener("hashchange",route);route();}
    catch(error){
      root.innerHTML='<main class="access-card">'+wordmark+'<h1>'+t("Workspace unavailable","پنل در دسترس نیست")+'</h1><p>'+errorText(error)+'</p><button class="primary-button" id="retry-dashboard">'+t("Try again","تلاش مجدد")+'</button><a class="outline-button" href="/login?redirect-to=%2Fas-admin">'+t("Sign in","ورود")+'</a></main>';
      document.getElementById("retry-dashboard").addEventListener("click",init);
    }
  }
  init();
})();
