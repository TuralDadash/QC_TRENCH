const nextConfig = {
  output: "standalone",
  transpilePackages: ["leaflet", "react-leaflet"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

module.exports = nextConfig;
