import { getAuthMode } from "@/lib/authMode";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="login">
      <div className="card">
        <h1>Imágenes Magento</h1>
        <LoginForm mode={getAuthMode()} otpRequired={process.env.MAGENTO_ADMIN_2FA !== "off"} />
      </div>
    </div>
  );
}
