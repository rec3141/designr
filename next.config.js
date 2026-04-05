/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.pinimg.com" },
      { protocol: "https", hostname: "**.pinterest.com" }
    ]
  }
};
module.exports = nextConfig;
