/* Customer figure requests and the Family Figurine administration section. */
(() => {
 "use strict";
 const t=(en,fa)=>document.documentElement.lang==="fa"?fa:en;
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 async function api(method,values={}) {
  return window.AS_ACCOUNT.request("as_industries.figures."+method+"?"+new URLSearchParams(values),undefined,"GET");
 }
 function mount(container,admin=false) {
  if(!container)return;
  let start=0,busy=false;
  async function load(){
   if(busy||!container.isConnected)return;
   busy=true;
   try {
    const data=await api(admin?"admin":"mine",{start});
    if(!container.isConnected)return;
    container.innerHTML='<h2>'+t(admin?"Family Figurine":"My figure requests",admin?"فیگور خانوادگی":"درخواست‌های فیگور من")+'</h2>'+
     data.requests.map(row=>'<article class="profile-panel panel"><h3>'+esc(row.name)+' <span class="status-tag">'+esc(row.request_type==="family"?"Family Figurine":row.request_type)+'</span></h3>'+
     '<p>'+esc(row.status)+' · '+esc(row.preferred_size)+' · '+esc(row.quantity)+'</p>'+
     (admin?'<p>'+esc(row.full_name)+' · '+esc(row.contact)+'</p>':'')+
     '<p style="white-space:pre-wrap">'+esc(row.details)+'</p>'+
     (row.reference_image?'<img data-figure-image="'+esc(row.name)+'" alt="'+t("Reference photo","عکس مرجع")+'" style="max-width:180px;max-height:160px;object-fit:contain">':'')+
     '<small>'+esc(row.creation)+'</small></article>').join("")+
     (!data.requests.length?'<p>'+t("No requests yet.","هنوز درخواستی ثبت نشده است.")+'</p>':'')+
     '<button type="button" data-figure-prev '+(!start?'disabled':'')+'>'+t("Previous","قبلی")+'</button> '+
     '<button type="button" data-figure-next '+(!data.has_more?'disabled':'')+'>'+t("Next","بعدی")+'</button>';
    for(const img of container.querySelectorAll("[data-figure-image]")) {
     api("image",{name:img.dataset.figureImage,admin_view:admin?1:0})
      .then(result=>{if(img.isConnected)img.src=result.image;})
      .catch(()=>{img.alt=t("Image could not be loaded","عکس بارگذاری نشد");});
    }
   } catch(error) {
    if(container.isConnected)container.textContent=error.message;
   } finally {busy=false;}
  }
  container.addEventListener("click",event=>{
   if(busy)return;
   if(event.target.hasAttribute("data-figure-prev")){start=Math.max(0,start-20);load();}
   if(event.target.hasAttribute("data-figure-next")){start+=20;load();}
  });
  load();
 }
 window.AS_FIGURES={
  mountAdmin:container=>mount(container,true),
  mountProfile:main=>{
   if(!main||main.querySelector("#profileFigures"))return;
   const section=document.createElement("section");
   section.id="profileFigures";section.className="profile-panel";
   main.append(section);mount(section);
  }
 };
})();
