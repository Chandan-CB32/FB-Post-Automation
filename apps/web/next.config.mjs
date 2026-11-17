/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@fb-auto/core'],
  experimental: {
    agentUpgrade: 'security',
  },
};

export default nextConfig;

