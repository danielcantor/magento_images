import { getAuthMode } from "@/lib/authMode";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const mode = getAuthMode();
  const missingMagento = !process.env.MAGENTO_BASE_URL || !process.env.MAGENTO_TOKEN;
  return (
    <>
      <Nav mode={mode} />
      <main>
        {missingMagento && (
          <div className="alert" style={{ marginBottom: 16 }}>
            Faltan las variables <b>MAGENTO_BASE_URL</b> y/o <b>MAGENTO_TOKEN</b>. Configúralas en Vercel
            (Settings → Environment Variables) o en <code>.env.local</code>.
          </div>
        )}
        {children}
      </main>
    </>
  );
}
