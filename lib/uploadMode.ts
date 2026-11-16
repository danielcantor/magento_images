import "server-only";
import { DEFAULT_QUEUE, type QueueSettings, type UploadMode } from "./queueSettings";

export function getUploadSettings(): { uploadMode: UploadMode; queue: QueueSettings; syncStoresEnabled: boolean } {
  const poll = Number(process.env.BULK_POLL_SECONDS);
  const timeout = Number(process.env.BULK_TIMEOUT_SECONDS);
  return {
    uploadMode: process.env.MAGENTO_UPLOAD_MODE === "bulk" ? "bulk" : "direct",
    syncStoresEnabled: process.env.MAGENTO_SYNC_STORES === "1" || process.env.MAGENTO_SYNC_STORES === "true",
    queue: {
      pollMs: poll > 0 ? poll * 1000 : DEFAULT_QUEUE.pollMs,
      timeoutMs: timeout > 0 ? timeout * 1000 : DEFAULT_QUEUE.timeoutMs,
    },
  };
}
