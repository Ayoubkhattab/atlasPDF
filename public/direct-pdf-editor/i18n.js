/**
 * Arabic localisation for the Direct Content Editor.
 *
 * The editor is a self-contained app served in an iframe by EditPDFTool, which
 * appends the active site locale as `?lang=`. The markup already carries
 * `data-i18n`, `data-i18n-title` and `data-i18n-placeholder` keys from upstream
 * but nothing ever read them, so the UI stayed English whatever the locale was.
 *
 * Only Arabic is wired up. Any other value of `?lang=` leaves the DOM untouched,
 * so English behaves exactly as before.
 *
 * On layout: styles.css is written entirely with physical directions
 * (left/right, no logical properties) across 44 flex containers and 25
 * absolutely positioned elements, so flipping the document to RTL would reverse
 * the flex rows while the pinned overlays stayed put. Each translated node gets
 * dir="auto" instead, which renders Arabic right-to-left without disturbing the
 * surrounding chrome. Flipping the editor shell itself needs a separate pass
 * over styles.css.
 */
(function () {
  'use strict';

  var AR = {
    'alert.ok': 'حسناً',
    'alert.title': 'تنبيه',
    'common.add': 'إضافة',
    'loader.processing': 'جارٍ المعالجة…',

    'tools:editPdfText.addText': 'إضافة نص',
    'tools:editPdfText.alignment': 'المحاذاة',
    'tools:editPdfText.change': 'تغيير',
    'tools:editPdfText.choosePdf': 'اختر ملف PDF…',
    'tools:editPdfText.color': 'اللون',
    'tools:editPdfText.dirAuto': 'تلقائي',
    'tools:editPdfText.direction': 'الاتجاه',
    'tools:editPdfText.emptyState': 'افتح ملف PDF لتحرير نصوصه وصوره وأشكاله.',
    'tools:editPdfText.export': 'تصدير',
    'tools:editPdfText.filterAll': 'الكل',
    'tools:editPdfText.filterImages': 'الصور',
    'tools:editPdfText.filterShapes': 'الأشكال',
    'tools:editPdfText.filterText': 'النص',
    'tools:editPdfText.font': 'الخط',
    'tools:editPdfText.ignore': 'تجاهل',
    'tools:editPdfText.langAuto': 'تلقائي',
    'tools:editPdfText.lists': 'القوائم',
    'tools:editPdfText.name': 'تحرير نص PDF',
    'tools:editPdfText.next': 'التالي',
    'tools:editPdfText.open': 'فتح',
    'tools:editPdfText.outline': 'حدّ النص',
    'tools:editPdfText.pathStroke': 'حدّ المسار',
    'tools:editPdfText.replace': 'استبدال',
    'tools:editPdfText.replaceAll': 'استبدال الكل',
    'tools:editPdfText.spacing': 'التباعد',
    'tools:editPdfText.style': 'النمط',
    'tools:editPdfText.systemFonts': 'خطوط النظام',

    'tools:editPdfText.phFind': 'بحث',
    'tools:editPdfText.phReplaceWith': 'استبدال بـ',

    'tools:editPdfText.tipAddAnImage': 'إضافة صورة',
    'tools:editPdfText.tipAddToYourDictionary': 'إضافة إلى قاموسك',
    'tools:editPdfText.tipAlignBottoms': 'محاذاة الحواف السفلية',
    'tools:editPdfText.tipAlignCenter': 'توسيط',
    'tools:editPdfText.tipAlignHorizontalCenters': 'محاذاة المراكز أفقياً',
    'tools:editPdfText.tipAlignLeft': 'محاذاة لليسار',
    'tools:editPdfText.tipAlignLeftEdges': 'محاذاة الحواف اليسرى',
    'tools:editPdfText.tipAlignRight': 'محاذاة لليمين',
    'tools:editPdfText.tipAlignRightEdges': 'محاذاة الحواف اليمنى',
    'tools:editPdfText.tipAlignTops': 'محاذاة الحواف العلوية',
    'tools:editPdfText.tipAlignVerticalCenters': 'محاذاة المراكز عمودياً',
    'tools:editPdfText.tipAlternateTextForAccessibilityTaggedPdfs':
      'نص بديل لإمكانية الوصول (ملفات PDF الموسومة)',
    'tools:editPdfText.tipBackToUpload': 'العودة إلى الرفع',
    'tools:editPdfText.tipBold': 'عريض',
    'tools:editPdfText.tipBringToFront': 'إحضار إلى الأمام',
    'tools:editPdfText.tipCheckTheSpellingOfThisPage': 'تدقيق إملاء هذه الصفحة',
    'tools:editPdfText.tipClickThePageToAddATextBox': 'انقر على الصفحة لإضافة مربع نص',
    'tools:editPdfText.tipClose': 'إغلاق',
    'tools:editPdfText.tipCopyThisPageSTextInReadingOrder': 'نسخ نص هذه الصفحة بترتيب القراءة',
    'tools:editPdfText.tipCustomTextColor': 'لون نص مخصص',
    'tools:editPdfText.tipDecreaseListIndentTab': 'تقليل إزاحة القائمة (⇧Tab)',
    'tools:editPdfText.tipDelete': 'حذف',
    'tools:editPdfText.tipDistributeHorizontally': 'توزيع أفقي',
    'tools:editPdfText.tipDistributeVertically': 'توزيع عمودي',
    'tools:editPdfText.tipDocumentProperties': 'خصائص المستند',
    'tools:editPdfText.tipDuplicate': 'تكرار',
    'tools:editPdfText.tipEditExistingContent': 'تحرير المحتوى الموجود',
    'tools:editPdfText.tipExportS': 'تصدير (⌘S)',
    'tools:editPdfText.tipFileDetails': 'تفاصيل الملف',
    'tools:editPdfText.tipFindAndReplace': 'بحث واستبدال',
    'tools:editPdfText.tipFitPage': 'ملاءمة الصفحة',
    'tools:editPdfText.tipFlipHorizontal': 'قلب أفقي',
    'tools:editPdfText.tipFlipVertical': 'قلب عمودي',
    'tools:editPdfText.tipFontSize': 'حجم الخط',
    'tools:editPdfText.tipFromContent': 'من المحتوى',
    'tools:editPdfText.tipHideBar': 'إخفاء الشريط',
    'tools:editPdfText.tipIncreaseListIndentTab': 'زيادة إزاحة القائمة (Tab)',
    'tools:editPdfText.tipItalic': 'مائل',
    'tools:editPdfText.tipJustify': 'ضبط',
    'tools:editPdfText.tipLeftToRight': 'من اليسار إلى اليمين',
    'tools:editPdfText.tipListFontsInstalledOnThisDeviceChromium':
      'عرض الخطوط المثبّتة على هذا الجهاز (Chromium)',
    'tools:editPdfText.tipNextMatch': 'التطابق التالي',
    'tools:editPdfText.tipNextPage': 'الصفحة التالية',
    'tools:editPdfText.tipNumberedListMarkerStyle': 'نمط ترقيم القائمة',
    'tools:editPdfText.tipOpenAnotherPdf': 'فتح ملف PDF آخر',
    'tools:editPdfText.tipOutlineWidth0None': 'عرض الحدّ (0 = بلا حد)',
    'tools:editPdfText.tipPreviousMatch': 'التطابق السابق',
    'tools:editPdfText.tipPreviousPage': 'الصفحة السابقة',
    'tools:editPdfText.tipRedoZ': 'إعادة (⇧⌘Z)',
    'tools:editPdfText.tipReplaceThisImageKeepingItsPlacement':
      'استبدال هذه الصورة مع الإبقاء على موضعها',
    'tools:editPdfText.tipRightToLeft': 'من اليمين إلى اليسار',
    'tools:editPdfText.tipRotateLeft90': 'تدوير لليسار 90°',
    'tools:editPdfText.tipRotateRight90': 'تدوير لليمين 90°',
    'tools:editPdfText.tipSendToBack': 'إرسال إلى الخلف',
    'tools:editPdfText.tipShowBar': 'إظهار الشريط',
    'tools:editPdfText.tipShowOrHideTheFormatPanel': 'إظهار أو إخفاء لوحة التنسيق',
    'tools:editPdfText.tipSpellCheckLanguage': 'لغة التدقيق الإملائي',
    'tools:editPdfText.tipStrikethrough': 'يتوسطه خط',
    'tools:editPdfText.tipStrokeColor': 'لون الحدّ',
    'tools:editPdfText.tipStrokeWidth': 'عرض الحدّ',
    'tools:editPdfText.tipSubscript': 'منخفض',
    'tools:editPdfText.tipSuperscript': 'مرتفع',
    'tools:editPdfText.tipTextOutlineColor': 'لون حدّ النص',
    'tools:editPdfText.tipToggleBulletedItem': 'تبديل عنصر نقطي',
    'tools:editPdfText.tipToggleNumberedItem': 'تبديل عنصر مرقّم',
    'tools:editPdfText.tipTypeAPageNumberAndPressEnter': 'اكتب رقم صفحة ثم اضغط Enter',
    'tools:editPdfText.tipUnderline': 'تحته خط',
    'tools:editPdfText.tipUndoZ': 'تراجع (⌘Z)',
    'tools:editPdfText.tipWhatTheEditToolTouchesNarrowTheScopeOnBus':
      'ما الذي تطاله أداة التحرير: ضيّق النطاق في الصفحات المزدحمة',
    'tools:editPdfText.tipZoomIn': 'تكبير',
    'tools:editPdfText.tipZoomOut': 'تصغير',
    'tools:editPdfText.tipZoomPresets': 'مستويات تكبير جاهزة',
  };

  var DICTIONARIES = { ar: AR };

  function requestedLang() {
    try {
      return (new URLSearchParams(window.location.search).get('lang') || '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  // Accepts "ar" as well as regional tags such as "ar-SA".
  var lang = requestedLang().split('-')[0];
  var dict = DICTIONARIES[lang];
  if (!dict) return;

  var SELECTOR = '[data-i18n],[data-i18n-title],[data-i18n-placeholder]';

  function apply(el) {
    var textKey = el.getAttribute('data-i18n');
    if (textKey && dict[textKey]) {
      el.textContent = dict[textKey];
      // Let the browser derive direction from the text itself, so the
      // surrounding LTR chrome is left alone.
      el.setAttribute('dir', 'auto');
    }

    var titleKey = el.getAttribute('data-i18n-title');
    if (titleKey && dict[titleKey]) el.setAttribute('title', dict[titleKey]);

    var phKey = el.getAttribute('data-i18n-placeholder');
    if (phKey && dict[phKey]) el.setAttribute('placeholder', dict[phKey]);
  }

  function translate(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(SELECTOR)) apply(root);
    Array.prototype.forEach.call(root.querySelectorAll(SELECTOR), apply);
  }

  function start() {
    document.documentElement.setAttribute('lang', lang);
    translate(document.body);

    // The editor rebuilds its panels as documents load, so re-translate
    // whatever it adds back into the tree.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes, translate);
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
