# حساب مشترک AS

صفحه حساب فروشگاه و صنایع به `/as-industries#/account` در سایت AS Industries می‌رود. حساب‌ها همان DocType استاندارد `User` و نشست‌های استاندارد Frappe هستند. مسیرها، سبد خرید و قالب‌های موجود حفظ شده‌اند. این اتصال یک صفحه حساب مرکزی است؛ برای سایت فروشگاه نشست جداگانه یا SSO ایجاد نمی‌کند.

## امکانات

- ورود با نام کاربری، ایمیل یا موبایل و رمز؛ تشخیص حساب در اپ و احراز هویت با Login Manager استاندارد Frappe.
- ورود با کد پیامکی برای Website User دارای شماره موبایل.
- ثبت‌نام با نام، نام کاربری، ایمیل، موبایل و رمز؛ فعلاً بدون OTP و ارسال ایمیل. شماره تا تأیید پیامکی در User.phone ذخیره می‌شود.
- بازیابی رمز با کد پیامکی برای شماره ثبت‌شده.
- تغییر رمز با رمز فعلی و خروج سایر نشست‌ها از مسیر استاندارد Frappe.
- ذخیره نام و نام خانوادگی در پروفایل.
- افزودن شماره تأییدشده به حساب بدون شماره، برای حساب‌های گوگل.
- ورود گوگل با Social Login Key استاندارد Frappe و برگشت به صفحه مشترک.
- ثبت‌نام تابع تنظیمات Website Settings است.
- OTP برای حساب‌های System User و Administrator فعال نیست.

## راه‌اندازی sms.ir

در Desk سایت **as-industries.localhost** بخش **SMS Settings** را باز کنید.

- SMS Gateway URL: `https://api.sms.ir/v1/send/verify`
- Use POST: فعال
- Message Parameter: نام پارامتر کد در قالب شما، مثلاً `Code` یا `CODE`؛ دقیقاً مطابق قالب پنل.
- Receiver Parameter: `mobile`
- در جدول Parameters: پارامتر `x-api-key`، مقدار کلید واقعی و گزینه Header فعال.
- در همان جدول: پارامتر `templateId`، مقدار شناسه عددی قالب تأییدشده، Header غیرفعال.

متن قالب در پنل sms.ir باید پارامتر کد داشته باشد. adapter سرور، بدنه استاندارد mobile/templateId/parameters را می‌فرستد و status=1 را بررسی می‌کند. پذیرفته شدن درخواست توسط پنل تضمین تحویل به گوشی نیست.
کلید فقط داخل تنظیمات سرور وارد می‌شود و به JavaScript فرستاده نمی‌شود.
مبنای اتصال: SDK رسمی IPeCompany/SmsPanelV2.TypeScript، تابع sendVerifyCode.

شماره‌ها به قالب `09xxxxxxxxx` یکسان می‌شوند. کد ۶ رقمی، اعتبار ۵ دقیقه، حداکثر ۵ تلاش، فاصله ارسال ۶۰ ثانیه، حداکثر ۵ درخواست در ساعت برای هر شماره و محدودیت IP دارد.
چالش و هش کد در Redis همان سایت نگهداری می‌شوند. مصرف چالش اتمیک و یک‌بارمصرف است. برای شماره ناشناخته پاسخ عمومی یکسان برمی‌گردد.
برای تست اتصال، یک حساب آزمایشی Website User و شماره واقعی متعلق به خودتان بسازید و ارسال و تأیید را انجام دهید.

## راه‌اندازی گوگل

در Desk همین سایت، **Social Login Key** با provider **Google** را با Client ID و Client Secret واقعی تنظیم و Enable Social Login را فعال کنید.
آدرس callback محیط فعلی:
`http://as-industries.localhost:8001/api/method/frappe.integrations.oauth2_logins.login_via_google`
برای محیط واقعی از دامنه HTTPS تأییدشده در Google استفاده کنید. اگر Google دامنه محلی فعلی را قبول نکرد، تنظیم را روی دامنه توسعه مجاز یا دامنه واقعی انجام دهید.
State و callback توسط Frappe مدیریت می‌شوند. فرم ثبت‌نام پیامکی به تنظیمات ایمیل نیاز ندارد.

## هویت حساب

ثبت‌نام فعلی ایمیل را در User.email و نام کاربری را در User.username ذخیره می‌کند. شماره تأییدنشده در User.phone و شماره تأییدشده در User.mobile_no نگهداری می‌شود. نام کاربری، ایمیل و موبایل تکراری با پیام مشخص رد می‌شوند؛ نام نمایشی افراد می‌تواند مشترک باشد. حساب‌های قدیمی دارای ایمیل داخلی حذف یا جابه‌جا نشده‌اند و با نام کاربری و رمز قبلی وارد می‌شوند. حساب گوگل از مسیر استاندارد Frappe استفاده می‌کند. ادغام دیتابیس‌های سایت‌ها انجام نمی‌شود.

## فایل‌ها

`as_industries/account.py`: پروفایل، OTP و اتصال به احراز هویت استاندارد.
`as_industries/public/js/account.js`: فرم‌ها با کلاس‌ها و استایل‌های موجود.
`public/js/app-navigation.js` هر دو اپ: مالکیت مسیر مشترک account.
`tools/build.py`: تولید فایل صفحه از منبع HTML؛ تغییر فایل تولیدی باید از منبع ساخته شود.

## وضعیت اتصال

در زمان پیاده‌سازی، SMS Settings و Google Social Login Key روی سایت فعال نبودند.
فرم‌ها در این حالت پیام تنظیم‌نشدن سرویس نشان می‌دهند و ورود موفق نمایشی نمی‌سازند.

## فرم‌های ورود مشتری

انتخاب مستقیم ورود با رمز: `/as-industries?lang=fa#/account?mode=password`
انتخاب مستقیم ورود با پیامک: `/as-industries?lang=fa#/account?mode=otp`
گزینه استاندارد Allow Login Using User Name در System Settings همین سایت فعال شده است.
هر دو فرم از همان نشست حساب مرکزی استفاده می‌کنند و بعد از ورود، پروفایل نمایش داده می‌شود.

## CSRF درخواست‌های POST

فرم حساب قبل از هر POST، از endpoint نشست همین سایت توکن تازه می‌گیرد. درخواست با credentials=same-origin و هدر X-Frappe-CSRF-Token ارسال می‌شود. فقط CSRFTokenError یک‌بار تکرار می‌شود؛ خطاهای اعتبارسنجی ۴۱۷ دوباره ارسال نمی‌شوند.
برای کدهای دیگر همین صفحه می‌توان از AS_ACCOUNT.request(method, data) استفاده کرد. method نام نقطه‌ای endpoint است، مانند as_industries.account.save_profile.
۴۱۷ سرویس پیامک تنظیم‌نشده با CSRF فرق دارد؛ فرم پیش از ارسال کد وضعیت سرویس را بررسی می‌کند. اعتبارسنجی CSRF سرور فعال مانده است.

## ثبت‌نام موقت بدون OTP

فعلاً ثبت‌نام با نام، نام کاربری، ایمیل، موبایل و رمز از endpoint register انجام می‌شود و کاربر پس از ساخت حساب وارد پروفایل می‌شود. این مسیر به تنظیمات پیامک یا ایمیل نیاز ندارد. شماره هنوز تأییدشده محسوب نمی‌شود؛ در User.phone ذخیره می‌شود تا بتوان ثبت‌نام تکراری را رد کرد. بعد از تأیید واقعی OTP در User.mobile_no نیز ثبت می‌شود.
برای بازگرداندن مرحله پیامکی، پس از فعال‌سازی سرویس، مقدار SIGNUP_REQUIRES_OTP در account.py را True کنید؛ فرم مرحله پیامکی را از وضعیت سرور می‌خواند. مسیر ورود OTP و تأیید شماره در پروفایل حفظ شده‌اند.

## صفحه مستقل پروفایل

مسیر #/account برای ورود و ثبت‌نام است. مسیر #/profile صفحه مستقل پروفایل مشتری است.
بعد از ورود یا ثبت‌نام، کاربر به #/profile هدایت می‌شود. مشاهده پروفایل بدون ورود، کاربر را به فرم ورود برمی‌گرداند. هر دو اپ لینک Profile دارند و مسیر مشترک به سایت صنایع می‌رود. پروفایل از کارت‌ها و استایل‌های فعلی استفاده می‌کند و قالب مستقل profilePage.html دارد.

## Profile dashboard

The /profile route uses a dark dashboard with the existing website header. The sidebar reuses the header brand markup. Personal details use the existing save_profile API; password and mobile verification use the existing account handlers. Account activity shows the current user creation/last_login dates and successful changes during the current page visit. Historical event storage and a two-factor settings switch are not part of this UI. Profile CSS is scoped to dashboard classes, with desktop, tablet and mobile layouts.

## Profile photo

The profile photo picker posts multipart FormData to as_industries.account.upload_profile_image, using the current session and CSRF token. JPEG, PNG and WebP uploads are limited to 5 MB and 20 million pixels, re-encoded as PNG without metadata and resized within 1024 x 1024. The resulting private Frappe File is attached to the current User.user_image. The endpoint accepts no target user ID. Existing photos are retained as files when replaced.

## Registration identities and password login

Password signup now requires full name, unique username, email and Iranian mobile. Display names may be shared. Phone is stored in User.phone until an SMS code proves ownership; User.mobile_no remains the verified number. Duplicate checks include both fields and canonical country-code variants. AS registration and linking share a Redis lock held through database commit. Password login resolves username/email/phone to the User ID and runs the native Frappe login manager, preserving disabled-account, lockout, password policy and 2FA behavior. Previously registered internal-ID accounts remain accessible with their original username and password. Site databases remain separate; use the central Industries account URL.

Before mounting the account UI, the configured Industries account URL is enforced, preserving language and hash. This prevents a page opened under the Shop/localhost host from selecting a different Frappe database. Legacy mobile values are normalized during duplicate matching too, including Persian digits and whitespace.
