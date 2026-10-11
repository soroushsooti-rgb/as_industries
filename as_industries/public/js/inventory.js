/* Inventory UI, backed by independently authorized native AS Shop documents. */
(() => {
  "use strict";
  let active;
  const editable=["product_code","title","title_en","category","caption","caption_en","description","description_en","price","price_2","price_3","price_4_plus","show_on_website","manual_out_of_stock","sort_order","cover_image"];
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function csvParse(text){
    text=text.replace(/^\uFEFF/,"");const rows=[];let row=[],cell="",quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];
      if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
      else if(c==='"'&&!cell)quoted=true;
      else if(c===","){row.push(cell);cell="";}
      else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell="";}
      else cell+=c;
    }
    if(quoted)throw Error("Invalid CSV.");
    row.push(cell);if(row.some(Boolean))rows.push(row);
    const headers=rows.shift()||[];if(!headers.includes("product_code"))throw Error("The CSV needs a product_code column.");
    if(new Set(headers).size!==headers.length)throw Error("Duplicate CSV columns.");
    const allowed=new Set([...editable,"stock_qty","images","modified"]);
    if(headers.some(h=>!allowed.has(h)))throw Error("Unsupported CSV columns.");
    if(rows.length>100)throw Error("Import up to 100 products.");
    return rows.map(r=>{if(r.length!==headers.length)throw Error("Invalid CSV row.");return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
  }
  function mount(panel,options){
    if(!panel)return;
    const fa=options.language==="fa",t=(en,persian)=>fa?persian:en;
    const n=v=>new Intl.NumberFormat(fa?"fa-IR":"en-US",{maximumFractionDigits:0}).format(Number(v)||0);
    const date=v=>v?new Date(String(v).replace(" ","T")).toLocaleString(fa?"fa-IR":"en-US"):"—";
    const labels={
      product_code:t("Product code","کد محصول"),title:t("Title","عنوان فارسی"),title_en:t("English title","عنوان انگلیسی"),
      category:t("Category","دسته‌بندی"),caption:t("Caption","خلاصه فارسی"),caption_en:t("English caption","خلاصه انگلیسی"),
      description:t("Description","توضیحات فارسی"),description_en:t("English description","توضیحات انگلیسی"),
      price:t("Unit price / basket of 1","قیمت هر عدد؛ سبد ۱ عددی"),price_2:t("Unit price / basket of 2","قیمت هر عدد؛ سبد ۲ عددی"),
      price_3:t("Unit price / basket of 3","قیمت هر عدد؛ سبد ۳ عددی"),price_4_plus:t("Unit price / basket of 4+","قیمت هر عدد؛ سبد ۴ عدد به بالا"),
      sort_order:t("Display order","ترتیب نمایش"),cover_image:t("Cover image URL","آدرس تصویر اصلی"),
      show_on_website:t("Show on website","نمایش در سایت"),manual_out_of_stock:t("Mark as out of stock","اعلام ناموجودی"),
      stock_qty:t("Stock","موجودی"),image:t("Image URL","آدرس عکس"),alt_text:t("Alt text","متن جایگزین عکس")
    };
    const categoryNames={pets:t("Pets","حیوانات"),family:t("Family","خانواده"),kitchen:t("Kitchen","آشپزخانه"),nfc:"NFC",gadgets:t("Gadgets","گجت‌ها"),home:t("Home","خانه"),furniture:t("Furniture","مبلمان"),other:t("Other","سایر")};
    const types={"Stock In":t("Stock In","ورود موجودی"),"Stock Out":t("Stock Out","خروج موجودی"),"Adjustment":t("Adjustment","اصلاح موجودی")};
    const statusNames=[t("Draft","پیش‌نویس"),t("Submitted","تأییدشده"),t("Cancelled","لغوشده")];
    let state={connected:false},products=[],categories=[],entries=[],query="",category="",publication="",tab="products",busy=false,selectedProduct="",modal,dirty=false,loadId=0;
    const errors={
      "This record changed. Reload it before saving.":t("The record changed. Reload it first.","رکورد تغییر کرده؛ ابتدا دوباره بارگذاری کنید."),
      "Stock changed. Reload the product before adjusting.":t("Stock changed; reload first.","موجودی تغییر کرده؛ ابتدا محصول را تازه‌سازی کنید."),
      "Connect the Shop management account first.":t("Connect the Shop first.","ابتدا به حساب مدیریت فروشگاه متصل شوید."),
      "Enter a valid whole number.":t("Enter a whole number.","یک عدد صحیح معتبر وارد کنید."),
      "Product Code cannot change after creation.":t("Product code cannot change.","کد محصول پس از ساخت قابل تغییر نیست."),
      "The Shop could not be reached. Refresh the inventory before retrying.":t("The Shop did not respond. Refresh before retrying.","فروشگاه پاسخ نداد؛ پیش از تلاش مجدد موجودی را تازه‌سازی کنید."),
      "Use a Shop account with inventory management permission.":t("This account cannot manage inventory.","این حساب مجوز مدیریت موجودی فروشگاه را ندارد."),
      "Incorrect username, password or verification code.":t("Incorrect username, password or code.","نام کاربری، رمز یا کد تأیید درست نیست.")
    };
    const button=(action,label,cls="outline-button",extra="")=>'<button type="button" class="'+cls+'" data-inventory-action="'+action+'" '+extra+'>'+label+'</button>';
    const perm=(kind,action)=>Boolean(state.permissions?.[kind]?.[action]);
    function imageURL(raw){if(!raw)return"";try{const u=new URL(raw,options.shopURL);return ["http:","https:"].includes(u.protocol)?u.href:"";}catch(_){return"";}}
    function say(message){const el=panel.querySelector("#inventory-status");if(el)el.textContent=message;}
    function alive(){return panel.isConnected;}
    async function api(method,data,verb="POST"){return window.AS_ACCOUNT.request("as_industries.inventory."+method,data,verb);}
    async function read(action,payload={}){return api("read?"+new URLSearchParams({action,payload:JSON.stringify(payload)}),undefined,"GET");}
    async function write(action,payload={}){return api("write",{action,payload});}
    function close(force=false){
      if(modal){if(!force&&dirty&&!confirm(t("Discard unsaved changes?","تغییرات ذخیره‌نشده کنار گذاشته شود؟")))return false;modal.close();modal.remove();modal=null;}
      dirty=false;return true;
    }
    function dialog(title,body){
      if(!close())return null;
      modal=document.createElement("dialog");modal.className="inventory-dialog";
      modal.innerHTML='<header><h2>'+esc(title)+'</h2>'+button("close","×","inventory-close",'aria-label="'+t("Close","بستن")+'"')+'</header><div class="inventory-dialog-body">'+body+'</div><p class="inventory-dialog-status" role="status" aria-live="polite"></p>';
      panel.append(modal);modal.showModal();
      modal.addEventListener("input",()=>{dirty=true;});
      modal.addEventListener("cancel",e=>{e.preventDefault();close();});
      return modal;
    }
    async function run(fn){
      if(busy)return;busy=true;panel.setAttribute("aria-busy","true");
      panel.querySelectorAll("button").forEach(b=>{b.dataset.wasDisabled=String(b.disabled);b.disabled=true;});
      try{await fn();}
      catch(error){
        const msg=errors[error.message]||error.message||t("The operation failed.","عملیات انجام نشد.");
        if(error.status===401&&!modal){state={connected:false};connectionView();}
        if(modal)modal.querySelector(".inventory-dialog-status").textContent=msg;else say(msg);
      }finally{
        busy=false;if(alive()){panel.removeAttribute("aria-busy");panel.querySelectorAll("button").forEach(b=>{if(b.dataset.wasDisabled!==undefined){b.disabled=b.dataset.wasDisabled==="true";delete b.dataset.wasDisabled;}});}
      }
    }
    function connectionView(){
      panel.innerHTML='<div class="section-title"><div><h1>'+t("Products & inventory","محصولات و موجودی")+'</h1><p>'+t("Manage the actual AS Shop records inside this panel.","مدیریت اطلاعات واقعی فروشگاه در همین پنل.")+'</p></div></div>'+
        '<section class="panel inventory-connect"><h2>'+t("Connect Shop management","اتصال مدیریت فروشگاه")+'</h2><p>'+t("Use your AS Shop administrator account. This connection keeps the Shop permissions.","با حساب مدیر فروشگاه وارد شوید. تغییرات با مجوزهای همان حساب ثبت می‌شوند.")+'</p>'+
        '<form data-inventory-form="connect">'+(state.needs_otp?'<label>'+t("Verification code","کد تأیید")+'<input name="otp" autocomplete="one-time-code" inputmode="numeric" required></label>':
        '<label>'+t("Username or email","نام کاربری یا ایمیل")+'<input name="usr" autocomplete="username" value="Administrator" required></label><label>'+t("Password","رمز عبور")+'<input name="pwd" type="password" autocomplete="current-password" required></label>')+
        '<button type="submit" class="primary-button">'+t("Connect","اتصال")+'</button>'+(state.needs_otp?button("disconnect",t("Start again","ورود دوباره")):"")+'</form><small>'+t("The password is not stored. Connection expires after 30 minutes of inactivity.","رمز ذخیره نمی‌شود. اتصال پس از ۳۰ دقیقه بی‌فعالیتی منقضی می‌شود.")+'</small></section><p id="inventory-status" role="status" aria-live="polite"></p>';
    }
    async function refresh(){
      const result=await read("catalog");if(!alive())return;
      products=result.products;categories=result.categories;state.permissions=result.permissions;
      if(tab==="stock")entries=(await read("stock")).entries;
      view();
    }
    function rows(){
      return products.filter(p=>(!query||[p.name,p.title,p.title_en,p.product_code].some(v=>String(v||"").toLowerCase().includes(query)))&&
        (!category||p.category===category)&&(!publication||(publication==="published"?Boolean(p.show_on_website):!p.show_on_website)));
    }
    function productsTable(){
      const result=rows();
      return '<div class="table-scroll"><table class="inventory-table"><thead><tr>'+
        [t("PRODUCT","محصول"),t("CATEGORY","دسته‌بندی"),labels.stock_qty,t("PRICE 1","قیمت ۱"),t("PRICE 2","قیمت ۲"),t("PRICE 3","قیمت ۳"),t("PRICE 4+","قیمت ۴+"),t("PUBLICATION","انتشار"),t("ACTIONS","عملیات")].map(v=>'<th scope="col">'+v+'</th>').join("")+
        '</tr></thead><tbody>'+(result.length?result.map(p=>'<tr><td><div class="inventory-product">'+(p.cover_image?'<img src="'+esc(imageURL(p.cover_image))+'" alt="" loading="lazy">':'<span class="inventory-image-placeholder">AS</span>')+
        '<div><strong>'+esc(p.title)+'</strong><small dir="ltr">'+esc(p.product_code)+'</small></div></div></td><td>'+esc(categoryNames[p.category]||p.category)+'</td><td><b class="'+(Number(p.stock_qty)>0&&!p.manual_out_of_stock?"inventory-in-stock":"inventory-no-stock")+'">'+n(p.stock_qty)+'</b></td>'+
        ["price","price_2","price_3","price_4_plus"].map(f=>'<td>'+n(p[f])+'</td>').join("")+'<td><span class="status-tag '+(p.show_on_website?"completed":"hold")+'">'+(p.show_on_website?t("Published","منتشرشده"):t("Hidden","مخفی"))+'</span>'+
        (p.manual_out_of_stock?'<small class="inventory-muted">'+t("Marked unavailable","اعلام ناموجودی")+'</small>':"")+'</td><td><div class="inventory-row-actions">'+button("edit",t("Edit","ویرایش"),"outline-button",'data-name="'+esc(p.name)+'"')+
        button("stock-for",t("Movements","گردش"),"outline-button",'data-name="'+esc(p.name)+'"')+'</div></td></tr>').join(""):'<tr><td colspan="9" class="empty-cell">'+t("No matching products.","محصولی مطابق جست‌وجو پیدا نشد.")+'</td></tr>')+'</tbody></table></div>';
    }
    function stockTable(){
      const result=entries.filter(e=>(!selectedProduct||e.product===selectedProduct)&&(!query||[e.name,e.product,e.notes].some(v=>String(v||"").toLowerCase().includes(query))));
      return '<div class="inventory-stock-filter"><label>'+t("Product","محصول")+'<select id="inventory-stock-filter"><option value="">'+t("All products","همه محصولات")+'</option>'+products.map(p=>'<option value="'+esc(p.name)+'" '+(selectedProduct===p.name?"selected":"")+'>'+esc(p.title)+'</option>').join("")+'</select></label><small>'+t("Only submitted entries change stock. Showing the latest 1,000 entries.","فقط سند تأییدشده موجودی را تغییر می‌دهد. نمایش آخرین ۱۰۰۰ سند.")+'</small></div><div class="table-scroll"><table><thead><tr>'+
        [t("ID","شناسه"),t("PRODUCT","محصول"),t("TYPE","نوع"),t("QUANTITY","مقدار"),t("BEFORE","قبل"),t("AFTER","بعد"),t("STATUS","وضعیت"),t("DATE","تاریخ"),t("ACTIONS","عملیات")].map(v=>'<th>'+v+'</th>').join("")+
        '</tr></thead><tbody>'+(result.length?result.map(e=>'<tr><td dir="ltr">'+esc(e.name)+'</td><td>'+esc(products.find(p=>p.name===e.product)?.title||e.product)+'</td><td>'+types[e.entry_type]+'</td><td>'+n(e.quantity)+'</td><td>'+ (e.docstatus===1?n(e.stock_before):"—")+'</td><td>'+ (e.docstatus===1?n(e.stock_after):"—")+'</td><td><span class="status-tag '+["hold","completed","cancelled"][e.docstatus]+'">'+statusNames[e.docstatus]+'</span></td><td>'+date(e.creation)+'</td><td>'+button("stock-edit",t("Open","باز کردن"),"outline-button",'data-name="'+esc(e.name)+'"')+'</td></tr>').join(""):'<tr><td colspan="9" class="empty-cell">'+t("No stock entries.","سند موجودی پیدا نشد.")+'</td></tr>')+'</tbody></table></div>';
    }
    function view(){
      if(!alive())return;
      panel.innerHTML='<div class="section-title"><div><h1>'+t("Products & inventory","محصولات و موجودی")+'</h1><p>'+t("Connected as","متصل با حساب")+" "+esc(state.user)+'</p></div><div class="inventory-toolbar">'+
        button("refresh",t("Refresh","تازه‌سازی"))+button("disconnect",t("Disconnect","قطع اتصال"))+'</div></div>'+
        '<div class="inventory-summary">'+[[t("Products","محصول"),products.length],[t("Published","منتشرشده"),products.filter(p=>p.show_on_website).length],[t("Total stock","مجموع موجودی"),products.reduce((s,p)=>s+Number(p.stock_qty||0),0)],[t("Unavailable","ناموجود"),products.filter(p=>!Number(p.stock_qty)||p.manual_out_of_stock).length]].map(([label,value])=>'<div class="panel"><small>'+label+'</small><strong>'+n(value)+'</strong></div>').join("")+'</div>'+
        '<div class="inventory-toolbar inventory-tabs">'+button("tab-products",t("Products","محصولات"),tab==="products"?"primary-button":"outline-button")+button("tab-stock",t("Stock movements","گردش موجودی"),tab==="stock"?"primary-button":"outline-button")+
        '<span class="inventory-toolbar-spacer"></span>'+ (tab==="products"?(perm("product","create")?button("new",t("New product","محصول جدید"),"primary-button"):"")+
        (perm("product","export")?button("export",t("Export CSV","خروجی CSV")):"")+
        ((perm("product","create")||perm("product","write"))?button("import",t("Import CSV","ورود CSV")):""):
        (perm("stock","create")?button("stock-new",t("New movement","سند جدید"),"primary-button"):"")+(perm("stock","export")?button("stock-export",t("Export CSV","خروجی CSV")):""))+'</div>'+
        (tab==="products"?'<div class="inventory-filters"><label>'+t("Category","دسته‌بندی")+'<select id="inventory-category"><option value="">'+t("All categories","همه دسته‌ها")+'</option>'+categories.map(c=>'<option value="'+esc(c)+'" '+(c===category?"selected":"")+'>'+esc(categoryNames[c]||c)+'</option>').join("")+'</select></label><label>'+t("Publication","انتشار")+'<select id="inventory-publication"><option value="">'+t("All","همه")+'</option><option value="published" '+(publication==="published"?"selected":"")+'>'+t("Published","منتشرشده")+'</option><option value="hidden" '+(publication==="hidden"?"selected":"")+'>'+t("Hidden","مخفی")+'</option></select></label><small>'+t("Prices are per unit, determined by the total basket quantity. All prices in Toman.","قیمت‌ها برای هر واحد و بر اساس مجموع تعداد سبد خرید هستند؛ به تومان.")+'</small></div>':"")+
        '<section class="panel table-panel">'+(tab==="products"?productsTable():stockTable())+'</section><p id="inventory-status" role="status" aria-live="polite"></p>';
    }
    function field(name,value="",type="text",extra=""){
      return '<label class="inventory-field">'+esc(labels[name]||name)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
    }
    function galleryHTML(images){
      return images.map((r,i)=>'<div class="inventory-gallery-row" data-gallery-row="'+i+'">'+
        '<img src="'+esc(imageURL(r.image))+'" alt="" '+(!r.image?"hidden":"")+'><div class="inventory-fields">'+
        ["image","caption","caption_en","alt_text"].map(f=>'<label>'+esc(labels[f]||f)+'<input data-gallery-field="'+f+'" value="'+esc(r[f]||"")+'"></label>').join("")+'</div><div class="inventory-gallery-actions">'+
        '<label class="outline-button inventory-file-label">'+t("Upload","بارگذاری")+'<input type="file" data-image-upload="gallery" data-index="'+i+'" accept="image/jpeg,image/png,image/webp"></label>'+
        button("gallery-up","↑","outline-button",'data-index="'+i+'" aria-label="'+t("Move up","انتقال به بالا")+'"')+button("gallery-down","↓","outline-button",'data-index="'+i+'" aria-label="'+t("Move down","انتقال به پایین")+'"')+
        button("gallery-remove",t("Remove","حذف"),"outline-button",'data-index="'+i+'"')+'</div></div>').join("");
    }
    function galleryValues(){return Array.from(modal.querySelectorAll("[data-gallery-row]")).map(el=>Object.fromEntries(Array.from(el.querySelectorAll("[data-gallery-field]")).map(input=>[input.dataset.galleryField,input.value])));}
    async function editProduct(name){
      const p=name?(await read("product",{name})).product:{category:categories[0]||"pets",price:0,price_2:0,price_3:0,price_4_plus:0,stock_qty:0,sort_order:0,images:[]};
      const writable=name?perm("product","write"):perm("product","create");
      const html='<form data-inventory-form="product" data-name="'+esc(p.name||"")+'" data-modified="'+esc(p.modified||"")+'" data-stock="'+Number(p.stock_qty||0)+'">'+
        '<h3>'+t("Product information","اطلاعات محصول")+'</h3><div class="inventory-fields">'+
        field("product_code",p.product_code,"text",'required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" '+(name?"readonly":""))+
        field("title",p.title,"text","required")+field("title_en",p.title_en)+
        '<label class="inventory-field">'+labels.category+'<select name="category">'+categories.map(c=>'<option value="'+esc(c)+'" '+(c===p.category?"selected":"")+'>'+esc(categoryNames[c]||c)+'</option>').join("")+'</select></label>'+
        ["caption","caption_en","description","description_en"].map(f=>'<label class="inventory-field">'+labels[f]+'<textarea name="'+f+'" rows="'+(f.startsWith("description")?4:2)+'">'+esc(p[f]||"")+'</textarea></label>').join("")+'</div>'+
        '<h3>'+t("Prices & publication","قیمت‌ها و انتشار")+'</h3><p class="inventory-help">'+t("Each price is per unit at the total basket quantity. Zero tier price falls back to the main price.","هر قیمت، قیمت هر واحد در تعداد کل سبد است. قیمت سطحیِ صفر از قیمت اصلی استفاده می‌کند.")+'</p><div class="inventory-fields inventory-price-fields">'+
        ["price","price_2","price_3","price_4_plus"].map(f=>field(f,p[f]||0,"number",'min="0" step="1" required')).join("")+'</div><div class="inventory-fields">'+field("sort_order",p.sort_order||0,"number",'step="1"')+
        '<label class="inventory-field">'+t("Final stock quantity","موجودی نهایی")+'<input name="stock_target" type="number" min="0" step="1" value="'+Number(p.stock_qty||0)+'" '+(!perm("stock","create")||!perm("stock","submit")?"readonly":"")+'></label>'+
        '<label class="inventory-field">'+t("Stock adjustment reason","علت تغییر موجودی")+'<input name="stock_notes" placeholder="'+t("Reason or receipt reference","دلیل یا شماره رسید")+'"></label></div><p class="inventory-help">'+t("Stock changes create a submitted adjustment entry automatically.","تغییر موجودی، خودکار یک سند اصلاح تأییدشده ثبت می‌کند.")+'</p><div class="inventory-checks">'+
        ["show_on_website","manual_out_of_stock"].map(f=>'<label><input type="checkbox" name="'+f+'" '+(p[f]?"checked":"")+'>'+labels[f]+'</label>').join("")+'</div>'+
        '<h3>'+t("Cover & gallery","تصویر اصلی و گالری")+'</h3><div class="inventory-cover">'+field("cover_image",p.cover_image||"")+ '<label class="outline-button inventory-file-label">'+t("Upload cover","بارگذاری تصویر اصلی")+'<input type="file" data-image-upload="cover" accept="image/jpeg,image/png,image/webp"></label></div>'+
        '<p class="inventory-help">'+t("JPG, PNG, WebP up to 5 MB. Save a new product before uploading.","JPG، PNG و WebP تا ۵ مگابایت. محصول جدید را قبل از بارگذاری ذخیره کنید.")+'</p><div id="inventory-gallery">'+galleryHTML(p.images||[])+'</div>'+button("gallery-add",t("Add gallery image","افزودن عکس گالری"))+
        '<div class="inventory-form-footer">'+(writable?'<button class="primary-button" type="submit">'+t("Save changes","ذخیره تغییرات")+'</button>':"")+button("close",t("Close","بستن"))+'</div></form>'+
        (name?'<div class="inventory-secondary-actions">'+button("history",t("History & notes","تاریخچه و یادداشت‌ها"),"outline-button",'data-kind="product" data-name="'+esc(name)+'"')+
        (perm("product","print")?button("print",t("Print","چاپ"),"outline-button",'data-kind="product" data-name="'+esc(name)+'"'):"")+
        (perm("product","create")?button("duplicate",t("Duplicate","کپی محصول"),"outline-button",'data-name="'+esc(name)+'"'):"")+
        (perm("product","delete")?button("delete",t("Delete","حذف محصول"),"outline-button inventory-danger",'data-name="'+esc(name)+'" data-modified="'+esc(p.modified)+'"'):"")+'</div>':"");
      const el=dialog(name?t("Edit product","ویرایش محصول"):t("New product","محصول جدید"),html);
      if(el&&!writable)el.querySelectorAll("form input,form textarea,form select,form button,form [type=file]").forEach(input=>input.disabled=true);
    }
    function stockDialog(record){
      const e=record||{product:selectedProduct||products[0]?.name||"",entry_type:"Stock In",quantity:1,notes:"",docstatus:0};
      const editing=Boolean(e.name),draft=e.docstatus===0,canSave=draft&&(editing?perm("stock","write"):perm("stock","create"));
      const productOptions=products.map(p=>'<option value="'+esc(p.name)+'" '+(p.name===e.product?"selected":"")+'>'+esc(p.title)+'</option>').join("");
      dialog(editing?e.name:t("New stock movement","سند موجودی جدید"),
        '<form data-inventory-form="stock" data-name="'+esc(e.name||"")+'" data-modified="'+esc(e.modified||"")+'"><div class="inventory-fields"><label>'+t("Product","محصول")+'<select name="product" '+(!canSave?"disabled":"")+'>'+productOptions+'</select></label><label>'+t("Type","نوع سند")+'<select name="entry_type" '+(!canSave?"disabled":"")+'>'+Object.entries(types).map(([value,label])=>'<option value="'+value+'" '+(e.entry_type===value?"selected":"")+'>'+label+'</option>').join("")+'</select></label><label>'+t("Quantity / change","مقدار / تغییر")+'<input type="number" name="quantity" step="1" value="'+e.quantity+'" required '+(!canSave?"readonly":"")+'></label><label>'+t("Notes","توضیحات")+'<textarea name="notes" '+(!canSave?"readonly":"")+'>'+esc(e.notes||"")+'</textarea></label></div>'+
        '<p class="inventory-help">'+t("Stock In/Out: positive quantity. Adjustment: positive or negative change.","ورود/خروج: مقدار مثبت. اصلاح: تغییر مثبت یا منفی.")+'</p>'+
        '<div class="inventory-stock-results"><span>'+t("Status","وضعیت")+": "+statusNames[e.docstatus]+'</span><span>'+t("Before / after","قبل / بعد")+": "+(e.docstatus===1?n(e.stock_before)+" / "+n(e.stock_after):"—")+'</span>'+ (e.amended_from?'<span>'+t("Amended from","اصلاح‌شده از")+": "+esc(e.amended_from)+'</span>':"")+'</div>'+
        '<div class="inventory-form-footer">'+(canSave?'<button class="primary-button" type="submit" name="mode" value="draft">'+t("Save draft","ذخیره پیش‌نویس")+'</button>'+ (perm("stock","submit")?'<button class="outline-button" type="submit" name="mode" value="submit">'+t("Save & submit","ذخیره و تأیید")+'</button>':""):"")+button("close",t("Close","بستن"))+'</div></form>'+
        (editing?'<div class="inventory-secondary-actions">'+button("history",t("History & notes","تاریخچه و یادداشت‌ها"),"outline-button",'data-kind="stock" data-name="'+esc(e.name)+'"')+
        (perm("stock","print")?button("print",t("Print","چاپ"),"outline-button",'data-kind="stock" data-name="'+esc(e.name)+'"'):"")+
        (e.docstatus===1&&perm("stock","cancel")?button("stock-cancel",t("Cancel entry","لغو سند"),"outline-button inventory-danger",'data-name="'+esc(e.name)+'" data-modified="'+esc(e.modified)+'"'):"")+
        (e.docstatus===2&&perm("stock","amend")?button("stock-amend",t("Amend","اصلاح سند"),"outline-button",'data-name="'+esc(e.name)+'" data-modified="'+esc(e.modified)+'"'):"")+
        (e.docstatus!==1&&perm("stock","delete")?button("stock-delete",t("Delete","حذف"),"outline-button inventory-danger",'data-name="'+esc(e.name)+'" data-modified="'+esc(e.modified)+'"'):"")+'</div>':""));
    }
    async function historyDialog(kind,name){
      const data=await read("history",{kind,name});const canShare=perm(kind,"share"),canWrite=perm(kind,"write");
      dialog(t("History & collaboration","تاریخچه و همکاری")+" · "+name,
        '<div class="inventory-history"><h3>'+t("Notes","یادداشت‌ها")+'</h3>'+
        data.comments.map(c=>'<article><small>'+esc(c.owner)+" · "+date(c.creation)+'</small><p>'+esc(c.content)+'</p></article>').join("")+
        '<form data-inventory-form="comment" data-kind="'+kind+'" data-name="'+esc(name)+'"><textarea name="content" required rows="3" placeholder="'+t("Write a note","یادداشت بنویسید")+'"></textarea><button type="submit" class="primary-button">'+t("Add note","ثبت یادداشت")+'</button></form>'+
        '<h3>'+t("Changes","تغییرات")+'</h3>'+data.versions.map(v=>'<details><summary>'+date(v.creation)+" · "+esc(v.owner)+'</summary><pre>'+esc(JSON.stringify(JSON.parse(v.data||"{}"),null,2))+'</pre></details>').join("")+
        '<h3>'+t("Shared access","دسترسی اشتراکی")+'</h3>'+data.shares.map(s=>'<div class="inventory-collaboration-row"><span dir="ltr">'+esc(s.user)+'</span><small>'+t("Read","خواندن")+(s.write?" / "+t("Write","ویرایش"):"")+'</small>'+ (canShare?button("unshare",t("Remove","حذف"),"outline-button",'data-user="'+esc(s.user)+'" data-kind="'+kind+'" data-name="'+esc(name)+'"'):"")+'</div>').join("")+
        (canShare?'<form data-inventory-form="share" data-kind="'+kind+'" data-name="'+esc(name)+'"><label>'+t("User email","ایمیل کاربر")+'<input name="user" type="email" required></label><label class="inventory-check"><input name="write" type="checkbox">'+t("Allow editing","اجازه ویرایش")+'</label><button type="submit" class="outline-button">'+t("Share record","اشتراک رکورد")+'</button></form>':"")+
        '<h3>'+t("Assignments","ارجاع‌ها")+'</h3>'+data.assignments.map(a=>'<div class="inventory-collaboration-row"><span dir="ltr">'+esc(a.allocated_to)+'</span>'+ (canWrite?button("unassign",t("Remove","حذف"),"outline-button",'data-user="'+esc(a.allocated_to)+'" data-kind="'+kind+'" data-name="'+esc(name)+'"'):"")+'</div>').join("")+
        (canWrite?'<form data-inventory-form="assign" data-kind="'+kind+'" data-name="'+esc(name)+'"><label>'+t("User email","ایمیل کاربر")+'<input name="user" type="email" required></label><label>'+t("Description","توضیحات")+'<input name="description"></label><button type="submit" class="outline-button">'+t("Assign","ارجاع")+'</button></form>':"")+'</div>');
    }
    function download(rows,columns,name){
      const cell=v=>'"'+(typeof v==="string"&&/^[=+\-@\t]/.test(v)?"'":"")+String(v??"").replace(/"/g,'""')+'"';
      const text="\uFEFF"+[columns.join(","),...rows.map(r=>columns.map(c=>cell(typeof r[c]==="object"?JSON.stringify(r[c]):r[c])).join(","))].join("\r\n");
      const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function importDialog(){
      dialog(t("Import products CSV","ورود محصولات CSV"),'<p class="inventory-help">'+t("Up to 100 rows per import. Review the preview before saving. Stock quantities create ledger adjustments.","حداکثر ۱۰۰ ردیف در هر ورود. قبل از ذخیره پیش‌نمایش را بررسی کنید. موجودی با سند اصلاح اعمال می‌شود.")+'</p>'+
        button("template",t("Download CSV template","دریافت قالب CSV"))+'<form data-inventory-form="import"><label>'+t("Mode","حالت")+'<select name="mode"><option value="create">'+t("Create only","فقط ایجاد")+'</option><option value="update">'+t("Update only","فقط ویرایش")+'</option><option value="both">'+t("Create or update","ایجاد یا ویرایش")+'</option></select></label><label>'+t("CSV file","فایل CSV")+'<input type="file" name="csv" accept=".csv,text/csv" required data-csv-upload></label><div id="inventory-import-preview"></div><button class="primary-button" type="submit" disabled id="inventory-import-submit">'+t("Import reviewed rows","ثبت ردیف‌های بررسی‌شده")+'</button></form>');
    }
    panel.addEventListener("change",event=>{
      const el=event.target;
      if(el.id==="inventory-category"){category=el.value;view();}
      else if(el.id==="inventory-publication"){publication=el.value;view();}
      else if(el.id==="inventory-stock-filter"){selectedProduct=el.value;view();}
      else if(el.matches("[data-image-upload]"))run(async()=>{
        const form=modal?.querySelector('[data-inventory-form="product"]');if(!form?.dataset.name)throw Error(t("Save the product first.","ابتدا محصول را ذخیره کنید."));
        const file=el.files?.[0];if(!file)return;if(file.size>5*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type))throw Error(t("Choose a JPG, PNG or WebP up to 5 MB.","عکس JPG، PNG یا WebP تا ۵ مگابایت انتخاب کنید."));
        const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(file);});
        const result=await write("image_upload",{name:form.dataset.name,content});
        if(el.dataset.imageUpload==="cover")form.querySelector('[name="cover_image"]').value=result.file_url;
        else{const row=modal.querySelector('[data-gallery-row="'+el.dataset.index+'"]');row.querySelector('[data-gallery-field="image"]').value=result.file_url;const image=row.querySelector("img");image.src=imageURL(result.file_url);image.hidden=false;}
        dirty=true;el.value="";modal.querySelector(".inventory-dialog-status").textContent=t("Uploaded. Save the product to apply.","بارگذاری شد؛ برای اعمال، محصول را ذخیره کنید.");
      });
      else if(el.matches("[data-csv-upload]"))run(async()=>{
        const file=el.files?.[0];if(!file)return;if(file.size>2*1024*1024)throw Error(t("Choose a CSV smaller than 2 MB.","فایل CSV کمتر از ۲ مگابایت انتخاب کنید."));
        const rows=csvParse(await file.text());el.closest("form")._importRows=rows;
        modal.querySelector("#inventory-import-preview").innerHTML='<p>'+n(rows.length)+" "+t("rows","ردیف")+'</p><pre>'+esc(JSON.stringify(rows.slice(0,5),null,2))+'</pre>';
        const submit=modal.querySelector("#inventory-import-submit");submit.disabled=!rows.length;submit.dataset.wasDisabled=String(!rows.length);
      });
    });
    panel.addEventListener("submit",event=>{
      const form=event.target.closest("[data-inventory-form]");if(!form)return;event.preventDefault();if(!form.reportValidity())return;
      const values=Object.fromEntries(new FormData(form));const mode=form.dataset.inventoryForm;const submitMode=event.submitter?.value;
      run(async()=>{
        if(mode==="connect"){state=await api("connect",values);const pwd=form.querySelector('[name="pwd"]');if(pwd)pwd.value="";if(state.connected)await refresh();else connectionView();return;}
        if(mode==="product"){
          const fields=Object.fromEntries(editable.filter(f=>f!=="show_on_website"&&f!=="manual_out_of_stock").map(f=>[f,values[f]]));
          for(const f of ["show_on_website","manual_out_of_stock"])fields[f]=form.querySelector('[name="'+f+'"]').checked?1:0;
          fields.images=galleryValues();
          const result=await write("product_save",{name:form.dataset.name||null,modified:form.dataset.modified,values:fields,
            stock_target:Number(values.stock_target),stock_expected:Number(form.dataset.stock),stock_notes:values.stock_notes});
          close(true);await refresh();await editProduct(result.product.name);dirty=false;
          modal.querySelector(".inventory-dialog-status").textContent=t("Saved successfully.","تغییرات ذخیره شد.");return;
        }
        if(mode==="stock"){await write("stock_save",{name:form.dataset.name||null,modified:form.dataset.modified,values,submit:submitMode==="submit"});close(true);tab="stock";await refresh();say(t("Stock entry saved.","سند موجودی ذخیره شد."));return;}
        if(mode==="import"){if(!form._importRows?.length)throw Error(t("Choose and review a CSV first.","ابتدا فایل CSV را انتخاب و بررسی کنید."));const result=await write("import",{rows:form._importRows,mode:values.mode});close(true);await refresh();say(n(result.saved.length)+" "+t("products saved.","محصول ذخیره شد."));return;}
        const kind=form.dataset.kind,name=form.dataset.name;
        if(mode==="share"&&!confirm(t("Give this user access to this record?","به این کاربر دسترسی این رکورد داده شود؟")))return;
        if(mode==="assign"&&!confirm(t("Assign this record to the user?","رکورد به این کاربر ارجاع شود؟")))return;
        await write(mode,{kind,name,...values,write:mode==="share"&&form.querySelector('[name="write"]').checked?1:0});
        close(true);await historyDialog(kind,name);
      });
    });
    panel.addEventListener("click",event=>{
      const el=event.target.closest("[data-inventory-action]");if(!el)return;
      const action=el.dataset.inventoryAction,name=el.dataset.name,kind=el.dataset.kind;
      if(action==="close"){close();return;}
      if(["gallery-add","gallery-up","gallery-down","gallery-remove"].includes(action)){
        const images=galleryValues(),i=Number(el.dataset.index);
        if(action==="gallery-add")images.push({image:"",caption:"",caption_en:"",alt_text:""});
        if(action==="gallery-remove")images.splice(i,1);
        const j=action==="gallery-up"?i-1:i+1;if(["gallery-up","gallery-down"].includes(action)&&j>=0&&j<images.length)[images[i],images[j]]=[images[j],images[i]];
        modal.querySelector("#inventory-gallery").innerHTML=galleryHTML(images);dirty=true;return;
      }
      if(action==="export"){download(rows(),[...editable,"stock_qty","images","modified"],"as-products.csv");return;}
      if(action==="stock-export"){download(entries,["name","product","entry_type","quantity","docstatus","stock_change","stock_before","stock_after","notes","creation"],"as-stock-entries.csv");return;}
      if(action==="import"){importDialog();return;}
      if(action==="template"){download([{product_code:"example-product",title:t("Example product","محصول نمونه"),category:"pets",price:350000,price_2:300000,price_3:250000,price_4_plus:200000,stock_qty:10,show_on_website:0}],["product_code","title","category","price","price_2","price_3","price_4_plus","stock_qty","show_on_website"],"as-products-template.csv");return;}
      if(action==="stock-new"){stockDialog();return;}
      if(action==="stock-edit"){stockDialog(entries.find(e=>e.name===name));return;}
      run(async()=>{
        if(action==="refresh"){await refresh();return;}
        if(action==="disconnect"){if(!close())return;await api("disconnect",{});state={connected:false};connectionView();return;}
        if(action==="tab-products"){tab="products";view();return;}
        if(action==="tab-stock"||action==="stock-for"){tab="stock";selectedProduct=action==="stock-for"?name:"";await refresh();return;}
        if(action==="edit"||action==="new"){await editProduct(name);return;}
        if(action==="history"){await historyDialog(kind,name);return;}
        if(action==="duplicate"){const code=prompt(t("New product code:","کد محصول جدید:"));if(!code)return;const result=await write("product_duplicate",{name,product_code:code});close(true);await refresh();await editProduct(result.product.name);return;}
        if(action==="delete"||action==="stock-delete"||action==="stock-cancel"){
          if(!confirm(t("Confirm this action? It will be checked against the linked records and stock ledger.","این عملیات انجام شود؟ وابستگی رکوردها و موجودی بررسی خواهد شد.")))return;
          await write(action==="delete"?"product_delete":action.replace("-","_"),{name,modified:el.dataset.modified});close(true);await refresh();say(t("Done.","انجام شد."));return;
        }
        if(action==="stock-amend"){const result=await write("stock_amend",{name,modified:el.dataset.modified});close(true);await refresh();stockDialog(result);return;}
        if(action==="unshare"||action==="unassign"){if(!confirm(t("Remove this access or assignment?","این دسترسی یا ارجاع حذف شود؟")))return;await write(action,{kind,name,user:el.dataset.user});close(true);await historyDialog(kind,name);return;}
        if(action==="print"){
          const result=await read("print",{kind,name});if(!close())return;
          const doc=dialog(t("Print preview","پیش‌نمایش چاپ"),button("print-frame",t("Print","چاپ"),"primary-button")+'<iframe class="inventory-print-frame" sandbox="allow-same-origin allow-modals" title="'+t("Print preview","پیش‌نمایش چاپ")+'"></iframe>');
          const frame=doc.querySelector("iframe");frame.srcdoc=result.html.replace(/(src|href)=["'](\/[^"']*)["']/g,(_,attr,path)=>attr+'="'+esc(imageURL(path))+'"');return;
        }
        if(action==="print-frame"){modal.querySelector("iframe").contentWindow.print();}
      });
    });
    active={search:value=>{query=String(value||"").toLowerCase();if(state.connected&&alive()&&!modal)view();}};
    run(async()=>{state=await api("status",undefined,"GET");if(!alive())return;if(state.connected)await refresh();else connectionView();});
  }
  window.AS_INVENTORY={mount,search:value=>active?.search(value),parseCSV:csvParse};
})();
