import type { NextConfig } from 'next'

/**
 * En-têtes de sécurité appliqués à toute la plateforme.
 * Les applications générées reçoivent en plus une CSP stricte dans leur layout.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=()' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  /*
   * L'export lit les fichiers de police sur le disque pour les glisser dans l'archive.
   * Sans cette ligne, l'hébergeur ne les embarque pas avec la fonction, puisque rien ne
   * les importe.
   */
  outputFileTracingIncludes: {
    '/api/projects/[id]/export': ['./node_modules/@fontsource-variable/*/files/*-latin-wght-normal.woff2'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
