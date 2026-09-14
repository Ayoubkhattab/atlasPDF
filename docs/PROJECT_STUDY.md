# دراسة هندسية وأمنية شاملة لمشروع AtlasPDF

> تاريخ الدراسة: 2026-09-13
> الهدف: توثيق كل تفاصيل المشروع (البنية، الميزات، الأمن) قبل الشروع في: (1) إعادة التسمية بهوية خاصة، (2) الرفع على سيرفر خاص، (3) التشغيل الكامل بدون إنترنت.

## حالة التنفيذ (محدَّثة 2026-09-13)

**المرحلتان 1 و2 من القسم 9 نُفِّذتا فعليًا** (العزل الشبكي الكامل + التنظيف التقني) — لم يعد هذا الملف مجرد دراسة نظرية لهذين الجزئين. ملخص ما تغيّر فعليًا في الكود:

- تعطيل نظام التحديث بالكامل، إزالة الوسيطين، تجهيز DjVu.js وكل خطوط Noto وTesseract.js (worker+core+10 لغات) محليًا بالكامل تحت `public/`.
- إضافة CSP صارم في `next.config.js` وكل ملفات النشر البديلة (`nginx.conf`, `vercel.json`, `netlify.toml`, `.htaccess`, `security-headers.conf`, `public/_headers`) وتشديد CSP في `src-tauri/tauri.conf.json`.
- ضمانات كود لمنع تفعيل القدرات الكامنة (zgapdfsigner, jspdf, html2canvas, Pyodide, معامل `?demo=`)، وتصحيح تعليقات أمنية في `src-tauri/src/main.rs`.
- تنظيف: حذف `zustand` غير المستخدمة، حذف `pymupdf.js`/`pymupdf-lite.js` اليتيمين، تصحيح تعليق عدد الأدوات (132)، مواءمة `eslint-config-next`، وتصحيح شامل لتضليل أداة "Trusted Timestamp" (الشهادة المُصدَرة + واجهة المستخدم + ترجمة إنجليزية جديدة كاملة).
- **اكتشاف وإصلاح عرضي (خارج نطاق الدراسة الأصلية لكنه كان يمنع البناء بالكامل)**: 26 خطأ TypeScript موجود مسبقًا في الكود (توافق `pdfjs-dist` v6 مع استدعاءات `page.render()`/`getDocument()`) كانت تمنع `npm run build` من النجاح إطلاقًا بغض النظر عن أي من تعديلات هذه الدراسة — تم إصلاحها جميعًا. تم التحقق أنها كانت موجودة قبل بدء هذا العمل (عبر مقارنة `git stash`).
- تم أيضًا إصلاح تعارض بين سكربت تقطيع الأصول الكبيرة (`chunk-assets.mjs`، مخصص لتجاوز حد Cloudflare Pages 25MB) وملف بيانات لغة `chi_tra.traineddata.gz` (25.9MB) الذي لا يفهمه Tesseract.js لو تم تقطيعه.
- **التحقق**: `npm run build` ينجح بالكامل الآن (2181 صفحة ثابتة)، `npx tsc --noEmit` صفر أخطاء، واختبارات Vitest كلها تمر باستثناء 3 ملفات اختبار (23 اختبارًا) فشلها **موجود مسبقًا وغير مرتبط بهذا العمل** (تم التحقق بمقارنة مباشرة مع حالة الكود الأصلية عبر git).

**المرحلة 3 (إعادة التسمية/الهوية) لم تُنفَّذ بعد** — بانتظار الاسم/النطاق/الشعار من المستخدم. باقي أقسام هذا الملف (1-8 والملحق) تبقى دراسة/مرجعًا كما هي.

---

## 1. مقدمة وملخص تنفيذي

**AtlasPDF** هو تطبيق ويب/سطح مكتب لمعالجة ملفات PDF مبني بـ **Next.js 16** (App Router) و**React 19**، مُصدَّر بالكامل كموقع **ثابت (`output: 'export'`)** — أي **لا يوجد أي سيرفر Backend أو API خلفي**. كل المعالجة (دمج، تقسيم، ضغط، تحويل، توقيع، OCR...) تتم **داخل متصفح المستخدم** عبر مكتبات JS ومحركات WebAssembly.

النقاط الأهم التي يجب معرفتها قبل أي تعديل:

1. **الأصل**: المشروع هو إعادة هندسة (fork معلن) لمشروع مفتوح المصدر [BentoPDF](https://github.com/alam00000/bentopdf)، مذكور صراحة في `README.md`.
2. **الترخيص**: **AGPL-3.0** بالكامل — له تبعات قانونية مباشرة على خطة "إعادة التسمية + النشر" (انظر القسم 6.5).
3. **لا يوجد Backend حقيقي**: لا حسابات مستخدمين، لا قاعدة بيانات، لا مصادقة، لا نظام دفع/اشتراك. النشر = تقديم ملفات ثابتة فقط (HTML/JS/CSS/WASM).
4. **يوجد غلاف سطح مكتب (Tauri v2 / Rust)** يستهلك نفس البناء الثابت (`../out`) بدون واجهة منفصلة.
5. **المشروع "خصوصية أولاً" من حيث محتوى الملفات** (لا يوجد رفع لملفات PDF لأي سيرفر)، **لكنه ليس معزولاً عن الإنترنت فعليًا** — توجد عدة نقاط اتصال خارجية (تحديثات، خطوط، مكتبات) يجب تعطيلها/تحويلها محليًا قبل اعتباره "يعمل بدون إنترنت 100%" (تفصيل كامل في القسم 5).
6. **132 أداة PDF** فعلية ومطبَّقة بالكامل (وليست حشوًا) موزعة على 6 فئات.

---

## 2. البنية التقنية (Architecture)

### 2.1 المكدس التقني

| الطبقة | التقنية |
|---|---|
| إطار العمل | Next.js `^16.3.5` (App Router)، `output: 'export'` (موقع ثابت 100%، لا Server Runtime) |
| الواجهة | React `^19.0.0`، TypeScript `^5.6.3`، Tailwind CSS `^4.0.0` (عبر `@tailwindcss/postcss`) |
| الأيقونات | `lucide-react`, `@phosphor-icons/web` |
| إدارة الحالة | React Context + hooks مخصصة (`zustand ^5.0.0` **مُدرَج في package.json لكنه غير مُستخدم إطلاقًا** في `src/`) |
| سطح المكتب | **Tauri v2** (Rust) — `@tauri-apps/api ^2.11.0`, `@tauri-apps/cli ^2.11.1`, `tauri-plugin-dialog`, `tauri-plugin-fs` |
| معالجة PDF | `pdf-lib` (83 ملف استخدام)، `pdfjs-dist ^6.3.289` (32 ملف) + نسخة قديمة موازية `pdfjs-dist-legacy` (مُلقَّم إلى `pdfjs-dist@^2.16.105`) |
| OCR | `tesseract.js ^6.0.1` |
| تحويل Office | `@matbee/libreoffice-converter ^2.5.0` (LibreOffice WASM حقيقي) + Pyodide/PyMuPDF كبديل احتياطي |
| توقيعات رقمية | `node-forge`, `zgapdfsigner`, بيانات PDF عبر `pdf-lib` |
| بناء الحوار المرئي | `reactflow ^11.11.4` (محرر Workflow) |
| الترجمة | `next-intl ^4.1.0` — 15 لغة |
| الاختبار | `vitest ^4.1.11` + Testing Library + `fast-check` (property-based testing) |

### 2.2 هيكل المجلدات الرئيسية

```
atlaspdf/
├── src/
│   ├── app/              # Next.js App Router (المسارات، بما فيها [locale])
│   ├── components/       # واجهات كل أداة PDF + عناصر UI عامة + محرر Workflow
│   ├── lib/               # منطق معالجة PDF (pdf/, libreoffice/, i18n/, workflow/, hooks/)
│   ├── config/            # سجل الأدوات (tools.ts)، محتوى SEO لكل أداة/لغة، site.ts
│   └── types/
├── src-tauri/             # غلاف سطح المكتب (Rust)
├── public/                # أصول ثابتة: pdf.js، محركات WASM، خطوط، Service Workers
├── messages/              # ملفات ترجمة JSON (15 لغة)
├── extension/             # إضافة متصفح Manifest V3 (رابط لموقع الويب المستضاف)
├── scripts/               # أدوات بناء Node (فك ضغط WASM، تقطيع الأصول، مزامنة pdf.js)
├── nix/ + flake.nix       # حزمة NixOS/home-manager
└── ملفات نشر: Dockerfile, docker-compose.yml, nginx.conf, vercel.json, netlify.toml, .htaccess
```

### 2.3 قنوات التوزيع/النشر الحالية (مُهيّأة بالفعل في المشروع)

المشروع جاهز فعليًا للنشر على قنوات متعددة (موثّقة في `DEPLOYMENT.md`، 682 سطرًا):

| القناة | الحالة | ملاحظة |
|---|---|---|
| Vercel | جاهز (`vercel.json`) | موصى به من فريق BentoPDF/AtlasPDF الأصلي |
| Netlify | جاهز (`netlify.toml`) | |
| GitHub Pages | جاهز (`deploy.yml`) | ⚠️ لا يدعم رؤوس HTTP مخصصة → **أدوات تحويل Office لن تعمل** (تحتاج COOP/COEP لـ SharedArrayBuffer) |
| Cloudflare Pages | جاهز | يستخدم آلية تقطيع أصول مخصصة لتجاوز حد 25MB لكل ملف |
| **Docker + Nginx (self-hosted)** | **جاهز بالكامل** — هذا هو المسار الأنسب لسيناريو "سيرفر خاص" | `docker-compose.yml` (خدمات `web-dev`/`builder`/`web`)، `Dockerfile` (مرحلتين: build بـ Node 22 ثم تقديم عبر `nginx:1.25-alpine`)، `nginx.conf` جاهز بكل الرؤوس المطلوبة |
| Nginx/Apache بدون Docker | جاهز (تعليمات + `.htaccess` جاهز) | |
| AWS S3+CloudFront, Firebase Hosting | موثّقة في الدليل لكن بدون ملفات تهيئة جاهزة بالمستودع | |
| Nix/NixOS | جاهز (`flake.nix`, `nix/package.nix`, `nix/nixos-module.nix`) | قناة توزيع إضافية غير شائعة |
| Tauri Desktop | جاهز (`dmg, msi, nsis, deb, appimage`) | بلا توقيع رقمي (unsigned builds) |

**خلاصة لسيناريو "سيرفر محلي خاص"**: الخيار الأنسب والجاهز فعليًا هو **Docker + Nginx** (`docker compose --profile prod up --build`) لأنه لا يعتمد على أي منصة سحابية خارجية، ويُشغَّل بالكامل داخل الشبكة المحلية.

### 2.4 متغيرات البيئة

**لا يوجد أي ملف `.env`/`.env.example` في المشروع** — لا أسرار ولا مفاتيح API مطلقًا. المتغيرات المستخدمة تُمرَّر فقط عبر أوامر البناء/CI:

| المتغير | الاستخدام |
|---|---|
| `BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` | نشر تحت مسار فرعي (subpath hosting) |
| `TAURI_ENV`, `TAURI_ENV_PLATFORM` | يُفعَّل أثناء بناء نسخة سطح المكتب |
| `APP_VERSION` / `NEXT_PUBLIC_APP_VERSION` | رقم الإصدار المستخدم في نظام التحديث |
| `NEXT_PUBLIC_BUILD_DATE` | تاريخ البناء (يُستخدم في مقارنة الإصدارات) |
| `NODE_ENV`, `DOCKER_BUILD`, `SKIP_CHUNKING` | إعدادات بناء داخلية |
| `WATCHPACK_POLLING`, `CHOKIDAR_USEPOLLING` | لمراقبة الملفات داخل حاويات Docker |

> ملاحظة من `DEPLOYMENT.md`: يذكر الدليل متغيرين اختياريين وهميين (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GA_ID`) كأمثلة لتحليلات مستقبلية، **لكنهما غير مستخدمين فعليًا في أي كود حاليًا** (لا يوجد Google Analytics أو أي SDK تتبّع في المشروع).

### 2.5 GitHub Actions (5 مسارات CI/CD)

| الملف | الوظيفة |
|---|---|
| `build-tauri.yml` | بناء تطبيق سطح المكتب على ويندوز/ماك/لينكس (بدون توقيع رقمي) |
| `deploy.yml` | نشر تلقائي إلى GitHub Pages عند كل push لـ `main` |
| `docker-publish.yml` | بناء ونشر صورة Docker متعددة المعمار (amd64/arm64) إلى GHCR |
| `release.yml` | إصدار GitHub Release تلقائي يجمع بناء سطح المكتب + نسخة الويب المضغوطة |
| `sync-fork.yml` | مزامنة يومية تلقائية لأي fork مع مستودع `Ayoubkhattab/atlasPDF` الأصلي (يعمل فقط إن كان المستودع fork) |

> **هام لخطة "الهوية الخاصة"**: كل هذه المسارات تشير إلى `Ayoubkhattab/atlasPDF` كمستودع مصدر، وستحتاج تعديلًا كاملاً (أو تعطيلًا) عند تغيير الهوية، خصوصًا `sync-fork.yml` الذي سيسحب تحديثات من المستودع الأصلي إن تُرك مفعّلاً.

---

## 3. جرد الميزات الكامل (132 أداة)

سجل الأدوات موجود بالكامل في `src/config/tools.ts` (1703 سطر — تعليق الترويسة قديم يقول "67 أداة" بينما العدد الفعلي **132**). كل أداة لها: `id`, `slug`, `category`, `acceptedFormats`, `maxFiles`. التوجيه الديناميكي `src/app/[locale]/tools/[tool]/page.tsx` يعرض المكوّن المناسب عبر `switch`.

### 3.1 التصنيفات الست

| الفئة | العدد التقريبي | أمثلة رئيسية |
|---|---|---|
| **organize-manage** (تنظيم وإدارة) | ~37 | merge-pdf, split-pdf, organize-pdf, delete/extract-pages, rotate-pdf, n-up-pdf, compare-pdfs, bookmark, page-labels, pdf-booklet, view/edit-metadata |
| **convert-to-pdf** (تحويل إلى PDF) | ~24 | jpg/png/webp/svg/bmp/heic/tiff-to-pdf, word/excel/pptx/rtf-to-pdf, epub/mobi/djvu/fb2-to-pdf, markdown-to-pdf, email-to-pdf |
| **convert-from-pdf** (تحويل من PDF) | ~14 | pdf-to-jpg/png/webp/svg، pdf-to-docx/pptx/excel، pdf-to-markdown، **ocr-pdf** |
| **edit-annotate** (تحرير وتعليق) | ~30 | edit-pdf (وضعان: محرر كلاسيكي + تحرير مباشر للمحتوى)، sign-pdf، crop-pdf، add-watermark، header-footer، form-filler/creator، redact-pdf، overlay-pdf |
| **optimize-repair** (تحسين وإصلاح) | ~15 | compress-pdf، repair-pdf، sanitize/deep-sanitize-pdf، flatten-pdf، pdf-to-pdfa، deskew-pdf |
| **secure-pdf** (أمان وتشفير) | ~12 | encrypt/decrypt-pdf، remove-restrictions، digital-sign-pdf، validate-signature، cert-cryptor |

بالإضافة إلى مجموعة أدوات "متخصصة/نادرة" لكنها مطبَّقة بالكامل: `ai-pdf-reflower`, `citation-linker`, `vector-extractor`, `smart-data-redactor`, `global-invoice-parser`, `passport-id-composer`, `extract-tables`, `pdf-reader`، وغيرها (~25 أداة إضافية).

### 3.2 صفحات غير مرتبطة بأداة محددة

- `/tools` — دليل/بحث في كل الأدوات
- `/tools/category/[category]` — عرض حسب الفئة
- `/workflow` — **محرر Workflow مرئي** مبني على `reactflow`، يسمح بربط عدة أدوات في خط معالجة تلقائي، مع أكثر من 23 قالبًا جاهزًا (`src/config/workflow-templates.ts`)
- `/about`, `/contact`, `/faq`, `/privacy`

### 3.3 معمارية المعالجة (بالكامل client-side)

لا يوجد `src/app/api/` ولا أي `route.ts` — **صفر منطق سيرفر**. كل معالجة PDF تتم عبر:

1. **pdf-lib / pdfjs-dist**: معظم عمليات التلاعب الأساسي بالصفحات والبنية (دمج، تقسيم، تدوير، ميتاداتا...).
2. **Web Workers مخصصة** (`public/workers/*.worker.js`): لمهام أثقل (ضغط، استخراج مرفقات/صور، فهرسة، تحويلات صيغ متعددة).
3. **محركات WASM متخصصة**:
   - **QPDF (`qpdf.wasm`) + CoherentPDF (`coherentpdf.browser.min.js`)**: للضغط، الإصلاح، التشفير/فك التشفير، الصلاحيات، linearize.
   - **LibreOffice WASM حقيقي** (`public/libreoffice-wasm/`, ~170MB): محرك أساسي لتحويل Word/Excel/PPT/RTF ↔ PDF.
   - **Pyodide + PyMuPDF (Python في WASM)** (`public/pymupdf-wasm/`, ~65MB): بديل احتياطي عند فشل LibreOffice، والمحرك الوحيد لتحويلات PDF→DOCX/PPTX/XLSX.
   - **Tesseract.js**: OCR بالكامل داخل المتصفح.
   - **DjVu.js**: محرك خارجي (**غير مُجمَّع محليًا** — انظر القسم 5).
4. **محرر PDF مباشر** (`EditPDFTool.tsx`): يضمّن تطبيق WASM منفصلاً بالكامل عبر `<iframe sandbox>` (`public/direct-pdf-editor/`، يتضمن `editcore.wasm` بحجم 7MB) — يبدو محرك تحرير محتوى PDF منخفض المستوى من طرف ثالث بدون نص ترخيص/حقوق نشر واضح داخل الحزمة المصغّرة — **يستحق تحديد مصدره وترخيصه بدقة قبل إعادة التوزيع تحت هوية جديدة**.

**العزل عبر الأصل (Cross-Origin Isolation)**: لأن LibreOffice WASM وPyodide يحتاجان `SharedArrayBuffer` (تعدد خيوط)، يفرض `next.config.js` رؤوس `COOP: same-origin` و`COEP: require-corp` عالميًا، مع خدمة Worker احتياطية (`public/coi-serviceworker.js`) للمنصات التي لا تدعم رؤوس HTTP مخصصة (كـ GitHub Pages).

### 3.4 نظام الترجمة (i18n)

- المكتبة: `next-intl ^4.1.0`.
- **15 لغة**: `en, ja, ko, es, fr, de, zh, zh-TW, pt, ar, it, id, vi, ro, pl` (تعريف في `src/lib/i18n/config.ts`).
- دعم RTL كامل للعربية.
- ملفات الترجمة العامة: `messages/<locale>.json`. محتوى SEO لكل أداة منفصل في `src/config/tool-content/<locale>.ts` (بعض اللغات تفتقد ملف محتوى مخصص وتعتمد على الإنجليزية كافتراضي).

### 3.5 تطبيق سطح المكتب (Tauri v2)

- `identifier: "com.atlaspdf.app"`, `productName: "AtlasPDF"`.
- يستهلك **نفس** بناء الويب الثابت (`frontendDist: "../out"`) — لا توجد واجهة سطح مكتب منفصلة.
- أوامر Rust مخصصة (`src-tauri/src/main.rs`): `open_files`, `save_file`, `read_file`, `write_file`, `get_temp_dir`, `open_url`.
- وضع "Portable" على ويندوز: عند وجود `portable.txt` أو مجلد `data/` بجانب الملف التنفيذي، يُعاد توجيه بيانات WebView2 محليًا (تطبيق محمول بالكامل بدون تثبيت).
- صلاحيات معلنة (`capabilities/default.json`): `core:default, dialog:default, fs:default` فقط.

### 3.6 آلية التحديث (ليست Tauri Updater الرسمي)

نظام مخصص بالكامل في `src/lib/updater.ts` (تفصيل كامل في القسم 5.1) — يفحص GitHub Releases عند كل إقلاع لتطبيق سطح المكتب، ويوجّه المستخدم لتنزيل يدوي من المتصفح (لا تحديث تلقائي صامت).

### 3.7 غياب أي نظام حسابات/دفع

تم التأكد (بحث شامل عن `license/premium/subscription/stripe/payment/trial/paywall`) أن **لا يوجد أي نظام مصادقة، حسابات مستخدمين، اشتراكات، أو بوابات دفع**. كل الأدوات مجانية وبدون حد لحجم الملف (`maxFileSize: Infinity` في كل مكان).

### 3.8 آلية عمل OCR بالتفصيل

الكود الكامل في `src/lib/pdf/processors/ocr.ts` (المنطق) و`src/components/tools/ocr/OCRPDFTool.tsx` (الواجهة).

**المحرك**: **Tesseract.js** بالكامل، يعمل داخل متصفح المستخدم عبر Web Worker خاص به (مختلف عن الـ Web Workers المخصصة في `public/workers/`). لا يوجد أي اتصال بسيرفر AtlasPDF لإجراء التعرّف نفسه.

**خط الأنابيب (Pipeline) خطوة بخطوة**:

1. **كشف نوع الملف**: قراءة أول بايتات الملف (magic bytes) لتحديد PDF أم صورة (PNG/JPEG/WebP/BMP)، بدل الاعتماد على الامتداد فقط.
2. **إن كان الملف صورة** → يُحوَّل أولاً إلى PDF من صفحة واحدة عبر `pdf-lib` (`embedPng`/`embedJpg`، أو رسمه على `<canvas>` وتصديره PNG لصيغ أخرى كـ WebP/BMP) — لتوحيد باقي الخط بغض النظر عن نوع الإدخال.
3. **تحميل PDF عبر pdfjs-dist** وتحديد الصفحات المطلوبة (الكل افتراضيًا، أو نطاق محدد).
4. **تهيئة Tesseract**: `Tesseract.createWorker(langString, 1, ...)` حيث يمكن دمج عدة لغات معًا بـ `+` (مثلاً `eng+ara`). اللغات المدعومة (10): الإنجليزية، الصينية (مبسطة/تقليدية)، اليابانية، الكورية، الإسبانية، الفرنسية، الألمانية، البرتغالية، العربية.
5. **لكل صفحة**:
   - تُرسَم كصورة على `<canvas>` بمقياس تكبير (`scale`, افتراضي 2×) — مقياس أعلى = دقة أفضل وسرعة أقل.
   - **تحسين تلقائي للتباين** (`enhanceContrast`, مفعّل افتراضيًا عبر `preprocessCanvas`): حساب السطوع (luminance) لكل بكسل، تمديد التباين خطيًا، ثم تطبيق منحنى لتغميق النص وتفتيح الخلفية — مصمم لتحسين نتائج المستندات الممسوحة ضوئيًا/الإيصالات الباهتة.
   - تمرير الصورة إلى `tesseractWorker.recognize()` مع طلب `text + blocks + hocr` للحصول على النص **وإحداثيات كل كلمة (bounding box) ومستوى الثقة (confidence)**.
   - تحويل الإحداثيات من نظام الـ canvas (بكسل) إلى نظام إحداثيات PDF (نقاط، محور Y مقلوب).
6. **توليد المخرج حسب الصيغة المختارة** (4 خيارات في الواجهة):
   - **نص عادي** (`.txt`) أو **Markdown** (`.md`، عنوان لكل صفحة).
   - **JSON**: نص كل صفحة + قائمة كلمات مع bbox وconfidence — مفيد للمعالجة البرمجية اللاحقة.
   - **PDF قابل للبحث** (`searchable-pdf`، **الخيار الافتراضي في الواجهة**): يأخذ ملف الـ PDF **الأصلي** (وليس الصور المُرسومة) ويرسم فوق كل صفحة **طبقة نص غير مرئية** (`opacity: 0.0`) في نفس موضع كل كلمة مكتشَفة وبنفس حجمها التقريبي. النتيجة: الشكل المرئي يبقى صورة المسح الأصلية تمامًا، لكن الملف يصبح قابلاً للبحث والتحديد والنسخ نصيًا. لدعم اللغات غير اللاتينية في هذه الطبقة، يُسجَّل `fontkit` ويُحمَّل خط `NotoSansSC-Regular.ttf` المحلي (نفس الخط المستخدم في تحويل Excel، القسم 5.1 بند 6)، مع رجوع لخط Helvetica القياسي للنص اللاتيني.

**نقطة مهمة تربط بجاهزية العمل بدون إنترنت (انظر القسم 5.1 بند 5)**: الكود **لا يحدد** `workerPath`/`corePath`/`langPath` عند إنشاء الـ worker، لذلك يعتمد Tesseract.js على إعداداته الافتراضية التي تُحمِّل من **jsdelivr CDN**: (1) سكربت الـ worker الخاص بمكتبة tesseract.js، (2) نواة WASM (`tesseract-core`, نسخة simd/non-simd)، (3) ملف `.traineddata` لكل لغة تُختار (عدة ميجابايتات إلى عشرات الميجابايتات). هذا يحدث مرة واحدة فقط لكل لغة (يُخزَّن محليًا لإعادة الاستخدام)، لكنه يعني أن الأداة تفشل بالكامل في أول استخدام offline لأي لغة لم تُحمَّل من قبل.

**خصوصية**: محتوى الملف (PDF/الصورة) نفسه لا يغادر جهاز المستخدم أبدًا — المعالجة كاملة محلية بعد اكتمال تحميل نماذج اللغة لمرة واحدة.

---

## 4. إضافة المتصفح (extension/)

توجد إضافة Chrome/متصفح منفصلة (Manifest V3) باسم "AtlasPDF - PDF Tools"، لكنها **ليست أداة محلية** — وظيفتها الوحيدة هي فتح الموقع المستضاف `https://atlaspdf.mis-pts.org` من قائمة السياق (`extension/background.js`). **هذه الإضافة غير مفيدة إطلاقًا لسيناريو "سيرفر خاص محلي بدون إنترنت"** وستحتاج إما حذفًا أو إعادة تصميم كامل لتشير إلى دومين السيرفر الخاص.

---

## 5. التقرير الأمني وجاهزية العمل بدون إنترنت

هذا القسم هو الأهم بالنسبة لهدف "تشغيل بدون إنترنت على سيرفر محلي" — يسرد **كل** نقطة اتصال خارجية مكتشفة في الكود.

### 5.1 جدول نقاط الاتصال الخارجية

| # | المصدر (ملف) | الجهة الخارجية | الغرض | جاهز للعمل offline؟ |
|---|---|---|---|---|
| 1 | `src/lib/updater.ts` (فحص التحديث) | `api.github.com` + وسيطان: `gh-proxy.com`, `mirror.ghproxy.com` | التحقق من وجود إصدار جديد + تنزيل التحديثات | ❌ **يجب تعطيله بالكامل** — يعمل تلقائيًا عند كل إقلاع لتطبيق سطح المكتب (`UpdateCheckButton.tsx`) |
| 2 | `src/lib/pdf/processors/djvu-to-pdf.ts` | `https://djvu.js.org/assets/dist/djvu.js` | تحميل مكتبة DjVu-to-PDF عبر `<script>` وقت التشغيل | ❌ **لا توجد نسخة محلية إطلاقًا** — الأداة ستفشل بالكامل بدون إنترنت |
| 3 | `src/lib/pdf/processors/text-to-pdf.ts` | `raw.githack.com` (8 خطوط Noto: لاتيني/CJK×3/عربي/عبري/تايلندي/هندي) | تضمين خطوط متعددة اللغات عند إنشاء PDF من نص | ⚠️ يعمل offline **فقط بعد** أول تنزيل ناجح (تُخزَّن في IndexedDB) |
| 4 | `src/lib/pdf/processors/watermark.ts` | `raw.githack.com` (خط CJK واحد) | نص العلامة المائية بالصينية/اليابانية/الكورية | ⚠️ نفس حالة البند 3 |
| 5 | `src/lib/pdf/processors/ocr.ts` (عبر إعدادات Tesseract.js الافتراضية) | `cdn.jsdelivr.net` (worker + core WASM + بيانات كل لغة OCR) | تشغيل محرك OCR وتحميل نماذج اللغات | ❌ **لا يوجد أي تهيئة محلية حاليًا** (`workerPath`/`corePath`/`langPath` غير محددة) — أداة OCR ستفشل بالكامل بدون إنترنت |
| 6 | `public/workers/excel-to-pdf.worker.js` | ~~`cdn.jsdelivr.net` / `raw.githubusercontent.com`~~ | خط CJK احتياطي لتحويل Excel→PDF | ✅ **تم إصلاحه بالفعل** (commit `d065dc9`) — أصبح يجلب `/fonts/NotoSansSC-Regular.ttf` محليًا، مع fallback سليم لخط PyMuPDF المدمج |
| 7 | `src/config/site.ts`, `Header.tsx`, `Footer.tsx`, `ContactPageClient.tsx` | روابط GitHub/X (`github.com/Ayoubkhattab/atlasPDF`, `x.com/AtlasPDFTool`) | روابط تعريفية فقط (لا تُنفَّذ طلبات تلقائية) | 🔶 لا تُخِلّ بالعمل offline لكنها تحمل الهوية القديمة — يجب تغييرها ضمن إعادة التسمية |
| 8 | `extension/manifest.json`, `extension/background.js` | `atlaspdf.mis-pts.org` | فتح الموقع المستضاف من الإضافة | 🔶 غير ذي صلة بالتطبيق الأساسي؛ الإضافة نفسها غير مناسبة لسيناريو محلي (انظر القسم 4) |

**لا توجد** أي أدوات تحليلات/تتبّع (Google Analytics, Sentry, Plausible, PostHog...) في المشروع إطلاقًا — نقطة إيجابية.

### 5.2 سياسات أمان المحتوى (CSP)

- **نسخة الويب (nginx/vercel/netlify/next.config.js)**: **لا يوجد أي رأس `Content-Security-Policy` مُعرَّف إطلاقًا** — فقط رؤوس عامة (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP/COEP/CORP). هذه ثغرة تصميمية تعني أن أي نقطة اتصال خارجية في الكود (القسم 5.1) تعمل بحرية بدون أي قيد على مستوى المتصفح.
- **نسخة Tauri** (`src-tauri/tauri.conf.json`): يوجد CSP لكنه **فضفاض**:
  ```
  connect-src 'self' data: blob: https:;
  img-src 'self' data: blob: https:;
  script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';
  ```
  السماح بـ `https:` في `connect-src`/`img-src` يعني السماح بالاتصال بـ **أي** خادم HTTPS في العالم — وهو ما يسمح فعليًا بكل نقاط الاتصال في الجدول أعلاه (باستثناء djvu.js.org الذي يُحظر فعلاً بواسطة `script-src` الحالي لأنه لا يشمل `https:`، مما يعني **أداة DjVu-to-PDF معطوبة بالفعل في نسخة سطح المكتب** بغض النظر عن الاتصال بالإنترنت).
  > **توصية**: لتحقيق عزل حقيقي عن الإنترنت (وليس الاعتماد فقط على تعديل كل استدعاء في الكود يدويًا)، يجب تضييق `connect-src`/`img-src` لإزالة `https:` تمامًا (`'self' data: blob:` فقط)، وإضافة CSP مماثل صارم في نسخة الويب أيضًا.

### 5.3 صلاحيات Tauri ونطاق الوصول للنظام

- الصلاحيات المُعلنة رسميًا محدودة: `core:default, dialog:default, fs:default`.
- **لكن** أوامر Rust المخصصة في `src-tauri/src/main.rs` تتجاوز نظام الصلاحيات (ACL) الخاص بالإضافات الرسمية لأنها مسجَّلة مباشرة كـ `#[tauri::command]`:
  - `read_file(path)` / `write_file(path, data)`: **لا يوجد أي تقييد لنطاق المسار (path scoping)** — أي كود JS داخل التطبيق (بما فيه محتوى PDF ضار محتمل يُعالَج عبر مكوّن معطوب) يمكنه نظريًا قراءة/كتابة أي ملف يستطيع الوصول إليه المستخدم على القرص.
  - `open_url(url)`: يتحقق فقط أن الرابط يبدأ بـ `http://`/`https://` ثم يُطلق أمر نظام تشغيل (`cmd /c start` / `open` / `xdg-open`) — ليس عرضة لحقن أوامر مباشر (المعاملات منفصلة)، لكنه يسمح لأي كود JS بفتح متصفح خارجي بأي رابط.
  - **توصية أمنية عامة** (بمعزل عن هدف عدم الاتصال بالإنترنت): تقييد `read_file`/`write_file` بنطاق مجلدات محددة، وتقييد `open_url` (مثلاً لصفحة التحديث فقط، أو حذفه بالكامل إذا أُلغي نظام التحديث).

### 5.4 قضية ثقة يجب الإفصاح عنها: "Trusted Timestamp" وهمي

أداة `timestamp-pdf` (`src/lib/pdf/processors/timestamp.ts`) تعرض للمستخدم اختيار جهة توثيق زمني حقيقية من قائمة (`MeSign`, `DigiCert`, `Sectigo`, `SSL.com`, `FreeTSA`)، لكنها **لا تتصل فعليًا بأي خادم TSA حقيقي** — بدلاً من ذلك تُنشئ شهادة موقّعة ذاتيًا محليًا عبر `node-forge` وتُسمّيها مثلاً `"Trusted TSA Server: DigiCert"`. هذا **إيجابي** لهدف العمل بدون إنترنت (لا اتصال خارجي أصلاً)، لكنه **تضليل واضح للمستخدم النهائي** يوحي بحصوله على ختم زمني قانوني حقيقي من RFC 3161 بينما هو تزييف محلي بالكامل — يُنصح بتصحيح النص المعروض للمستخدم (توضيح أنه ختم زمني محلي وليس من جهة خارجية معتمدة) بغض النظر عن قرار إعادة التسمية.

### 5.5 الترخيص والالتزامات القانونية (مهم جدًا قبل إعادة التسمية والتوزيع)

- المشروع بالكامل مرخّص **GNU AGPL-3.0**.
- **المادة 13 من AGPL ("Remote Network Interaction")**: إذا أُتيح البرنامج (أو نسخة معدّلة/بهوية جديدة منه) لمستخدمين عبر الشبكة — **حتى لو كان "سيرفر خاص"** — فإن أي طرف غير المالك نفسه يتفاعل مع الخدمة عبر الشبكة يحق له قانونًا طلب الحصول على الكود المصدري الكامل (شاملاً أي تعديلات) تحت نفس الرخصة. **الاستخدام الشخصي/الداخلي البحت لمستخدم واحد فقط لا يُنشئ هذا الالتزام**، لكن أي نشر يصل إليه موظفون/عملاء آخرون يُفعّله.
- **README.md يُقرّ صراحة** بأن الكود مبني على BentoPDF — يجب مراجعة ترخيص BentoPDF الأصلي أيضًا للتأكد من عدم وجود شروط إضافية، والإبقاء على إشعار الإسناد ما لم يُعَد كتابة الكود بالكامل.
- **لا يوجد ملف `NOTICE` أو `THIRD_PARTY_LICENSES`** رغم وجود عدد كبير من المحركات/الحزم المُجمَّعة التي تحمل تراخيص خاصة بها ويجب توثيقها عند إعادة التوزيع تحت هوية جديدة:
  - LibreOffice WASM → **MPL-2.0 / LGPL**
  - PyMuPDF → **AGPL-3.0 أو ترخيص تجاري مزدوج** (يستحق تحققًا إضافيًا إن كان الاستخدام تجاريًا)
  - pdf.js (Mozilla) → **Apache-2.0**
  - محرك "Direct Content Edit" (`editcore.wasm`) → **مصدر وترخيص غير واضحين من داخل الحزمة المصغّرة** — يستحق تحديدًا دقيقًا قبل أي إعادة توزيع.
- **فجوة بين الدعاية والواقع**: يذكر `README.md` أن "Your documents never leave your device" و"100% Private" — هذا صحيح بخصوص **محتوى ملفات PDF نفسها** (لم يُعثر على أي رفع لبيانات الملفات)، لكنه غير دقيق بخصوص **البيانات الوصفية**: فحص التحديث التلقائي يُرسل معلومات (إصدار التطبيق، عنوان IP ضمنيًا) إلى GitHub وخادمين وسيطين غير تابعين لكل مستخدم عند كل إقلاع.

### 5.6 سطح الثغرات المحتملة (يستحق مراجعة أعمق لاحقًا)

- **`pdfjs-dist-legacy` مثبَّتة عمدًا على نسخة قديمة (`2.16.105`)** بجانب النسخة الحديثة (`^6.3.289`) — تُستخدم حصريًا لأداة `pdf-to-svg`. النسخ القديمة من pdf.js لها ثغرات معروفة تاريخيًا، وهي تعالج ملفات PDF **غير موثوقة** من المستخدم — يستحق تقييم مخاطرة مخصص أو استبدال الحل.
- حزم أخرى تستحق مراجعة: `node-forge` (ثغرات تاريخية في مكتبات تشفير مشابهة)، `html2pdf.js` (نشاط صيانة منخفض تاريخيًا)، `zgapdfsigner` (حزمة متخصصة صغيرة، مراجعة مجتمعية محدودة).
- استخدام `dangerouslySetInnerHTML` موجود في ~20 ملفًا — يجب التأكد أن كل استخدام يمر عبر `src/lib/utils/html-sanitizer.ts`، خاصة في الأدوات التي تُعالج محتوى غير موثوق مباشرة (`markdown-to-pdf`, `PDFToMarkdownTool`, `PDFToSVGTool`).
- **لا توجد أي أسرار/مفاتيح API مكشوفة في المستودع** (تم التأكد بالبحث الشامل).

### 5.7 فحص عميق إضافي: التحقق من حزم npm وملفات WASM Glue المُجمَّعة

> يجيب هذا القسم بدقة على السؤال: "هل تحقق فعلاً أن لا أداة تصل للإنترنت أو لطرف ثالث؟" — الجدول في القسم 5.1 وثّق نقاط الاتصال في **كود AtlasPDF نفسه**. هذا القسم يذهب خطوة أعمق: تدقيق **الطبقة الداخلية للحزم والمحركات المُجمَّعة** (`node_modules/` وملفات `public/*.js` الضخمة المولَّدة آليًا) بحثًا عن أي اتصال شبكي مخفي لم يظهر في الفحص الأول.

**المنهجية**: بحث ثابت (static analysis) عبر ripgrep داخل كل حزمة/حزمة مُجمَّعة فعليًا مُستخدمة في التطبيق، عن: `fetch(`, `XMLHttpRequest`, `new WebSocket`, `importScripts(`, `navigator.sendBeacon`, روابط `http(s)://` الحرفية، وأنماط بناء روابط مموّهة (`atob(`, `String.fromCharCode`, تجميع نصوص). كل نتيجة تمت مطابقتها مع طريقة استدعاء AtlasPDF الفعلية للحزمة (المعاملات والخيارات الممرَّرة) لتحديد إن كانت نقطة اتصال **حية فعليًا** أم **معطّلة/غير قابلة للوصول** بالتهيئة الحالية.

#### أ. حزم npm (14 حزمة، بالإضافة لـ tesseract.js المُغطاة سابقًا في 3.8/5.1)

**نظيفة تمامًا (لا أي قدرة اتصال شبكي، حية أو معطّلة)**: `@pdf-lib/fontkit`, `ag-psd`, `highlight.js`, `jszip`, `marked`, `pdf-lib`.

**تحتوي قدرة اتصال لكنها معطّلة فعليًا بالتهيئة/طريقة الاستدعاء الحالية لـ AtlasPDF**:

| الحزمة | القدرة الكامنة | لماذا هي معطّلة حاليًا |
|---|---|---|
| `cropperjs` (وrareact-cropper) | XHR لقراءة EXIF من صور عبر URL خارجي | يُستدعى فقط بـ `data:` URL محلي في `CropPDFTool.tsx` → لا يُنفَّذ الفرع الشبكي أصلاً |
| `html2canvas` | XHR proxy لصور عابرة للأصل (`Cache.prototype.proxy`) | يرمي خطأ فورًا لعدم تعيين خيار `proxy` في `markdown-to-pdf.ts` (يُستخدم فقط `useCORS: true`) |
| `jspdf` (ويُستخدم أيضًا داخل `html2pdf.js`) | حقن `<script>` من `cdnjs.cloudflare.com` عند استخدام `.output('pdfobjectnewwindow')` | كل استدعاءات AtlasPDF (`djvu-to-pdf.ts`, `markdown-to-pdf.ts`, `rasterize.ts`) تستخدم `.output('blob')` حصرًا |
| `pdfjs-dist` / `pdfjs-dist-legacy` | شبكة تحميل PDF عن بُعد + روابط CDN افتراضية لـ cMap/الخطوط القياسية | AtlasPDF يمرّر `{ data: Uint8Array }` محليًا في كل الاستدعاءات (~50 موضع)، ويُهيّئ `cMapUrl`/`standardFontDataUrl`/`workerSrc` لمسارات محلية صراحة في `src/lib/pdf/config.ts` وloader.ts |
| `zgapdfsigner` | **الأكثر خطورة كامنًا**: عناوين TSA حقيقية مُضمَّنة بالكود (`timestamp.digicert.com`, `timestamp.sectigo.com`, `timestamp.entrust.net`, `timestamp.apple.com`, `ts.ssl.com`, `freetsa.org`) + تحميل CRL/AIA | يُفعَّل فقط عند تمرير خيار `signdate` أو `ltv` — `src/lib/pdf/processors/digital-sign.ts` **لا يمرّرهما إطلاقًا** (تم التأكد بالبحث الشامل في `src/` عن `ltv`/`signdate`/`TSAURLS`) — **نقطة يجب الانتباه لها إن طُوِّرت ميزة "ختم زمني موثوق حقيقي" مستقبلاً** |
| `@matbee/libreoffice-converter` | دوال `loadFontsFromUrl(url)`/`convertFromUrl(url)` عامة تقبل أي رابط من المستدعي | AtlasPDF لا يستدعيهما إطلاقًا؛ يستخدم فقط `WorkerBrowserConverter` بمسارات محلية (`this.basePath`) |

#### ب. ملفات WASM Glue الضخمة في `public/`

| المحرك | النتيجة |
|---|---|
| LibreOffice WASM (`soffice.js`, `browser.worker.global.js`, `soffice.worker.js`) | **نظيف** — كل `fetch`/`XHR`/`importScripts` تحميل محلي لملفات `soffice.wasm`/`soffice.data` نفسها، أو آليات Emscripten معطّلة (محاكاة socket لا تُستخدم فعليًا) |
| محرر PDF المباشر (`direct-pdf-editor/`, محرك **PDFium** الحقيقي لـ Google مُعاد تسميته داخليًا `bentopdf-pdfium`) | **نظيف تقريبًا** — نقطة واحدة تستحق الانتباه: `app.js` يحتوي `fetch(demo)` حيث `demo` يُقرأ من معامل رابط `?demo=` في عنوان الصفحة (أداة اختبار E2E داخلية) — رابط مُصاغ خصيصًا (`?demo=https://...`) يمكن نظريًا أن يجعل المحرر يجلب رابطًا يتحكم به المهاجم؛ ليس اتصالاً تلقائيًا مخفيًا لكنه قدرة يتحكم بها المستدعي |
| Pyodide/PyMuPDF (`pymupdf-wasm/`) | رابط CDN احتياطي قياسي لـ jsDelivr مُضمَّن في `pyodide.js` (سلوك Pyodide الرسمي الافتراضي)، لكنه **معطّل فعليًا** لأن `pymupdf-loader.ts` يمرّر `indexURL` محليًا ويحمّل الحزم (wheels) بروابط محلية صريحة دائمًا وليس بالاسم. أيضًا وُجد ملفا `pymupdf.js`/`pymupdf-lite.js` بهما دالة `openUrl()` عامة لكنهما **غير مستوردين إطلاقًا** في `src/` (أثر بناء غير مستخدم) |
| QPDF (`qpdf.js`) وCoherentPDF (`coherentpdf.browser.min.js`) | **نظيف تمامًا** — صفر أي `fetch`/`XHR`/`WebSocket`/`importScripts` بأي هدف خارجي |
| عارضات pdf.js المُجمَّعة (`pdfjs-viewer/`, `pdfjs-annotation-viewer/`) | **نظيف** — كل الروابط الحرفية الموجودة هي ترويسات ترخيص، مساحات أسماء XML/XFA، أو نص تشخيصي داخل رسائل أخطاء React (غير مُنفَّذة أبدًا كطلب شبكة) |

**لماذا فحص كود الـ Glue كافٍ (ولا حاجة لتفكيك ملفات .wasm الخام)**: وحدات WebAssembly المُجمَّعة بواسطة Emscripten (`soffice.wasm`, `editcore.wasm`, `qpdf.wasm`, `pyodide.asm.wasm`) **لا تملك قدرة شبكة مباشرة خاصة بها** — أي عملية شبكية يقوم بها كود C/C++ المُصرَّف يجب أن تمر عبر دالة JavaScript "مستوردة" يوفرها كود الـ Glue المحيط. بما أن جميع نقاط الدخول هذه (`fetch`/`XHR`/`WebSocket`/`importScripts`) في كل الملفات أعلاه إما تحميل محلي لنفس الملف، أو قدرات معطّلة لا يُستدعيها كود AtlasPDF الفعلي، فهذا دليل قوي أن الملفات الثنائية `.wasm` نفسها لا تستطيع الاتصال بالإنترنت بمعزل عن هذا الكود المُدقَّق.

#### ج. الخلاصة النهائية ومستوى الثقة

- **لم يُعثر على أي اتصال شبكي خفي أو غير موثَّق جديد** يتجاوز نقاط الاتصال الأربع الموثّقة أصلاً في القسم 5.1 (التحديث، DjVu.js، خطوط Noto، Tesseract.js/jsdelivr).
- عُثر على **قدرات شبكية كامنة (dormant) في 6 حزم/ملفات** (`cropperjs`, `html2canvas`, `jspdf`/`html2pdf.js`, `pdfjs-dist` الافتراضي، `zgapdfsigner`، ورابط `?demo=` في محرر PDFium) — كلها **غير مُفعَّلة حاليًا** بحكم طريقة استدعاء AtlasPDF لها، لكنها **قد تتفعّل تلقائيًا لو تغيّر الكود مستقبلاً** (مثال: أي تعديل قادم يمرّر خيار `signdate`/`ltv` لـ `zgapdfsigner` سيبدأ الاتصال فورًا بخوادم TSA حقيقية). هذا يعني أن التحصين الحقيقي طويل الأمد هو **CSP صارم على مستوى الشبكة** (القسم 5.2) وليس فقط الاعتماد على عدم استدعاء هذه الخيارات في الكود الحالي.
- **حدود المنهجية (بصراحة كاملة)**: هذا كله **تحليل ثابت للكود المصدري**، وليس **اختبارًا تشغيليًا فعليًا** (تشغيل التطبيق مع مراقبة شبكة حقيقية عبر DevTools Network tab أو proxy مثل mitmproxy أثناء استخدام كل أداة من الـ 132 أداة). التحليل الثابت يغطي كل مسار كود يمكن قراءته نصيًا (بما في ذلك الحزم المُصغَّرة/المُجمَّعة الضخمة)، لكنه لا يعادل يقينًا تشغيليًا بنسبة 100%. **التوصية لإغلاق هذه الفجوة نهائيًا**: تشغيل التطبيق فعليًا محليًا مع مراقب شبكة (أو حظر كل الاتصال الصادر على مستوى نظام التشغيل/الجدار الناري ما عدا `localhost`) واختبار كل أداة يدويًا أو آليًا، بالتوازي مع تطبيق توصيات القسم 6.3 وCSP الصارم في 5.2.

---

## 6. قوائم تحقق عملية لأهداف المستخدم الثلاثة (توصيات — بدون تنفيذ في هذه المرحلة)

### 6.1 أ. إعادة التسمية (Rebranding) — نقاط الهوية الواجب تغييرها

| العنصر | الملف/المسار |
|---|---|
| اسم الموقع والوصف والروابط الاجتماعية | `src/config/site.ts` (`name`, `description`, `url`, `links.github`, `links.twitter`, `creator`) |
| اسم الحزمة | `package.json` (`name: "atlaspdf"`) |
| اسم/معرّف تطبيق سطح المكتب | `src-tauri/tauri.conf.json` (`productName`, `identifier: "com.atlaspdf.app"`), `src-tauri/Cargo.toml` |
| الشعار والصور | `public/images/logo.png`, `og-image.png`, `public/favicon.svg` |
| أيقونات سطح المكتب | `src-tauri/icons/*` (كل الأحجام + أندرويد/iOS/Windows Store، رغم أن أهداف البناء الحالية سطح مكتب فقط) |
| أيقونات PWA **الناقصة فعليًا حاليًا** | `src/app/manifest.ts` يشير إلى `/icon-192.png`, `/icon-512.png`, `/screenshots/home.png`, `/icons/merge.png`, `/icons/split.png`, `/icons/compress.png` — **تم التأكد أن هذه الملفات غير موجودة في `public/` حاليًا أصلاً** (خلل قائم بغض النظر عن إعادة التسمية، يجب توفيرها بهوية جديدة) |
| روابط GitHub/X الظاهرة في الواجهة | `src/components/layout/Header.tsx`, `Footer.tsx`, `src/app/[locale]/contact/ContactPageClient.tsx` |
| README ومحتوى "About/FAQ" | `README.md`, `src/app/[locale]/about/AboutPageClient.tsx`, ومحتوى SEO لكل أداة (`src/config/tool-content/*.ts`) |
| إضافة المتصفح | `extension/manifest.json`, `extension/background.js`, `extension/icons/*` (أو حذفها بالكامل لعدم ملاءمتها لسيناريو محلي) |
| مسار المستودع في CI/CD | كل ملفات `.github/workflows/*.yml` تشير إلى `Ayoubkhattab/atlasPDF` |
| **التزام قانوني**: الإبقاء على إشعار حقوق النشر/الإسناد لـ BentoPDF ورخصة AGPL في أي نسخة مُعاد تسميتها، ما لم يُعَد ترخيص/كتابة الكود بالكامل (انظر 5.5) | `LICENSE`, `README.md` قسم Acknowledgements |

### 6.2 ب. الرفع على سيرفر خاص

- **الأداة الجاهزة الأنسب**: `docker compose --profile prod up --build` (يبني الموقع الثابت عبر Node 22 ثم يقدّمه عبر Nginx على المنفذ 8080). لا حاجة لأي خدمة سحابية.
- يجب التأكد عند التهيئة من إبقاء رؤوس `Cross-Origin-Opener-Policy: same-origin` و`Cross-Origin-Embedder-Policy: require-corp` (موجودة بالفعل في `nginx.conf`) — بدونها ستتعطل أدوات تحويل Office (LibreOffice WASM يحتاج `SharedArrayBuffer`).
- **يُنصح بشدة بإضافة رأس `Content-Security-Policy` صريح** لم يكن موجودًا أصلاً (القسم 5.2) — خصوصًا مهم إذا تحوّل السيرفر إلى بيئة "بدون إنترنت" فعلية، ليكون العزل مفروضًا على مستوى المتصفح لا فقط بإزالة استدعاءات الشبكة يدويًا من الكود.
- مرجع تفصيلي جاهز بالفعل داخل المشروع: `DEPLOYMENT.md` (يغطي Nginx/Apache/Docker والمشاكل الشائعة مثل رؤوس COOP/COEP وملفات WASM المضغوطة).

### 6.3 ج. التشغيل الكامل بدون إنترنت — خطوات محددة مطلوبة

بناءً على جدول القسم 5.1، الإجراءات المطلوبة تحديدًا (بترتيب الأولوية):

1. **تعطيل نظام التحديث بالكامل** (`src/lib/updater.ts` + مكوّنات `UpdateCheckButton`/`UpdateNotificationToast`/`UpdateModal`) أو ضبطه ليكون معطّلاً افتراضيًا (`autoCheck: false`) بدون أي استدعاء شبكي تلقائي.
2. **تجهيز DjVu.js محليًا**: تنزيل الملف من djvu.js.org وتضمينه ضمن `public/` بدلاً من التحميل عن بُعد.
3. **تجهيز خطوط Noto الثمانية محليًا** (`text-to-pdf.ts`, `watermark.ts`) بدلاً من `raw.githack.com` — يوجد بالفعل خط `NotoSansSC-Regular.ttf` محلي في `public/fonts/` يمكن اتخاذه نموذجًا لبقية الخطوط.
4. **تهيئة Tesseract.js محليًا بالكامل**: تحديد `workerPath`/`corePath`/`langPath` لملفات مُستضافة ذاتيًا بدلاً من الاعتماد على إعدادات jsdelivr الافتراضية، وتنزيل ملفات `.traineddata` للغات OCR المطلوبة فقط.
5. **تضييق سياسة الأمان (CSP)**: إزالة `https:` من `connect-src`/`img-src` في `src-tauri/tauri.conf.json`، وإضافة CSP صارم مماثل في إعدادات نشر الويب (nginx/headers) بحيث يصبح أي اتصال خارجي مستقبلي **مرفوضًا فعليًا من المتصفح** لا معتمدًا فقط على عدم وجوده في الكود.
6. **مراجعة/حذف إضافة المتصفح** (`extension/`) لأنها مصممة فقط لفتح موقع مستضاف خارجيًا.

---

## 7. ملاحظات هندسية إضافية (تقنية دَين — Tech Debt)

- تعليق ترويسة `src/config/tools.ts` يذكر "67 أداة" بينما العدد الفعلي الحالي **132** — التوثيق الداخلي غير محدَّث.
- حزمة `zustand ^5.0.0` مُدرجة في `package.json` **لكنها غير مُستخدمة إطلاقًا** في `src/` (صفر استيراد) — تبعية زائدة يمكن حذفها أو إعادة تفعيل استخدامها.
- عدم توافق نسخة `eslint-config-next ^15.1.8` مع `next ^16.3.5` الفعلية في `devDependencies`.
- **أيقونات PWA مفقودة فعليًا** (`icon-192.png`, `icon-512.png`, `screenshots/home.png`, `icons/merge|split|compress.png`) رغم أنها مُعرَّفة في `src/app/manifest.ts` — قد يؤدي لتحذيرات/فشل صامت عند تثبيت PWA حاليًا، بغض النظر عن إعادة التسمية.
- إضافة المتصفح (`extension/`) في وضعها الحالي مجرد "رابط تشغيل" لموقع الويب المستضاف، وليست أداة مستقلة — غير مفيدة أصلاً لسيناريو سيرفر محلي خاص وتحتاج قرارًا صريحًا (حذف أو إعادة بناء).
- محرك "Direct Content Edit" (`editcore.wasm`, ضمن `public/direct-pdf-editor/`) مصدره وترخيصه غير موثَّقين بوضوح داخل الحزمة نفسها — يستحق تحديدًا قبل أي إعادة توزيع أو تدقيق قانوني.

---

## 8. خلاصة الأولويات قبل بدء التنفيذ الفعلي

1. **قانونيًا**: حسم موقف الترخيص (AGPL-3.0 + إسناد BentoPDF + تراخيص المكوّنات المُجمَّعة) قبل أي نشر علني أو شبه علني بهوية جديدة.
2. **أمنيًا/عزل الشبكة**: تنفيذ الإجراءات الست في القسم 6.3 بالترتيب — تعطيل التحديث أولاً (أعلى أثر وأسهل تنفيذ)، ثم الخطوط/DjVu/Tesseract، ثم تشديد CSP كخط دفاع أخير.
3. **الهوية**: تنفيذ قائمة القسم 6.1 كاملة (بما يشمل توفير أيقونات PWA الناقصة أصلاً).
4. **النشر**: استخدام مسار Docker+Nginx الجاهز فعليًا (القسم 2.3 و6.2) كحل مباشر للسيرفر الخاص المحلي.

> هذا الملف يوثّق **الوضع الحالي فقط** ولا يتضمن أي تنفيذ. أي خطوة من القسم 6 تتطلب موافقة وتخطيطًا منفصلاً قبل التنفيذ الفعلي على الكود.

---

## 9. دراسة تجهيز النشر: خطة تنفيذية لإزالة كل اتصال بطرف ثالث

> **حالة هذا القسم: دراسة/خطة جاهزة للتنفيذ لاحقًا — لم يُنفَّذ أي تعديل على الكود بعد.** بناءً على طلب صريح: التركيز حاليًا على تجهيز المشروع بحيث **لا تتصل أي أداة بأي طرف ثالث بعد النشر**، بمعزل عن قرار الهوية/إعادة التسمية (مؤجل) وبمعزل عن قرار الاتصال بالإنترنت من عدمه (لم يُحسم بعد) — أي أن هذه الخطة تجعل المشروع **معزولاً شبكيًا بذاته (self-contained)** بغض النظر عن طبيعة السيرفر لاحقًا. رفع الملفات فعليًا على السيرفر الخاص خارج نطاق هذه الخطة (يقوم به المستخدم بنفسه).

### 9.1 الهدف والنطاق

- **الهدف**: صفر طلب شبكي خارج نطاق الأصل (`same-origin`) من أي أداة من الـ132 أداة، في كل الأحوال — سواء بقي السيرفر متصلاً بالإنترنت أم عُزل بالكامل لاحقًا.
- **خارج النطاق حاليًا**: إعادة التسمية/الهوية البصرية (القسم 6.1)، ورفع/نشر الملفات فعليًا على أي سيرفر.
- **المرجعية**: هذه الخطة تُفصِّل تنفيذيًا ما ورد إجمالاً في القسمين 6.3 و5.7.

### 9.2 التغييرات المطلوبة بالتفصيل (بالترتيب المنطقي، جاهزة للتنفيذ)

**التغيير 1 — تعطيل نظام التحديث بالكامل**
- الملف: `src/lib/updater.ts` — القيم الافتراضية الحالية لـ `autoCheck` هي `true` في 4 مواضع (الأسطر ~192, 203, 211, 218)، ومصفوفة `GITHUB_RELEASE_ENDPOINTS` تضم 3 روابط (GitHub الرسمي + وسيطين `gh-proxy.com`/`mirror.ghproxy.com`).
- المطلوب: تغيير `autoCheck` الافتراضي إلى `false` في كل المواضع، **وإزالة استدعاء الفحص التلقائي من الواجهة نفسها** (المكوّن الذي يستدعي `UpdateCheckButton`/`UpdateNotificationToast` ضمن `Header.tsx`) بدل الاكتفاء بإعداد قابل للتغيير — لضمان صفر طلب فعلي بنيويًا لا فقط افتراضيًا. إزالة الوسيطين نهائيًا من الكود بغض النظر عن مصير endpoint الرسمي.

**التغيير 2 — تجهيز DjVu.js محليًا**
- الملف: `src/lib/pdf/processors/djvu-to-pdf.ts`، دالة `loadDjVuLibrary` (~الأسطر 230-259) — حاليًا: `script.src = 'https://djvu.js.org/assets/dist/djvu.js'`.
- المطلوب: تنزيل الملف (الإصدار v0.5.4 المذكور في تعليق الكود) واستضافته محليًا (مثلاً `public/vendor/djvu.js`)، وتغيير `script.src` لمسار محلي نسبي.
- ⚠️ يستوجب التحقق من ترخيص djvu.js قبل التضمين وإعادة التوزيع.

**التغيير 3 — تجهيز خطوط Noto الثمانية محليًا**
- الملفان والمواضع الدقيقة: `src/lib/pdf/processors/text-to-pdf.ts` (مصفوفة `AVAILABLE_FONTS`، الأسطر 56-64 — 8 روابط `raw.githack.com`: Latin/Cyrillic، CJK×4 SC/TC/JP/KR، عربي، عبري، تايلندي، هندي) و`src/lib/pdf/processors/watermark.ts` (`CJK_FONT_URL` في السطر 45 — نفس خط CJK SC مكرر).
- المطلوب: تنزيل الملفات الثمانية (.ttf/.otf) ووضعها في `public/fonts/` (يوجد بالفعل هناك `NotoSansSC-Regular.ttf` كنموذج جاهز لنفس الغرض)، تحديث كل حقل `url:` في `AVAILABLE_FONTS` لمسار محلي، وتوحيد `CJK_FONT_URL` في `watermark.ts` للإشارة لملف `NotoSansSC-Regular.ttf` المحلي الموجود أصلاً (بدل تنزيل نسخة ثانية منفصلة).

**التغيير 4 — تهيئة Tesseract.js محليًا بالكامل**
- الملف: `src/lib/pdf/processors/ocr.ts`، دالة `initializeTesseract` (~الأسطر 593-608) — حاليًا `Tesseract.createWorker(langString, 1, { logger })` بدون تحديد مسارات → اعتماد كامل على افتراضيات jsdelivr.
- المطلوب:
  1. تنزيل `worker.min.js` المطابق لإصدار `tesseract.js@^6.0.1` المُثبَّت، ووضعه محليًا (مثلاً `public/tesseract/worker.min.js`).
  2. تنزيل نواة `tesseract-core` (نسخة simd وغير-simd) من `tesseract.js-core`، ووضعها محليًا (`public/tesseract/core/`).
  3. تنزيل ملفات `.traineddata` للغات العشر المدعومة (eng, chi_sim, chi_tra, jpn, kor, spa, fra, deu, por, ara) من `@tesseract.js-data`، ووضعها في `public/tesseract/lang-data/`. ⚠️ ملاحظة حجم: بعض هذه الملفات (خصوصًا CJK) كبيرة نسبيًا وستزيد حجم النشر الإجمالي بشكل ملحوظ.
  4. تمرير `workerPath`/`corePath`/`langPath` صراحة عند إنشاء الـ worker لتشير للمسارات المحلية الثلاثة أعلاه.

**التغيير 5 — فرض العزل الشبكي عبر Content-Security-Policy صارم (خط الدفاع الأخير)**
- **نسخة الويب** — الملف `next.config.js`، داخل دالة `headers()`، الكتلة الأخيرة ذات `source: '/:path*'` (الأسطر ~230-267 حاليًا، وهي الكتلة العامة لكل المسارات): إضافة رأس `Content-Security-Policy` جديد ضمن نفس المصفوفة، بقيمة من هذا الشكل (بعد إتمام التغييرات 1-4 بحيث لا يبقى أي سبب مشروع لاتصال خارجي):
  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:;
  frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';
  ```
  يجب تكرار نفس الرأس في كل ملفات النشر البديلة الموجودة فعلاً في المشروع (`nginx.conf`, `vercel.json`, `netlify.toml`, `.htaccess`, `security-headers.conf`) بحيث يبقى العزل ساريًا مهما كانت قناة النشر المُختارة لاحقًا.
- **نسخة Tauri** — الملف `src-tauri/tauri.conf.json`، كتلة `app.security.csp`: القيمة الحالية تحتوي `connect-src 'self' data: blob: https:;` و`img-src 'self' data: blob: https:;`. المطلوب: حذف `https:` من كلا التوجيهين لتصبحا `'self' data: blob:` فقط — هذا يحوّل العزل من "لا يوجد كود يتصل حاليًا" إلى "ممنوع فعليًا على مستوى المتصفح/WebView".

**التغيير 6 — ضمانات (Guardrails) لقدرات كامنة مكتشفة في الفحص العميق (القسم 5.7)**
لا تحتاج تعديل وظيفي فوري (معطّلة أصلاً بالتهيئة الحالية)، لكن يُنصح بتحويلها لقيود صريحة/تعليقات تحذيرية تمنع تفعيلها بالخطأ مستقبلاً:
- `src/lib/pdf/processors/digital-sign.ts`: عدم تمرير `signdate` أو `ltv` مطلقًا لـ `zgapdfsigner` (تفعيلهما يتصل بخوادم TSA/CRL حقيقية مُضمَّنة بالحزمة: DigiCert, Sectigo, Entrust, Apple, SSL.com, FreeTSA).
- أي استدعاء لـ `jspdf.output()`: يجب أن يبقى `'blob'` دائمًا، وليس `'pdfobjectnewwindow'`/`'pdfjsnewwindow'` (يحقنان سكربت من `cdnjs.cloudflare.com`/رابطًا خارجيًا).
- `html2canvas`: عدم تمرير خيار `proxy` مطلقًا.
- `src/lib/pdf/pymupdf-loader.ts`: إبقاء `indexURL` محليًا دائمًا، وعدم استدعاء حزم Pyodide بالاسم المجرّد (فقط بروابط `.whl` محلية صريحة).
- `public/direct-pdf-editor/app.js`: معامل `?demo=` القابل للتحكم من رابط الصفحة (يسمح بجلب رابط يحدده المستخدم/المهاجم) — يُنصح بتعطيله/حذفه بالكامل في نسخة الإنتاج.

**التغيير 7 (اختياري، تحصين إضافي)**: تقييد نطاق أوامر Tauri الأصلية `read_file`/`write_file` في `src-tauri/src/main.rs` (منع الوصول خارج مجلدات محددة)، وإعادة النظر في وجود `open_url` أصلاً إذا أُلغي نظام التحديث بالكامل (لم يعد له استخدام آخر في الكود الحالي).

**التغيير 8**: استبعاد `extension/` من عملية النشر بالكامل (لا تُبنى ولا تُوزَّع) لأنها مجرد رابط لموقع مستضاف خارجيًا (`atlaspdf.mis-pts.org`) — قرار الهوية الخاص بها مؤجل مع بقية قرارات إعادة التسمية.

### 9.3 خطوات التحقق بعد التنفيذ (لاحقًا، غير منفَّذة الآن)

1. بناء المشروع (`npm run build`) بعد تطبيق كل التغييرات، وفحص أن مخرجات `out/` لا تحتوي أي إشارة متبقية لنطاقات خارجية (بحث نصي سريع عن `http` في الحزم الناتجة).
2. تشغيل السيرفر محليًا، **قطع الاتصال بالإنترنت فعليًا على مستوى الجهاز/الجدار الناري**، ثم تجربة أداة واحدة على الأقل من كل فئة من الفئات الست (القسم 3.1) للتأكد من عملها الكامل بدون اتصال.
3. مراقبة تبويب Network في أدوات المطوّر أثناء التجربة، والتأكد أن كل الطلبات الظاهرة هي لنفس الأصل (`same-origin`) فقط — صفر طلب لأي نطاق خارجي.
4. إعادة الاتصال بالإنترنت واختبار أن CSP الصارم (التغيير 5) يحظر فعليًا أي محاولة اتصال خارجي تجريبية متعمَّدة (كاختبار سلامة الإعداد نفسه).

### 9.4 ترتيب التنفيذ الموصى به عند البدء الفعلي

1. تجهيز الأصول المحلية أولاً (التغييرات 2، 3، 4 — تنزيل djvu.js والخطوط وملفات Tesseract) لأنها تتطلب تنزيلًا فعليًا وقرارات ترخيص/حجم قبل تعديل أي سطر كود.
2. تعديلات الكود (التغييرات 1، 2، 3، 4، 6، 7، 8) لتحويل كل مسار لاستخدام الأصول المحلية الجديدة.
3. تشديد CSP في كل قنوات النشر (التغيير 5) كخطوة أخيرة — بعد التأكد أن كل الأصول باتت محلية فعلاً، لتفادي كسر أي أداة بالخطأ قبل توفر بديلها المحلي.
4. اختبار شامل (القسم 9.3).
5. عندها فقط تصبح الخطوة التالية هي الرفع الفعلي على السيرفر الخاص (خارج نطاق هذه الخطة).

---

## الملحق: تحليل أمني إضافي — سيناريو النشر على سيرفر خاص **متصل بالإنترنت**

> بخلاف القسم 5 (الذي يفترض عزلاً كاملاً عن الإنترنت)، هذا الملحق يغطي الحالة التي يُرفع فيها المشروع على سيرفر خاص لكنه **متاح عبر الإنترنت** لأي زائر. الصورة الأمنية تتغير: بعض المخاوف تختفي (لا توجد قاعدة بيانات/حسابات لاستغلالها)، لكن مخاوف أخرى تصبح فعلية لأن أي طرف على الإنترنت يمكنه الوصول للتطبيق الآن.

### أ. لماذا المخاطر الأساسية محدودة نسبيًا

بما أن المشروع **static بالكامل بدون Backend/API/قاعدة بيانات/حسابات مستخدمين**، فإن فئات كاملة من الثغرات الكلاسيكية (SQL Injection، كسر مصادقة، IDOR، تنفيذ كود على السيرفر) **غير واردة أصلاً** لعدم وجود منطق سيرفر لاستغلاله. المعالجة تتم في متصفح كل زائر بمعزل عن الآخرين — نقطة قوة حقيقية في هذا التصميم.

### ب. المخاوف الأمنية المحددة عند الاتصال بالإنترنت

| # | المخاطرة | التفصيل | الخطورة |
|---|---|---|---|
| 1 | **آلية التحديث = أكبر خطر سلسلة توريد (Supply Chain)** | `src/lib/updater.ts` يحوّل روابط التنزيل عبر `gh-proxy.com`/`mirror.ghproxy.com` (طرف ثالث غير تابع للمالك)، ولا يوجد أي **توقيع رقمي أو تحقق checksum** على ملفات التثبيت (بنايات Tauri غير موقّعة أصلاً — انظر القسم 2.5). لو تم اختراق/انتحال أحد هذين الوسيطين (MITM)، يمكن استبدال ملف التثبيت الذي يحمّله المستخدم ببرمجية خبيثة يشغّلها بصلاحيات كاملة على جهازه. | 🔴 عالية |
| 2 | **غياب CSP كليًا في نسخة الويب** | لا يوجد `Content-Security-Policy` إطلاقًا (انظر القسم 5.2). مع وجود ~20 استخدامًا لـ `dangerouslySetInnerHTML` (markdown-to-pdf، PDF-to-SVG، عرض نصوص مستخرجة)، أي ثغرة XSS تُكتشف مستقبلاً في هذه المسارات ستكون **بلا أي طبقة حماية إضافية توقفها**. | 🔴 عالية |
| 3 | **`pdfjs-dist-legacy` نسخة قديمة (2.16.105) تعالج ملفات PDF غير موثوقة** | أي زائر يفتح ملف PDF ضار عبر أداة `pdf-to-svg` يعالجه بمحرك قديم قد يحمل ثغرات معروفة تاريخيًا في pdf.js. بما أن التطبيق عام الآن، هذا يصبح متجه هجوم فعلي على أي زائر (انظر القسم 5.6). | 🟠 متوسطة-عالية |
| 4 | **استهلاك نطاق ترددي ضخم = متجه DoS/تكلفة** | كل استخدام لأدوات تحويل Office يحمّل ~170MB (LibreOffice WASM) أو ~65MB (Pyodide). بدون rate limiting، يمكن لأي طرف إرسال طلبات متكررة لاستنزاف النطاق الترددي أو فاتورة الاستضافة. | 🟠 متوسطة |
| 5 | **iframe المحرر المباشر (`allow-scripts allow-same-origin` معًا)** | هذا الجمع في sandbox معروف بأنه يُضعف عزل الـ sandbox فعليًا. يستحق تدقيقًا خاصًا لأن محتواه (`editcore.wasm`) من مصدر غير موثّق الترخيص (انظر القسم 3.3). | 🟡 تستحق مراجعة |
| 6 | **تسريب ميتاداتا لأطراف ثالثة** | فحص التحديث يرسل (IP + إصدار التطبيق) لـ GitHub وخادمين وسيطين عند كل إقلاع — يتناقض مع شعار "100% Private" في الموقع (انظر القسم 5.5). | 🟡 خصوصية |
| 7 | **التزام AGPL يصبح فعليًا وملزمًا** | بمجرد أن يصل أي شخص غير المالك للخدمة عبر الشبكة، تُفعَّل المادة 13 من AGPL-3.0 (وجوب إتاحة الكود المصدري الكامل بما فيه التعديلات للمستخدمين). ليست ثغرة تقنية لكنها مخاطرة قانونية حقيقية إن لم تُعالَج (انظر القسم 5.5). | ⚖️ قانونية |
| 8 | **أوامر Tauri غير المقيّدة (`read_file`/`write_file`) بلا نطاق** | الخطر منخفض حاليًا لأن تطبيق سطح المكتب يحمّل حزمة محلية فقط، لكن لو أُضيف مستقبلاً أي تحميل محتوى من الإنترنت داخل الواجهة، تصبح هذه الأوامر خطيرة جدًا مدمجة مع أي XSS (انظر القسم 5.3). | 🟡 احترازية للمستقبل |

### ج. طبقات الحماية اللازمة (من البنية التحتية إلى التطبيق)

**الطبقة 1 — الشبكة والبنية التحتية**
- جدار حماية يفتح فقط المنافذ 80/443 (وSSH على منفذ غير افتراضي بمفتاح فقط + fail2ban).
- عدم كشف Docker daemon socket أو أي منفذ تطوير (3000) للإنترنت.
- تحديث دوري لنظام التشغيل وDocker وNginx.

**الطبقة 2 — TLS/HTTPS**
- شهادة صالحة (Let's Encrypt)، تحويل إجباري HTTP→HTTPS، تفعيل **HSTS**.
- تعطيل بروتوكولات/تشفيرات TLS قديمة.
- ملاحظة: HTTPS مطلوب أصلاً لتفعيل Service Worker وCOOP/COEP (secure context) — فائدة إضافية مزدوجة.

**الطبقة 3 — خادم الويب (Nginx) وWAF**
- **إضافة CSP صريح وصارم** (الأولوية القصوى — غير موجود إطلاقًا حاليًا):
  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self';
  ```
  (يمكن توسيع `connect-src`/`script-src` مؤقتًا فقط لأي نطاقات خارجية تُبقيها فعّالة عمدًا).
- إضافة `Strict-Transport-Security` و`Permissions-Policy` بجانب الرؤوس الموجودة أصلاً (COOP/COEP/X-Frame-Options).
- **Rate limiting** (`limit_req` في nginx، أو Cloudflare أمام السيرفر) لمنع استنزاف النطاق الترددي عبر الملفات الضخمة.
- طبقة WAF اختيارية (Cloudflare المجاني، أو ModSecurity) لفلترة الزحف الآلي وأنماط الهجوم الشائعة.

**الطبقة 4 — التطبيق نفسه**
- تدقيق كل استخدامات `dangerouslySetInnerHTML` (خصوصًا markdown/SVG) للتأكد من مرورها فعليًا وبشكل كافٍ عبر `html-sanitizer.ts`.
- استبدال/تحديث `pdfjs-dist-legacy` أو عزل أداة `pdf-to-svg` بشكل إضافي.
- مراجعة/تعديل `sandbox` الخاص بـ iframe المحرر المباشر.
- تصحيح نص "Trusted Timestamp" ليعكس أنه ختم محلي غير حقيقي (شفافية مع المستخدمين العامين — انظر القسم 5.4).

**الطبقة 5 — آلية التحديث**
- إزالة الوسيطين غير الموثوقين (`gh-proxy.com`, `mirror.ghproxy.com`) نهائيًا.
- إما تعطيل التحديث التلقائي بالكامل، أو الانتقال لـ **Tauri Updater الرسمي** مع توقيع Ed25519 والتحقق من checksum قبل أي تنزيل/تشغيل تلقائي.

**الطبقة 6 — المراقبة والصيانة المستمرة**
- تفعيل سجلات الوصول (access logs) ومراقبتها/تنبيهات على أنماط غير طبيعية.
- تشغيل `npm audit`/Dependabot دوريًا على التبعيات (خصوصًا node-forge, pdfjs-dist-legacy, zgapdfsigner).
- نسخ احتياطي لإعدادات السيرفر.

### د. أولوية التنفيذ الفوري (Top 5) لسيناريو الاتصال بالإنترنت

1. إضافة CSP صارم إلى إعدادات nginx.
2. تعطيل/تأمين آلية التحديث (إزالة الوسيطين + توقيع رقمي إن أُبقيت مفعّلة).
3. تفعيل HTTPS + HSTS + rate limiting.
4. تدقيق sanitization لمسارات `dangerouslySetInnerHTML`.
5. حسم موقف الترخيص AGPL قبل الإتاحة العامة.
