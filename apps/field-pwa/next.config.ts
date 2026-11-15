export default {
  transpilePackages: [
    "@agri/auth-bff",
    "@agri/ui",
    "@agri/i18n",
    "@agri/validation",
    "@agri/sync-client",
  ],
  async headers() {
    return [
      {
        source: "/offline-workspace",
        headers: [{ key: "X-Agri-Public-Shell", value: "1" }],
      },
    ];
  },
  experimental: { cpus: 2 },
};
