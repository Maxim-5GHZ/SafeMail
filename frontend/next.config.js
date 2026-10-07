// Прокси к gateway: браузер ходит same-origin (/backend/*), CORS не нужен.
// BACKEND_URL — серверная переменная (в compose: http://gateway:8080).
const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8080';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [{ source: '/backend/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },
};

module.exports = nextConfig;
