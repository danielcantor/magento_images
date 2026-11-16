import SharedUploadView from "@/components/SharedUploadView";
import { getUploadSettings } from "@/lib/uploadMode";

export const dynamic = "force-dynamic";

export default function SharedPage() {
  return <SharedUploadView {...getUploadSettings()} />;
}
