# نظام نقاط البيع | POS System

نظام إدارة نقاط البيع والمخزون متعدد الفروع.

## سجل العمل المرجعي لـ Premier OS

حالة المشروع الحالية، PRs، إصدارات Windows، مصدر قاعدة البيانات، ومتطلبات الشبكة المحلية موثّقة في [PREMIER_MASTER_WORK_LOG.md](docs/PREMIER_MASTER_WORK_LOG.md). يجب قراءة هذا السجل والتحقق من GitHub HEAD وCI قبل استكمال التطوير؛ لا تعتمد على ذاكرة محادثة سابقة.

## Setup

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

1. Push to the `main` branch.
2. Go to **Settings > Pages > Build and deployment > Source** and select **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and deploys automatically.

The app uses `HashRouter` and a relative base path (`vite.config.ts` → `base: './'`) so the same build works under `https://<user>.github.io/<repo>/` and on Netlify (see `netlify.toml`).

## Environment

Create a `.env` file with your Supabase credentials:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
