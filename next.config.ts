import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    // Server Actions are the only mutation path; keep the payload small.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
