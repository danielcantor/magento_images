import HomeView from "@/components/HomeView";
import { isAuditEnabled } from "@/lib/audit";
import { getAuthMode } from "@/lib/authMode";
import { getSessionUser } from "@/lib/sessionUser";

export default async function HomePage() {
  const username = getAuthMode() === "magento" ? await getSessionUser() : null;
  return <HomeView username={username} auditEnabled={isAuditEnabled()} />;
}
