/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate build dir when NEXT_DIST_DIR is set, so a second `next dev`
  // instance on this same checkout (e.g. a sandbox on another port) doesn't
  // corrupt the shared .next cache of the main dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Tell Next.js not to bundle resend server-side — use it as a native
  // require() at runtime. This avoids webpack trying to resolve
  // @react-email/render (optional peer dep that we don't use).
  experimental: {
    serverComponentsExternalPackages: ['resend'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
}

module.exports = nextConfig
