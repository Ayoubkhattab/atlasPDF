# AtlasPDF Static Export Deployment Guide

This project is configured for static export, making it deployable to any static hosting provider.

## 📦 Build Output

When you run `npm run build`, Next.js generates a static site in the `out/` directory containing:
- Pre-rendered HTML pages for all routes (including localized routes)
- Static assets (CSS, JS, images, WASM files)
- Client-side JavaScript for interactivity
- PWA assets (service worker, manifest)

## 🔧 Prerequisites

- Node.js 18.17 or later
- npm, yarn, or pnpm

## 🏗️ Build the Project

```bash
# Install dependencies
npm install

# Build for production
npm run build
```

The static output will be in the `out/` directory.

> **Note:** Browsers download the LibreOffice engine as the committed `.gz` files and decompress them themselves, so no server-side gzip setup is needed. The `postbuild` step additionally writes decompressed copies to `out/libreoffice-wasm/` for the Tauri desktop app and as a fallback. See [LibreOffice WASM Architecture](#-libreoffice-wasm-architecture) for details.

## 🚀 Deployment Options

### 1. Vercel (Recommended)

**Automatic Deployment:**
1. Push your code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Vercel auto-detects Next.js and deploys

**Manual Deployment:**
```bash
npm install -g vercel
vercel --prod
```

Configuration is already set in `vercel.json` with:
- Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
- Cross-Origin isolation headers (COOP/COEP/CORP) for SharedArrayBuffer support
- Cache headers for static assets
- WASM MIME type configuration

---

### 2. Netlify

**Automatic Deployment:**
1. Push your code to GitHub
2. Import project in [Netlify](https://netlify.com)
3. Build settings are auto-detected from `netlify.toml`

**Manual Deployment:**
```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=out
```

---

### 3. GitHub Pages

> ⚠️ **Limitation:** GitHub Pages does **not** support custom response headers. This means `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers cannot be set, so `SharedArrayBuffer` will be unavailable. **Document conversion tools (Word/Excel/PPT/RTF to PDF) that rely on LibreOffice WASM will not work on GitHub Pages.** All other PDF tools (merge, split, compress, etc.) work fine. Use Vercel, Netlify, Cloudflare Pages, or Docker+Nginx for full feature support.

**Automatic Deployment:**
1. Enable GitHub Pages in repository settings
2. Set source to "GitHub Actions"
3. Push to `main` branch - workflow deploys automatically

**Manual Deployment:**
```bash
npm run build
# Push the out/ directory to gh-pages branch
```

The `.github/workflows/deploy.yml` workflow handles automatic deployment.

---

### 4. Cloudflare Pages

AtlasPDF uses a custom asset chunking mechanism to bypass the 25 MiB file size limit on Cloudflare Pages. Large LibreOffice WASM files are automatically split into ~20MB chunks during the build process and reassembled on the client side.

**Automatic Deployment:**
1. Connect repository in [Cloudflare Pages](https://pages.cloudflare.com)
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `out`
   - Node version: 20

**Manual Deployment:**
```bash
npm install -g wrangler
npm run build
wrangler pages deploy out
```

---

### 5. Docker + Nginx (Self-hosted)

The project includes `docker-compose.yml` and `nginx.conf` for containerized deployment.

**Development Mode:**
```bash
docker compose --profile dev up
```
Open http://localhost:3000

**Production Mode (Static Export + Nginx):**
```bash
docker compose --profile prod up --build
```
Open http://localhost:8080

**Stop and remove containers:**
```bash
docker compose down
```

---

### 6. Nginx (Self-hosted without Docker)

```bash
# Build the site
npm run build

# Copy to web root
sudo cp -r out/* /var/www/html/
```

Use the provided `nginx.conf` as a reference, or configure manually:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml application/wasm;

    # MIME types for WASM and ES modules
    types {
        application/wasm wasm;
        application/javascript mjs;
    }

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    # Required for SharedArrayBuffer (LibreOffice WASM pthreads)
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;

    # IMPORTANT: Nginx's add_header in a location block overrides ALL
    # server-level add_header directives. Every location block that uses
    # add_header must re-include all required security/CORS headers.

    # Static assets - long cache
    location ~* \.(ico|jpg|jpeg|png|gif|svg|webp|avif|woff|woff2|ttf|eot|js|css)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Content-Type-Options "nosniff" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
    }

    # LibreOffice WASM files - gzip_static auto-serves .gz with correct headers
    # Requires both soffice.wasm and soffice.wasm.gz on disk (postbuild handles this)
    location /libreoffice-wasm/ {
        gzip_static on;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        types {
            application/wasm wasm;
            application/javascript js;
            application/octet-stream data;
        }
        add_header X-Content-Type-Options "nosniff" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
    }

    # HTML pages - no cache
    location / {
        try_files $uri $uri.html $uri/ =404;
        add_header Cache-Control "public, max-age=0, must-revalidate";
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
    }

    # 404 page
    error_page 404 /404.html;
}
```

---

### 7. Apache (Self-hosted)

```bash
# Build the site
npm run build

# Copy to web root
sudo cp -r out/* /var/www/html/
```

Create `.htaccess` in the web root:

```apache
# Enable rewrite engine
RewriteEngine On

# Serve HTML files without extension
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^([^\.]+)$ $1.html [NC,L]

# WASM MIME type
AddType application/wasm .wasm

# Cache static assets
<FilesMatch "\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|wasm)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
</FilesMatch>

# Security headers
Header set X-Content-Type-Options "nosniff"
Header set X-Frame-Options "SAMEORIGIN"
Header set X-XSS-Protection "1; mode=block"
Header set Referrer-Policy "strict-origin-when-cross-origin"
Header set Permissions-Policy "camera=(), microphone=(), geolocation=()"
# Required for SharedArrayBuffer (LibreOffice WASM pthreads)
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
Header set Cross-Origin-Resource-Policy "cross-origin"
```

---

### 8. AWS S3 + CloudFront

```bash
# Build the site
npm run build

# Upload to S3
aws s3 sync out/ s3://your-bucket-name --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

**S3 Bucket Configuration:**
- Enable static website hosting
- Set index document to `index.html`
- Set error document to `404.html`

**CloudFront Response Headers Policy:**
Create a response headers policy with these custom headers to enable SharedArrayBuffer:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: cross-origin`

Attach this policy to your CloudFront distribution's behavior settings.

---

### 9. Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login and initialize
firebase login
firebase init hosting

# Build and deploy
npm run build
firebase deploy --only hosting
```

Configure `firebase.json`:
```json
{
  "hosting": {
    "public": "out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "cleanUrls": true,
    "trailingSlash": true,
    "headers": [
      {
        "source": "**/*.@(js|css|woff|woff2|ttf|eot|ico|jpg|jpeg|png|gif|svg|webp|avif|wasm)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=31536000, immutable"
          }
        ]
      },
      {
        "source": "**",
        "headers": [
          {
            "key": "X-Content-Type-Options",
            "value": "nosniff"
          },
          {
            "key": "X-Frame-Options",
            "value": "SAMEORIGIN"
          },
          {
            "key": "X-XSS-Protection",
            "value": "1; mode=block"
          },
          {
            "key": "Referrer-Policy",
            "value": "strict-origin-when-cross-origin"
          },
          {
            "key": "Permissions-Policy",
            "value": "camera=(), microphone=(), geolocation=()"
          },
          {
            "key": "Cross-Origin-Opener-Policy",
            "value": "same-origin"
          },
          {
            "key": "Cross-Origin-Embedder-Policy",
            "value": "require-corp"
          },
          {
            "key": "Cross-Origin-Resource-Policy",
            "value": "cross-origin"
          }
        ]
      }
    ]
  }
}
```

---

### 10. Quick Local Preview

After building, you can preview the static site locally:

```bash
# Using Python
cd out
python -m http.server 8080

# Using Node.js serve
npx serve out

# Using PHP
cd out
php -S localhost:8080
```

Then visit http://localhost:8080

---

## 🔧 Environment Variables

The following environment variables can be set before building:

```bash
# No required environment variables for static export
# All processing happens client-side

# Optional: For subpath deployment (e.g. /atlaspdf)
BASE_PATH=/atlaspdf

# Optional: For analytics or custom features
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

---

## 🌐 Subpath Deployment

AtlasPDF supports deployment under a subpath (e.g., `https://your-domain.com/atlaspdf/`). This is useful for hosting the app as a part of a larger website.

### Configuration

The subpath must be specified at **build time** because Next.js needs to bake the paths into the static HTML.

1.  **Environment Variable**: Set `BASE_PATH` (or `NEXT_PUBLIC_BASE_PATH`) to your desired subpath (e.g., `/atlaspdf`).
2.  **Build**: Run `npm run build` with the variable set.

### Examples

#### Command Line
```bash
BASE_PATH=/atlaspdf npm run build
```

#### Docker
```bash
docker build --build-arg BASE_PATH=/atlaspdf -t atlaspdf .
```

#### GitHub Actions
Update your workflow to include the environment variable in the build step:
```yaml
- name: Build with Next.js
  run: npx next build
  env:
    BASE_PATH: /atlaspdf
```

---

## 📝 Custom Domain Setup

### Vercel
1. Go to Project Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed

### Netlify
1. Go to Site Settings → Domain Management
2. Add custom domain
3. Update DNS records

### GitHub Pages
1. Add `CNAME` file to `public/` directory with your domain
2. Update DNS:
   ```
   Type: CNAME
   Name: www (or @)
   Value: your-username.github.io
   ```

### Cloudflare Pages
1. Go to Custom Domains
2. Add your domain
3. DNS is automatically configured if using Cloudflare DNS

---

## 🌐 Multi-language Routes

AtlasPDF supports multiple languages. The static export generates pages for all locales:

| Locale | URL Pattern | Example |
|--------|-------------|---------|
| English | `/en/...` | `/en/tools/merge-pdf/` |
| Spanish | `/es/...` | `/es/tools/merge-pdf/` |
| French | `/fr/...` | `/fr/tools/merge-pdf/` |
| German | `/de/...` | `/de/tools/merge-pdf/` |
| Portuguese | `/pt/...` | `/pt/tools/merge-pdf/` |
| Japanese | `/ja/...` | `/ja/tools/merge-pdf/` |
| Korean | `/ko/...` | `/ko/tools/merge-pdf/` |
| Chinese | `/zh/...` | `/zh/tools/merge-pdf/` |

Ensure your hosting provider correctly serves the trailing slash routes (configured via `trailingSlash: true` in `next.config.js`).

---

## 🔍 SEO Considerations

The static export includes:
- ✅ Pre-rendered HTML for all pages
- ✅ Meta tags and Open Graph data
- ✅ Localized meta descriptions
- ✅ Robots.txt
- ✅ Sitemap generation
- ✅ PWA manifest

---

## 🎯 Performance Optimization

The build includes:
- Code splitting and lazy loading
- Optimized bundle sizes
- WebAssembly modules for PDF processing
- Static asset caching headers
- Minified HTML, CSS, and JS
- Gzip/Brotli compression support

---

## 📦 LibreOffice WASM Architecture

AtlasPDF uses [LibreOffice WASM](https://github.com/nichdiekuh/libreoffice-wasm) (`@matbee/libreoffice-converter`) for document conversion (Word, Excel, PowerPoint, RTF to PDF). Understanding the file serving architecture is important for deployment.

### File Layout

The `public/libreoffice-wasm/` directory (Git-tracked):
```
soffice.wasm.bin.gz       (~47MB, gzip of the WASM binary)
soffice.data.bin.gz       (~28MB, gzip of the data package)
soffice.js                (Emscripten JS glue code)
soffice.worker.js         (pthread worker)
browser.worker.global.js  (converter worker)
```

The raw binaries (~147MB / ~100MB) exceed GitHub's 100MB file limit, so only the `.gz` files are committed. All five files come from the installed `@matbee/libreoffice-converter` package and **must come from the same build** — `scripts/sync-libreoffice-assets.js` refreshes them on every `npm install`. The same script regenerates `src/lib/libreoffice/asset-version.ts`, a hash of these files used as the `?v=` cache key (the files are served as `immutable`, so the key must change whenever they do). A unit test fails if either is out of date.

### How the Browser Loads the Engine

1. **Preflight** — before downloading anything, the converter checks cross-origin isolation (`SharedArrayBuffer`) and probes the page's Content-Security-Policy (`'unsafe-eval'`, `blob:`). A misconfigured server fails in milliseconds with a precise message instead of after a 75MB download.
2. **Download** — it requests `soffice.wasm.bin.gz` and `soffice.data.bin.gz` directly. Any web server delivers those as plain bytes, so **no `gzip_static`, `Content-Encoding` or MIME configuration is required**. Large files are fetched as 10MB `Range` requests, each retried independently.
3. **Cache** — parts are stored in Cache Storage (`atlaspdf-asset-cache-v2`). An interrupted download resumes from the last completed part on the next visit, and later visits load without the network. Entries from previous engine versions are removed automatically.
4. **Decompress** — the browser's native `DecompressionStream` restores the original bytes (the gzip CRC catches corruption).

Deployments that ship only the decompressed `.bin` files still work (automatic fallback), and the Tauri desktop app streams the `.bin` files directly.

| Platform | What the browser gets |
|---|---|
| **Next.js Dev** | `.gz` from `public/` |
| **Nginx (Docker)** | `.gz` as `application/octet-stream`, with `Range` support |
| **Vercel / Netlify** | `.gz` from `out/` |
| **Cloudflare Pages** | `.gz` split into 20MB `.part_N` files plus a manifest (`scripts/chunk-assets.mjs`), reassembled client-side |

> ⚠️ **Never add `Content-Encoding: gzip` to the `.gz` files.** The browser would decode them transparently, which disables resumable downloads.

### Required Headers

HTML responses must include:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Security-Policy: ... script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' blob:; worker-src 'self' blob:; ...
```

| Directive | Why LibreOffice needs it |
|---|---|
| `script-src 'unsafe-eval'` | `soffice.js` (Emscripten/Embind) builds functions at runtime with `new Function(...)` |
| `script-src 'wasm-unsafe-eval'` | Compiling the WebAssembly engine |
| `connect-src blob:` | The engine worker reads the downloaded files through `blob:` URLs |

These are pre-configured in `vercel.json`, `netlify.toml`, `public/_headers`, `security-headers.conf` and `src-tauri/tauri.conf.json`.

### Verify a Deployment

Run this after every deploy (from a checkout of the deployed commit):
```bash
node scripts/check-libreoffice-deploy.mjs https://your-domain
```
It checks COOP/COEP, the CSP directives above, that the served JS glue is byte-identical to your checkout (catches stale deploys), and that the `.gz` files are served intact with `Range` support.

> ⚠️ **Docker Compose (`--profile prod`):** `nginx.conf` and `security-headers.conf` are bind-mounted into the `web` container and read only when nginx starts. `docker compose up -d --build` does **not** restart an already-running `web` container, so header changes are silently ignored. After pulling, run:
> ```bash
> docker compose --profile prod up -d --build --force-recreate
> ```

---

## 🐛 Troubleshooting

### Issue: 404 errors on page refresh
**Solution:** Ensure your hosting provider is configured to:
1. Serve `index.html` for directory requests
2. Try `.html` extension for extensionless URLs
3. Support trailing slashes (configured in `next.config.js`)

### Issue: Images not loading
**Solution:** Check that `images.unoptimized = true` is set in `next.config.js` (already configured).

### Issue: WASM files not loading
**Solution:** Ensure your server sends the correct MIME type for `.wasm` files:
```
Content-Type: application/wasm
```

### Issue: `EvalError: ... 'unsafe-eval' is not an allowed source of script` / "The server's Content-Security-Policy blocks the conversion engine"
**Solution:** The CSP is missing `'unsafe-eval'` in `script-src` or `blob:` in `connect-src` (see [Required Headers](#required-headers)). Fix the header, reload or recreate the web server (for Docker Compose: `docker compose --profile prod up -d --build --force-recreate`), then confirm with `node scripts/check-libreoffice-deploy.mjs https://your-domain`.

### Issue: WebAssembly streaming compilation error / `failed to match magic number`
**Solution:** The engine files reaching the browser don't match the JS glue - usually a stale or partial deploy, or a proxy rewriting response bodies. Run `node scripts/check-libreoffice-deploy.mjs https://your-domain`: it reports stale files and non-gzip bodies. The converter itself handles both plain `.gz` bytes and hosts that decode them.

### Issue: LibreOffice WASM stuck on `wasm-instantiate` / SharedArrayBuffer not available
**Solution:** LibreOffice WASM uses Emscripten pthreads (multi-threading), which requires `SharedArrayBuffer`. Browsers only enable `SharedArrayBuffer` in [Cross-Origin Isolated](https://web.dev/cross-origin-isolation-guide/) contexts. Your server **must** return these headers on **all** responses (HTML pages, JS, WASM):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

> ⚠️ **Nginx pitfall:** `add_header` inside a `location` block **completely overrides** all `add_header` directives from the parent `server` block. If you use `add_header Cache-Control ...` in a location block, you must **re-add** all Cross-Origin headers in that same block.

> ⚠️ **CDN/Proxy pitfall:** If you use Cloudflare or another CDN in front of your server, verify that these headers are not being stripped. You may need to configure response header rules in the CDN dashboard.

### Issue: Document conversion tools not working in development
**Solution:** The `predev` script automatically decompresses LibreOffice WASM `.gz` files in `public/libreoffice-wasm/` before starting the dev server. If the decompressed files are missing:
```bash
node scripts/decompress-wasm-dev.mjs
```
Then restart the dev server with `npm run dev`.

### Issue: ES modules (.mjs) not loading
**Solution:** Configure your server to serve `.mjs` files with `application/javascript` MIME type.

### Issue: Service Worker not registering (PWA)
**Solution:** 
1. Ensure HTTPS is enabled (required for service workers)
2. Check that `/sw.js` is accessible
3. Verify manifest.json is properly served

---

## 📊 Build Statistics

Check build output:
```bash
npm run build

# The build will display:
# - Route (Static) for all generated pages
# - First Load JS size
# - Bundle analysis
```

---

## 🔄 Continuous Deployment

The project includes:
- **GitHub Actions workflow** (`.github/workflows/release.yml`) - Creates releases on push to main
- **GitHub Actions workflow** (`.github/workflows/deploy.yml`) - Deploys to GitHub Pages
- **Netlify configuration** (`netlify.toml`)
- **Vercel configuration** (`vercel.json`)
- **Docker Compose** (`docker-compose.yml`) + Nginx (`nginx.conf`)

Push to `main` branch to trigger automatic deployment.

---

## 📚 Additional Resources

- [Next.js Static Export Docs](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
- [Vercel Deployment](https://vercel.com/docs)
- [Netlify Deployment](https://docs.netlify.com)
- [GitHub Pages](https://docs.github.com/en/pages)
- [Cloudflare Pages](https://developers.cloudflare.com/pages)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)

---

## ✅ Deployment Checklist

Before deploying, verify:

- [ ] `npm run build` completes without errors
- [ ] All pages render correctly at `/en`, `/zh`, etc.
- [ ] PDF tools work (WebAssembly loads correctly)
- [ ] Cross-Origin headers are present (check DevTools → Network → Response Headers)
- [ ] `SharedArrayBuffer` is available (run `typeof SharedArrayBuffer` in console — should return `"function"`)
- [ ] PWA install prompt appears on mobile
- [ ] Service worker registers (check DevTools → Application)
- [ ] Static assets load with proper caching headers
- [ ] Security headers are applied

After deploying, test:

- [ ] Multi-language routing works
- [ ] PDF processing tools function correctly
- [ ] Page refresh doesn't cause 404 errors
- [ ] PWA can be installed
- [ ] Performance is acceptable (< 3s first load)
