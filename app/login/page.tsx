import { getAuthMode } from "@/lib/authMode";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="login">
      {/* Líneas curvas y formas del brandbook (assets › misceláneas) */}
      <svg className="deco" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M-40 120 C 380 60, 760 230, 1480 40" fill="none" stroke="#CEFF00" strokeWidth="1.5" opacity="0.7" />
        <path d="M-40 720 C 420 560, 980 900, 1480 560" fill="none" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.45" />
        <path d="M1180 -20 C 1260 300, 1120 600, 1480 940" fill="none" stroke="#FFFFFF" strokeWidth="1" opacity="0.25" />
        <path d="M200 140 C 206 162 214 170 236 176 C 214 182 206 190 200 212 C 194 190 186 182 164 176 C 186 170 194 162 200 140 Z" fill="none" stroke="#CEFF00" strokeWidth="1.5" />
        <path d="M1240 700 C 1243 712 1248 717 1260 720 C 1248 723 1243 728 1240 740 C 1237 728 1232 723 1220 720 C 1232 717 1237 712 1240 700 Z" fill="#CEFF00" />
        <path d="M1290 160 a 38 38 0 1 0 30 60 a 30 30 0 1 1 -30 -60 Z" fill="none" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.6" />
      </svg>
      <div className="panel">
        <div className="lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt="SommierCenter" width={300} height={33} />
          <div className="claim">Un lugar, las mejores marcas</div>
        </div>
        <div className="card">
          <h1>Dashboard de la tienda</h1>
          <LoginForm mode={getAuthMode()} otpRequired={process.env.MAGENTO_ADMIN_2FA !== "off"} />
        </div>
        <div className="foot">Dashboard interno · Magento 2</div>
      </div>
    </div>
  );
}
