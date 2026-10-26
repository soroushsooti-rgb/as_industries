/* Customer custom requests and their category administration sections. */
(() => {
 "use strict";
 const t=(en,fa)=>document.documentElement.lang==="fa"?fa:en;
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 async function api(method,values={}) {
  return window.AS_ACCOUNT.request("as_industries.figures."+method+"?"+new URLSearchParams(values),undefined,"GET");
 }
 function mount(container,admin=false,requestType="family") {
  if(!container)return;
  let start=0,busy=false;
  async function load(){
   if(busy||!container.isConnected)return;
   busy=true;
   try {
    const data=await api(admin?"admin":"mine",{start,...(admin?{request_type:requestType}:{})});
    if(!container.isConnected)return;
    const heading = admin ? (requestType==="kitchen" ? t("Kitchen Requests","درخواست‌های آشپزخانه") : t("Family Figurine","فیگور خانوادگی")) : t("My custom requests","درخواست‌های سفارشی من");
    container.innerHTML='<h2>'+heading+'</h2>'+
     data.requests.map(row=>'<article id="figure-'+esc(row.name)+'" class="profile-panel panel"><h3>'+esc(row.name)+' <span class="status-tag">'+esc(row.request_type==="family"?t("Family Figurine","فیگور خانوادگی"):row.request_type==="kitchen"?t("Kitchen","آشپزخانه"):row.request_type)+'</span></h3>'+
     (row.design_reference?'<p><strong>'+esc(row.design_reference)+'</strong></p>':'')+
     '<p>'+esc(row.status)+' · '+esc(row.preferred_size)+' · '+esc(row.quantity)+'</p>'+
     (admin?'<p>'+esc(row.full_name)+' · '+esc(row.contact)+'</p>':'')+
     '<p style="white-space:pre-wrap">'+esc(row.details)+'</p>'+
     (row.reference_image?'<img data-figure-image="'+esc(row.name)+'" alt="'+t("Reference photo","عکس مرجع")+'" style="max-width:180px;max-height:160px;object-fit:contain">':'')+
     '<small>'+esc(row.creation)+'</small></article>').join("")+
     (!data.requests.length?'<p>'+t("No requests yet.","هنوز درخواستی ثبت نشده است.")+'</p>':'')+
     '<button type="button" data-figure-prev '+(!start?'disabled':'')+'>'+t("Previous","قبلی")+'</button> '+
     '<button type="button" data-figure-next '+(!data.has_more?'disabled':'')+'>'+t("Next","بعدی")+'</button>';
    const selected = new URLSearchParams(location.hash.split("?")[1] || "").get("figure");
    if(selected) document.getElementById("figure-"+selected)?.scrollIntoView({block:"center"});
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
 function section(main,id) {
  if(!main||main.querySelector("#"+id))return;
  const container=document.createElement("section");
  container.id=id;container.className="profile-panel";
  main.append(container);mount(container);
 }
 window.AS_FIGURES={
  mountAdmin:(container,requestType="family")=>mount(container,true,requestType),
  mountProfile:main=>section(main,"profileFigures"),
  mountOrders:main=>section(main,"orderFigures")
 };
})();
