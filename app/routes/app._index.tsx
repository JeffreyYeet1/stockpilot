import { boundary } from "@shopify/shopify-app-react-router/server";
import { Suspense } from "react";
import { Await, useLoaderData, type ActionFunctionArgs, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { Dashboard, DashboardLoading } from "../components/Dashboard";
import { dashboardAction, loadDashboard } from "../inventory/dashboard.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  return { dashboard: loadDashboard(session.shop, admin.graphql) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  return dashboardAction(request, session.shop, admin.graphql);
}

export default function InventoryDashboard() {
  const { dashboard } = useLoaderData<typeof loader>();
  return <Suspense fallback={<DashboardLoading />}>
    <Await resolve={dashboard} errorElement={<DashboardLoading failed />}>
      {data => <Dashboard data={data} />}
    </Await>
  </Suspense>;
}

export const headers: HeadersFunction = args => boundary.headers(args);
