import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache is configured: every page is dynamic and all
// persistent data lives in D1 and R2.
export default defineCloudflareConfig({});
