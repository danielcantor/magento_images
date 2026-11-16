import BulkUploadView from "@/components/BulkUploadView";
import { getUploadSettings } from "@/lib/uploadMode";

export const dynamic = "force-dynamic";

export default function BulkPage() {
  return <BulkUploadView {...getUploadSettings()} />;
}
