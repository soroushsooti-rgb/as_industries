/* Support tickets share the existing native account, CSRF and website shell. */
(() => {
  "use strict";
  const fa=()=>document.documentElement.lang==="fa";
  const t=(en,ps)=>fa()?ps:en;
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const stamp=value=>value?new Date(String(value).replace(" ","T")).toLocaleString(fa()?"fa-IR":"en-US"):"—";
  const label=value=>({Open:t("Waiting for support","در انتظار پاسخ پشتیبانی"),"Awaiting Customer":t("Support replied","پشتیبانی پاسخ داده است"),Closed:t("Closed","بسته‌شده")}[value]||value);
  const request=(method,data,verb="POST")=>window.AS_ACCOUNT.request("as_industries.tickets."+method,data,verb);
  const get=(method,values={})=>request(method+"?"+new URLSearchParams(values),undefined,"GET");
  const params=()=>new URLSearchParams(location.hash.split("?").slice(1).join("?"));
  const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),n=>n.toString(16).padStart(2,"0")).join("");
  const btn=(action,title,extra="")=>'<button type="button" class="button ghost" data-ticket-action="'+action+'" '+extra+'>'+title+'</button>';
  const error=e=>e.status===401?t("Sign in to use support tickets.","برای استفاده از تیکت‌ها وارد حساب شوید."):e.message;
  function signin(route="/tickets"){
    return '<p>'+t("Sign in to send messages and view your replies.","برای ارسال پیام و دیدن پاسخ‌ها وارد حساب شوید.")+'</p><a class="button primary" href="#/account?mode=password&return='+encodeURIComponent(route)+'">'+t("Sign in","ورود به حساب")+'</a>';
  }
  function form(mode="create",administrative=false){
    return '<form data-ticket-form="'+mode+'">'+(mode==="create"?'<label>'+t("Subject","موضوع")+'<input name="subject" maxlength="200" required></label>':"")+
      '<label>'+t(mode==="create"?"Your message":"Reply",mode==="create"?"پیام شما":"پاسخ")+'<textarea name="body" maxlength="5000" rows="5" required></textarea></label>'+
      (administrative?'<label>'+t("Status after reply","وضعیت پس از پاسخ")+'<select name="status">'+options("Awaiting Customer")+'</select></label>':"")+
      '<button class="button primary" type="submit">'+t(mode==="create"?"Send ticket":"Send reply",mode==="create"?"ارسال تیکت":"ارسال پاسخ")+'</button></form>';
  }
  function options(selected){return ["Open","Awaiting Customer","Closed"].map(value=>'<option value="'+value+'" '+(selected===value?"selected":"")+'>'+label(value)+'</option>').join("");}
  function messagesHTML(messages){
    return messages.map(row=>'<article class="support-message '+(row.sender_type==="Staff"?"is-staff":"")+'"><header><strong>'+t(row.sender_type==="Staff"?"Support team":"Customer",row.sender_type==="Staff"?"تیم پشتیبانی":"مشتری")+'</strong><span>'+esc(row.sender_name)+'</span><time>'+stamp(row.creation)+'</time></header><p>'+esc(row.body)+'</p></article>').join("");
  }
  function listHTML(rows,administrative){
    return rows.length?rows.map(row=>'<article class="support-ticket-card"><div><button type="button" data-ticket-action="detail" data-name="'+esc(row.name)+'"><strong>'+esc(row.subject)+'</strong><small dir="ltr">'+esc(row.name)+'</small></button>'+
      (administrative?'<p>'+esc(row.customer_name)+'<br><span class="support-user-id" dir="ltr">'+esc(row.customer)+'</span></p>':"")+'</div><div><span class="support-badge">'+label(row.status)+'</span><small>'+stamp(row.last_message_at)+'</small></div></article>').join(""):
      '<p class="support-empty">'+t("No support tickets yet.","هنوز تیکتی ثبت نشده است.")+'</p>';
  }
  function board(panel,{admin=false,embedded=false,initialNew=false}={}){
    let busy=false,start=0,name=admin||embedded?null:params().get("ticket"),query="",statusFilter="",detail=null;
    const alive=()=>panel.isConnected;
    const say=value=>{const el=panel.querySelector("[data-ticket-status]");if(el)el.textContent=value;};
    function placeholder(){panel.innerHTML='<p data-ticket-status role="status">'+t("Loading…","در حال بارگذاری…")+'</p>';}
    function listRender(data){
      detail=null;
      panel.innerHTML='<div class="support-toolbar">'+(!admin?btn("new",t("New ticket","تیکت جدید")):"")+btn("refresh",t("Refresh","تازه‌سازی"))+
        (admin?'<label>'+t("Status","وضعیت")+'<select data-ticket-filter><option value="">'+t("All tickets","همه تیکت‌ها")+'</option>'+options(statusFilter)+'</select></label>':"")+'</div>'+
        '<div class="support-ticket-list">'+listHTML(data.tickets,admin)+'</div><div class="support-toolbar">'+btn("prev",t("Previous","قبلی"),!start?"disabled":"")+'<span>'+Math.floor(start/(admin?25:20)+1)+'</span>'+btn("next",t("Next","بعدی"),!data.has_more?"disabled":"")+'</div><p data-ticket-status role="status" aria-live="polite"></p>';
    }
    function detailRender(data){
      detail=data;const ticket=data.ticket;
      panel.innerHTML='<div class="support-toolbar">'+btn("back",t("All tickets","همه تیکت‌ها"))+btn("refresh",t("Refresh replies","تازه‌سازی پاسخ‌ها"))+'</div>'+
        '<div class="support-thread-title"><h3>'+esc(ticket.subject)+'</h3><small dir="ltr">'+esc(ticket.name)+'</small><span class="support-badge">'+label(ticket.status)+'</span>'+
        (admin?'<p>'+esc(ticket.customer_name)+' · <span class="support-user-id" dir="ltr">'+esc(ticket.customer)+'</span></p>':"")+'</div>'+
        (data.has_older?btn("older",t("Load earlier messages","نمایش پیام‌های قدیمی‌تر")):"")+
        '<div class="support-thread">'+messagesHTML(data.messages)+'</div>'+
        (ticket.status==="Closed"&&!admin?'<p>'+t("Your next reply reopens this ticket.","با ارسال پیام جدید، این تیکت دوباره باز می‌شود.")+'</p>':"")+
        form("reply",admin)+(admin?'<form data-ticket-form="status"><label>'+t("Ticket status","وضعیت تیکت")+'<select name="status">'+options(ticket.status)+'</select></label><button class="button ghost" type="submit">'+t("Update status","ذخیره وضعیت")+'</button></form>':"")+
        '<p data-ticket-status role="status" aria-live="polite"></p>';
    }
    function newRender(){detail=null;name=null;panel.innerHTML='<div class="support-toolbar">'+btn("back",t("All tickets","همه تیکت‌ها"))+'</div><h3>'+t("New support ticket","تیکت پشتیبانی جدید")+'</h3>'+form()+'<p data-ticket-status role="status" aria-live="polite"></p>';}
    async function run(fn){
      if(busy||!alive())return;busy=true;panel.setAttribute("aria-busy","true");
      const controls=[...panel.querySelectorAll("button,input,textarea,select")].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
      try{await fn();}catch(e){if(alive())say(error(e));}
      finally{busy=false;controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});if(alive())panel.removeAttribute("aria-busy");}
    }
    async function load(){
      const data=await get(name?(admin?"admin_detail":"mine"):(admin?"admin_list":"mine"),name?{name}:{start,query,status:statusFilter});
      if(!alive())return;
      if(name)detailRender(data);else listRender(data);
    }
    panel.addEventListener("click",event=>{
      const button=event.target.closest("[data-ticket-action]");if(!button||busy)return;
      const action=button.dataset.ticketAction;
      if(action==="new"){newRender();return;}
      run(async()=>{
        if(action==="detail"){name=button.dataset.name;await load();}
        else if(action==="back"){name=null;start=0;await load();}
        else if(action==="refresh")await load();
        else if(action==="prev"){start=Math.max(0,start-(admin?25:20));await load();}
        else if(action==="next"){start+=admin?25:20;await load();}
        else if(action==="older"&&detail?.has_older){
          const older=await get(admin?"admin_detail":"mine",{name,before:detail.before});if(!alive())return;
          const seen=new Set(detail.messages.map(m=>m.name));
          detailRender({...older,messages:[...older.messages.filter(m=>!seen.has(m.name)),...detail.messages]});
        }
      });
    });
    panel.addEventListener("change",event=>{if(event.target.matches("[data-ticket-filter]")){statusFilter=event.target.value;start=0;run(load);}});
    panel.addEventListener("submit",event=>{
      const f=event.target.closest("[data-ticket-form]");if(!f)return;event.preventDefault();
      if(busy||!f.reportValidity())return;
      const mode=f.dataset.ticketForm,values=Object.fromEntries(new FormData(f));f.dataset.requestId ||=uid();
      run(async()=>{
        let data;
        if(mode==="create")data=await request("create",{...values,request_id:f.dataset.requestId,source:embedded?"profile":"message"});
        else if(mode==="status")data=await request("admin_status",{name,status:values.status,modified:detail.ticket.modified});
        else data=await request(admin?"admin_reply":"reply",{name,...values,request_id:f.dataset.requestId});
        if(!alive())return;name=data.ticket.name;detailRender(data);say(t("Saved successfully.","با موفقیت ذخیره شد."));
      });
    });
    placeholder();
    run(async()=>{
      if(!admin){
        const session=await window.AS_ACCOUNT.request("as_industries.account.session",undefined,"GET");
        if(!alive())return;
        if(!session.user){panel.innerHTML=signin("/tickets"+(initialNew?"?new=1":""))+'<p data-ticket-status role="status"></p>';return;}
      }
      if(initialNew&&!admin)newRender();else await load();
    });
    return {search:value=>{query=String(value||"");start=0;name=null;run(load);}};
  }
  function mount(container){
    const page=document.createElement("section");page.className="wrap support-page";
    page.innerHTML='<div class="support-page-heading"><h1>'+t("My tickets","تیکت‌های من")+'</h1><a class="button ghost" href="#/profile">'+t("My profile","پروفایل من")+'</a></div><section class="support-panel" data-ticket-board></section>';
    container.replaceChildren(page);board(page.querySelector("[data-ticket-board]"),{initialNew:params().get("new")==="1"});
  }
  function mountProfile(main){
    if(!main||main.querySelector("#profileTickets"))return;
    const section=document.createElement("section");section.id="profileTickets";section.className="profile-panel support-profile";
    section.innerHTML='<div class="profile-panel-heading"><div><h3>'+t("My tickets","تیکت‌های من")+'</h3><p>'+t("Your messages and support replies are saved here.","پیام‌های شما و پاسخ‌های پشتیبانی اینجا ذخیره می‌شوند.")+'</p></div><a class="button ghost" href="#/tickets">'+t("View all","مشاهده همه")+'</a></div><div class="support-panel" data-ticket-board></div>';
    main.append(section);board(section.querySelector("[data-ticket-board]"),{embedded:true});
  }
  function bindMessage(form,status){
    if(!form)return;
    const submit=form.querySelector('[type="submit"]'),input=form.querySelector('[name="message"]');
    input.maxLength=5000;submit.disabled=true;let busy=false,key=uid();
    function saved(ticket){
      status.textContent=t("Message saved. Read replies in your profile.","پیام ذخیره شد؛ پاسخ را در پروفایل خود ببینید.");
      const link=document.createElement("a");link.className="button ghost";link.href="#/tickets?ticket="+encodeURIComponent(ticket.name);link.textContent=t("View ticket","مشاهده تیکت");status.append(link);
    }
    function login(){
      status.innerHTML=signin("/tickets?new=1");submit.disabled=true;
    }
    window.AS_ACCOUNT.request("as_industries.account.session",undefined,"GET").then(session=>{
      if(!form.isConnected)return;if(session.user){submit.disabled=false;status.textContent=t("Replies will appear in your profile.","پاسخ‌ها در پروفایل شما نمایش داده می‌شوند.");}else login();
    }).catch(e=>{if(form.isConnected)status.textContent=error(e);});
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||submit.disabled||!form.reportValidity())return;busy=true;submit.disabled=true;status.textContent=t("Sending…","در حال ارسال…");
      try{
        const data=await request("create",{subject:t("Message to AS Industries","پیام به AS Industries"),body:input.value,request_id:key,source:"message"});
        if(form.isConnected){input.value="";key=uid();saved(data.ticket);}
      }catch(e){if(form.isConnected){if(e.status===401){login();return;}status.textContent=error(e);}}
      finally{busy=false;if(form.isConnected&&!status.querySelector('a[href^="#/account"]'))submit.disabled=false;}
    };
  }
  let adminActive;
  function mountAdmin(panel){
    panel.classList.add("support-admin");
    panel.innerHTML='<div class="section-title"><div><h1>'+t("Support tickets","تیکت‌های پشتیبانی")+'</h1><p>'+t("Customer user IDs, conversations and replies.","شناسه کاربران، گفتگوها و پاسخ‌های پشتیبانی.")+'</p></div></div><section class="panel support-panel" data-ticket-board></section>';
    adminActive=board(panel.querySelector("[data-ticket-board]"),{admin:true});
  }
  window.AS_TICKETS={owns:path=>path==="/tickets",mount,mountProfile,bindMessage,mountAdmin,search:value=>adminActive?.search(value)};
})();
