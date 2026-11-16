import { handle } from "@/lib/apiHandler";
import { getMediaRoles, pickFirstImageRoles } from "@/lib/magento";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const roles = await getMediaRoles();
  return { roles, firstImageRoles: pickFirstImageRoles(roles) };
});
