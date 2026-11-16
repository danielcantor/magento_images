import { handle } from "@/lib/apiHandler";
import { getWebsites } from "@/lib/magento";

export const dynamic = "force-dynamic";

export const GET = handle(async () => ({ websites: await getWebsites() }));
