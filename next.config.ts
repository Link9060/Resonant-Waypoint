import type { NextConfig } from "next";

const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER ?? "";

const isUserPagesRepository =
  repositoryName.toLowerCase() === `${repositoryOwner.toLowerCase()}.github.io`;

const basePath =
  isGitHubActions && repositoryName && !isUserPagesRepository
    ? `/${repositoryName}`
    : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
