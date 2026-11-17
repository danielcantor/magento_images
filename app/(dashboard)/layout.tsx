import { cookies } from "next/headers";
import { getAuthMode } from "@/lib/authMode";
import { MAGENTO_SESSION_COOKIE, openMagentoSession } from "@/lib/session";
import Nav from "@/components/Nav";
import { isAuditEnabled } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const mode = getAuthMode();
  const username =
    mode === "magento"
      ? (await openMagentoSession((await cookies()).get(MAGENTO_SESSION_COOKIE)?.value).catch(() => null))?.username
      : null;
  const missingMagento = !process.env.MAGENTO_BASE_URL || (mode !== "magento" && !process.env.MAGENTO_TOKEN);
  return (
    <>
      <Nav mode={mode} username={username} auditEnabled={isAuditEnabled()} />
      <main>
        {missingMagento && (
          <div className="alert" style={{ marginBottom: 16 }}>
            Faltan variables de Magento: <b>MAGENTO_BASE_URL</b>
            {mode !== "magento" && <> y/o <b>MAGENTO_TOKEN</b></>}. Configúralas en Vercel
            (Settings → Environment Variables) o en <code>.env.local</code>.
          </div>
        )}
        {children}
      </main>
    </>
  );
}
