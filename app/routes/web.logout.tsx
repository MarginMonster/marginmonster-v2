import type { LoaderFunctionArgs } from "@remix-run/node";
import { webLogout } from "../lib/web-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => webLogout(request);
