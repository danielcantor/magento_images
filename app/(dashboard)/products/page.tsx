import ProductsView from "@/components/ProductsView";
import { getUploadSettings } from "@/lib/uploadMode";

export const dynamic = "force-dynamic";

export default function ProductsPage() {
  return <ProductsView syncStoresEnabled={getUploadSettings().syncStoresEnabled} />;
}
