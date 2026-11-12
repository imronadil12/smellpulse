import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function smellPulseApiPlugin(): Plugin {
  return {
    name: 'smellpulse-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          return next();
        }
        try {
          const parsedUrl = new URL(req.url, 'http://localhost:5173');
          const routePath = parsedUrl.pathname.replace(/^\/api\//, '');
          const allowed = new Set(['status', 'observations', 'my-observation', 'admin']);
          if (!allowed.has(routePath)) {
            return next();
          }

          const mod = await server.ssrLoadModule(`/api/${routePath}.ts`);
          const method = (req.method || 'GET').toUpperCase();
          const handler = mod[method];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const rawBody = Buffer.concat(chunks);

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) {
              headers.set(k, v.join(', '));
            } else if (typeof v === 'string') {
              headers.set(k, v);
            }
          }

          const webReq = new Request(parsedUrl.toString(), {
            method,
            headers,
            body:
              method !== 'GET' && method !== 'HEAD' && rawBody.length > 0
                ? rawBody
                : undefined,
          });

          const webRes: Response = await handler(webReq);
          res.statusCode = webRes.status;
          webRes.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const text = await webRes.text();
          res.end(text);
        } catch (err) {
          console.error('[Vite API Middleware Error]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), smellPulseApiPlugin()],
  base: './',
  server: {
    port: 3000,
    host: true,
  },
});
