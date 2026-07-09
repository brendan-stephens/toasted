/** @type {import('next').NextConfig} */
const nextConfig = {
  // seed script + queries use the `postgres` package on the server only
  serverExternalPackages: ["postgres"],
  // a lockfile exists in the parent dir too; pin the root to this project
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
